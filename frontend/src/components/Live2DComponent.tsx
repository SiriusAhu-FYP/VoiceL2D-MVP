import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { startUpCubism4, cubism4Ready } from 'pixi-live2d-display/cubism4';
import { ActionPanel } from './ActionPanel';
import { ChatPanel } from './ChatPanel';
import type { ChatMessage, CharacterInfo } from './ChatPanel';
import { updateCurrentModelState, getActions, getModelPath } from '../api/live2d-api';
import testAudioUrl from '../assets/test_audio.wav';

type Live2DCubismCoreGlobal = {
    LogLevel_Verbose?: number;
    LogLevel_Info?: number;
};

type Live2DWindow = Window & {
    PIXI?: typeof PIXI;
    Live2DCubismCore?: Live2DCubismCoreGlobal;
};

type SSECallbacks = {
    playAction: (action: string, sound?: string) => void;
    playExpression: (expression: string) => void;
    playSound: (sound: string) => void;
};

// WebSocket URL for audio from Python client
const AUDIO_WS_URL = 'ws://localhost:7789';

const live2dWindow = window as Live2DWindow;
live2dWindow.PIXI = PIXI;

// Lip sync configuration - volume-based mouth control
const LIP_SYNC_CONFIG = {
    // Smoothing factor for mouth movement (0-1, lower = faster)
    smoothing: 0.3,
    // Volume threshold below which mouth stays closed
    volumeThreshold: 0.01,
    // Volume amplification factor
    amplification: 3.0,
    // Live2D parameter ID for mouth opening
    mouthParam: 'ParamMouthOpenY',
};

const waitForLive2DCore = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (live2dWindow.Live2DCubismCore) {
            resolve();
            return;
        }

        let attempts = 0;
        const maxAttempts = 50;

        const checkInterval = setInterval(() => {
            attempts += 1;
            if (live2dWindow.Live2DCubismCore) {
                clearInterval(checkInterval);
                resolve();
            } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                reject(new Error('Live2D Core SDK load timeout'));
            }
        }, 100);
    });
};

export const Live2DComponent: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const modelRef = useRef<Live2DModel | null>(null);
    const resizeHandlerRef = useRef<(() => void) | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const idleRestoreRef = useRef<(() => void) | null>(null);
    const activeModelNameRef = useRef<string | null>(null);
    const modelPathCacheRef = useRef<Map<string, string>>(new Map());
    const noopAction: SSECallbacks['playAction'] = (action, sound) => {
        void action;
        void sound;
    };
    const noopExpression: SSECallbacks['playExpression'] = (expression) => {
        void expression;
    };
    const noopSound: SSECallbacks['playSound'] = (sound) => {
        void sound;
    };
    const sseCallbacksRef = useRef<SSECallbacks>({
        playAction: noopAction,
        playExpression: noopExpression,
        playSound: noopSound,
    });
    const [currentModel, setCurrentModel] = useState<string>('');
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Chat state
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [isListening, setIsListening] = useState<boolean>(false);
    const [characters, setCharacters] = useState<CharacterInfo[]>([]);
    const [isAudioLocked, setIsAudioLocked] = useState<boolean>(false);

    // Lip sync refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
    const lipSyncActiveRef = useRef<boolean>(false);
    const currentMouthValueRef = useRef<number>(0);
    const targetMouthValueRef = useRef<number>(0);
    const wsRef = useRef<WebSocket | null>(null);
    const lipSyncHandlerRef = useRef<(() => void) | null>(null);
    const expressionResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // WebSocket reconnection state
    const wsReconnectAttemptsRef = useRef<number>(0);
    const wsReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [wsConnected, setWsConnected] = useState<boolean>(false);

    // WebSocket reconnection config
    const WS_RECONNECT_CONFIG = {
        maxAttempts: 10,
        baseDelay: 1000,      // 1 second
        maxDelay: 30000,      // 30 seconds max
        backoffFactor: 1.5,
    };

    // Expression auto-reset configuration
    const EXPRESSION_RESET_DELAY = 10000; // 10 seconds

    // Helper function to get model resource base path
    const getModelBasePath = useCallback(async (modelName: string): Promise<string> => {
        // Check cache first
        if (modelPathCacheRef.current.has(modelName)) {
            return modelPathCacheRef.current.get(modelName)!;
        }

        // Get from API
        const fullPath = await getModelPath(modelName);
        if (fullPath) {
            // Extract base path (remove the .model3.json part)
            const basePath = fullPath.substring(0, fullPath.lastIndexOf('/'));
            modelPathCacheRef.current.set(modelName, basePath);
            return basePath;
        }

        // Fallback to default
        const defaultPath = `/Resources/${modelName}`;
        modelPathCacheRef.current.set(modelName, defaultPath);
        return defaultPath;
    }, []);

    // Initialize audio context for lip sync
    const initAudioContext = useCallback(() => {
        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 256;
            analyserRef.current.smoothingTimeConstant = 0.3;
        }
        return audioContextRef.current;
    }, []);

    // Get current volume from audio analyser (0-1 range)
    const getCurrentVolume = useCallback((): number => {
        if (!analyserRef.current) return 0;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        return sum / (dataArray.length * 255);
    }, []);

    // Set mouth opening value on the Live2D model
    const setMouthValue = useCallback((value: number) => {
        if (!modelRef.current) return;

        try {
            const internalModel = modelRef.current.internalModel;
            const coreModel = (internalModel as {
                coreModel?: {
                    setParameterValueById: (id: string, value: number, weight?: number) => void;
                }
            })?.coreModel;

            if (coreModel) {
                coreModel.setParameterValueById(LIP_SYNC_CONFIG.mouthParam, value, 1.0);
            }
        } catch {
            // Silently ignore errors
        }
    }, []);

    // Setup lip sync handler that hooks into model's update cycle
    const setupLipSyncHandler = useCallback(() => {
        if (!modelRef.current) return;

        // Remove existing handler
        if (lipSyncHandlerRef.current) {
            modelRef.current.internalModel.off('beforeModelUpdate', lipSyncHandlerRef.current);
        }

        // Create handler: volume -> mouth opening
        const handler = () => {
            if (!lipSyncActiveRef.current || !modelRef.current) return;

            // Get volume and apply threshold
            const volume = getCurrentVolume();
            const targetValue = volume < LIP_SYNC_CONFIG.volumeThreshold
                ? 0
                : Math.min(volume * LIP_SYNC_CONFIG.amplification, 1);

            // Smooth transition
            targetMouthValueRef.current = targetValue;
            currentMouthValueRef.current += (targetMouthValueRef.current - currentMouthValueRef.current) * LIP_SYNC_CONFIG.smoothing;

            // Apply to model
            setMouthValue(currentMouthValueRef.current);
        };

        lipSyncHandlerRef.current = handler;
        modelRef.current.internalModel.on('beforeModelUpdate', handler);
    }, [getCurrentVolume, setMouthValue]);

    // Start lip sync
    const startLipSync = useCallback(() => {
        lipSyncActiveRef.current = true;
        setupLipSyncHandler();
    }, [setupLipSyncHandler]);

    // Stop lip sync and smoothly close mouth
    const stopLipSync = useCallback(() => {
        lipSyncActiveRef.current = false;

        // Smoothly close mouth
        const closeInterval = setInterval(() => {
            currentMouthValueRef.current *= 0.7;
            if (currentMouthValueRef.current < 0.01) {
                currentMouthValueRef.current = 0;
                targetMouthValueRef.current = 0;
                setMouthValue(0);
                clearInterval(closeInterval);
            } else {
                setMouthValue(currentMouthValueRef.current);
            }
        }, 16);
    }, [setMouthValue]);

    // Play audio from URL with lip sync (for test button)
    const playAudioWithLipSync = useCallback(async (audioUrl: string): Promise<void> => {
        return new Promise((resolve, reject) => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }

            const ctx = initAudioContext();
            if (ctx.state === 'suspended') ctx.resume();

            setIsPlaying(true);
            const audio = new Audio(audioUrl);
            audioRef.current = audio;

            // Connect to analyser
            if (sourceNodeRef.current) {
                try { sourceNodeRef.current.disconnect(); } catch { /* ignore */ }
                sourceNodeRef.current = null;
            }
            try {
                sourceNodeRef.current = ctx.createMediaElementSource(audio);
                sourceNodeRef.current.connect(analyserRef.current!);
                analyserRef.current!.connect(ctx.destination);
            } catch { /* ignore */ }

            audio.onplay = () => startLipSync();
            audio.onended = () => {
                stopLipSync();
                setIsPlaying(false);
                resolve();
            };
            audio.onerror = (err) => {
                stopLipSync();
                setIsPlaying(false);
                reject(err);
            };
            audio.play().catch((err) => {
                stopLipSync();
                setIsPlaying(false);
                reject(err);
            });
        });
    }, [initAudioContext, startLipSync, stopLipSync]);

    // Handle test lip sync button
    const handleTestLipSync = useCallback(async () => {
        if (isPlaying) return;
        try {
            await playAudioWithLipSync(testAudioUrl);
        } catch (err) {
            console.error('[LipSync] Test failed:', err);
        }
    }, [isPlaying, playAudioWithLipSync]);

    // Audio queue for sequential playback
    const playbackQueueRef = useRef<{ audioData: string; text: string }[]>([]);
    const isPlayingQueueRef = useRef<boolean>(false);

    // Play audio from base64 data with lip sync
    const playBase64Audio = useCallback(async (audioData: string, text: string): Promise<void> => {
        const ctx = initAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();

        // Decode base64 to ArrayBuffer
        const binaryString = atob(audioData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // Decode and play audio
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;

        // Connect to analyser for lip sync
        source.connect(analyserRef.current!);
        analyserRef.current!.connect(ctx.destination);

        return new Promise((resolve, reject) => {
            setIsPlaying(true);
            startLipSync();

            source.onended = () => {
                stopLipSync();
                setIsPlaying(false);
                resolve();
            };

            try {
                source.start();
                console.log('[Audio] Playing:', text.substring(0, 30));
            } catch (err) {
                stopLipSync();
                setIsPlaying(false);
                reject(err);
            }
        });
    }, [initAudioContext, startLipSync, stopLipSync]);

    // Process playback queue sequentially
    const processPlaybackQueue = useCallback(async () => {
        if (isPlayingQueueRef.current || playbackQueueRef.current.length === 0) return;

        isPlayingQueueRef.current = true;

        while (playbackQueueRef.current.length > 0) {
            const item = playbackQueueRef.current.shift();
            if (item) {
                try {
                    await playBase64Audio(item.audioData, item.text);
                    await new Promise(resolve => setTimeout(resolve, 300)); // Gap between segments
                } catch (err) {
                    console.error('[Audio] Playback error:', err);
                }
            }
        }

        isPlayingQueueRef.current = false;

        // Notify server that playback is complete
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'playback_complete' }));
        }
    }, [playBase64Audio]);

    // Generate unique message ID
    const genMsgId = () => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Add chat message helper
    const addChatMessage = useCallback((type: 'user' | 'ai', text: string, source?: 'text' | 'voice') => {
        const msg: ChatMessage = {
            id: genMsgId(),
            type,
            text,
            source,
            timestamp: new Date(),
        };
        setChatMessages(prev => [...prev, msg]);
    }, []);

    // Calculate reconnection delay with exponential backoff
    const getReconnectDelay = useCallback((attempt: number): number => {
        const delay = Math.min(
            WS_RECONNECT_CONFIG.baseDelay * Math.pow(WS_RECONNECT_CONFIG.backoffFactor, attempt),
            WS_RECONNECT_CONFIG.maxDelay
        );
        return delay;
    }, []);

    // Setup WebSocket connection for audio
    const setupAudioWebSocket = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        // Clear any pending reconnect
        if (wsReconnectTimeoutRef.current) {
            clearTimeout(wsReconnectTimeoutRef.current);
            wsReconnectTimeoutRef.current = null;
        }

        console.log('[WS] Connecting to', AUDIO_WS_URL);
        const ws = new WebSocket(AUDIO_WS_URL);

        ws.onopen = () => {
            console.log('[WS] Connected');
            setWsConnected(true);
            wsReconnectAttemptsRef.current = 0; // Reset attempts on successful connection
            ws.send(JSON.stringify({ type: 'ready' }));
            // Request characters list on connect/reconnect
            ws.send(JSON.stringify({ type: 'command', command: 'get_characters' }));
        };

        ws.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);

                switch (msg.type) {
                    case 'audio':
                        playbackQueueRef.current.push({ audioData: msg.audio_data, text: msg.text || '' });
                        processPlaybackQueue();
                        break;

                    case 'user_message':
                        if (msg.source === 'voice') {
                            addChatMessage('user', msg.text || '', 'voice');
                        }
                        break;

                    case 'ai_message':
                        addChatMessage('ai', msg.text || '');
                        setIsProcessing(false);
                        break;

                    case 'status': {
                        setIsProcessing(msg.status === 'processing');
                        // Only update isListening based on status, don't override command_response
                        // The actual listening state is managed by toggle_listening command
                        break;
                    }

                    case 'characters_list':
                        setCharacters(msg.characters || []);
                        break;

                    case 'command_response':
                        if (msg.command === 'toggle_listening') {
                            setIsListening(msg.response?.listening || false);
                        } else if (msg.command === 'get_characters') {
                            setCharacters(msg.response?.characters || []);
                        } else if (msg.command === 'switch_character' && msg.response?.success) {
                            setCharacters(prev => prev.map(c => ({
                                ...c,
                                is_current: c.id === msg.response.current_character,
                            })));
                            // Clear chat messages when character is switched
                            setChatMessages([]);
                        }
                        break;

                    case 'audio_lock':
                        setIsAudioLocked(msg.locked);
                        if (msg.locked && msg.duration > 0) {
                            setTimeout(() => setIsAudioLocked(false), (msg.duration + 1) * 1000);
                        }
                        break;
                }
            } catch (err) {
                console.error('[WS] Parse error:', err);
            }
        };

        ws.onerror = (err) => {
            console.error('[WS] Error:', err);
        };

        ws.onclose = (event) => {
            console.log(`[WS] Disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`);
            wsRef.current = null;
            setWsConnected(false);

            // Schedule reconnection with exponential backoff
            const attempts = wsReconnectAttemptsRef.current;
            if (attempts < WS_RECONNECT_CONFIG.maxAttempts) {
                const delay = getReconnectDelay(attempts);
                console.log(`[WS] Reconnecting in ${delay}ms (attempt ${attempts + 1}/${WS_RECONNECT_CONFIG.maxAttempts})`);
                wsReconnectTimeoutRef.current = setTimeout(() => {
                    wsReconnectAttemptsRef.current += 1;
                    setupAudioWebSocket();
                }, delay);
            } else {
                console.error(`[WS] Max reconnection attempts (${WS_RECONNECT_CONFIG.maxAttempts}) reached`);
            }
        };

        wsRef.current = ws;
    }, [processPlaybackQueue, addChatMessage, getReconnectDelay]);

    // Send WebSocket message helper
    const sendWsMessage = useCallback((data: object) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(data));
            return true;
        }
        return false;
    }, []);

    // Send text input to backend
    const handleSendMessage = useCallback((text: string) => {
        if (!text.trim()) return;

        addChatMessage('user', text, 'text');
        setIsProcessing(true);

        if (!sendWsMessage({ type: 'text_input', text })) {
            setIsProcessing(false);
        }
    }, [addChatMessage, sendWsMessage]);

    // Toggle voice listening
    const handleToggleListening = useCallback((enabled: boolean) => {
        sendWsMessage({ type: 'command', command: 'toggle_listening', enabled });
    }, [sendWsMessage]);

    // Change character (switches both voice and persona)
    const handleCharacterChange = useCallback((characterId: string) => {
        sendWsMessage({ type: 'command', command: 'switch_character', character_id: characterId });
    }, [sendWsMessage]);

    const handlePlayAction = useCallback((action: string, sound?: string) => {
        if (!modelRef.current) {
            console.warn('Model not loaded yet');
            return;
        }

        let motionGroup = action;
        if (motionGroup.includes('@')) {
            motionGroup = motionGroup.replace('@', '');
        }

        // For VTuber Studio models, try motion by file name first, then fall back to group
        modelRef.current.motion(motionGroup, undefined, 3).catch((err) => {
            console.warn(`Motion playback failed for group "${motionGroup}":`, err);
            // Try to play by index 0 of the group as fallback
            modelRef.current?.motion(motionGroup, 0, 3).catch((err2) => {
                console.error('Motion playback failed completely:', err2);
            });
        });

        if (sound) {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
            const modelNameForAssets = activeModelNameRef.current || currentModel;
            if (!modelNameForAssets) {
                console.warn('Cannot resolve model name for audio playback yet');
                return;
            }

            // Get model base path dynamically
            getModelBasePath(modelNameForAssets).then(basePath => {
                const audio = new Audio(`${basePath}/${sound}`);
                audioRef.current = audio;
                audio.play().catch((err) => {
                    console.error('Failed to play sound:', err);
                });
            }).catch(err => {
                console.error('Failed to resolve model path:', err);
            });
        }
    }, [currentModel, getModelBasePath]);

    const handlePlayExpression = useCallback((expression: string) => {
        if (!modelRef.current) {
            console.warn('Model not loaded yet');
            return;
        }

        // Clear any existing reset timeout
        if (expressionResetTimeoutRef.current) {
            clearTimeout(expressionResetTimeoutRef.current);
            expressionResetTimeoutRef.current = null;
        }

        // Try to play expression - pixi-live2d-display will handle both by name and by file
        modelRef.current.expression(expression).then(() => {
            console.log(`[Expression] Playing: ${expression}`);

            // Set timeout to reset expression after 10 seconds
            expressionResetTimeoutRef.current = setTimeout(() => {
                if (modelRef.current?.internalModel?.motionManager?.expressionManager) {
                    console.log('[Expression] Resetting to default after timeout');
                    modelRef.current.internalModel.motionManager.expressionManager.resetExpression();
                }
                expressionResetTimeoutRef.current = null;
            }, EXPRESSION_RESET_DELAY);
        }).catch((err) => {
            console.warn(`Expression playback failed for "${expression}":`, err);
            // For VTuber Studio models, try with .exp3.json extension if not included
            if (!expression.endsWith('.exp3.json')) {
                modelRef.current?.expression(`${expression}.exp3.json`).then(() => {
                    // Set timeout for fallback expression too
                    expressionResetTimeoutRef.current = setTimeout(() => {
                        if (modelRef.current?.internalModel?.motionManager?.expressionManager) {
                            console.log('[Expression] Resetting to default after timeout');
                            modelRef.current.internalModel.motionManager.expressionManager.resetExpression();
                        }
                        expressionResetTimeoutRef.current = null;
                    }, EXPRESSION_RESET_DELAY);
                }).catch((err2) => {
                    console.error('Expression playback failed completely:', err2);
                });
            }
        });
    }, []);

    const handlePlaySound = useCallback((sound: string) => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }

        const modelNameForAssets = activeModelNameRef.current || currentModel;
        if (!modelNameForAssets) {
            console.warn('Cannot resolve model name for audio playback yet');
            return;
        }

        // Get model base path dynamically
        getModelBasePath(modelNameForAssets).then(basePath => {
            const audio = new Audio(`${basePath}/${sound}`);
            audioRef.current = audio;
            audio.play().catch((err) => {
                console.error('Failed to play sound:', err);
            });
        }).catch(err => {
            console.error('Failed to resolve model path:', err);
        });
    }, [currentModel, getModelBasePath]);

    const handleModelSwitch = useCallback(async (modelPath: string) => {
        if (!appRef.current) {
            console.warn('PIXI app not initialized yet');
            return;
        }

        try {
            console.log('[Live2D] Switching to model:', modelPath);

            // Dispose old model
            if (modelRef.current) {
                // Remove lip sync handler
                if (lipSyncHandlerRef.current) {
                    modelRef.current.internalModel.off('beforeModelUpdate', lipSyncHandlerRef.current);
                    lipSyncHandlerRef.current = null;
                }

                // Clear expression reset timeout
                if (expressionResetTimeoutRef.current) {
                    clearTimeout(expressionResetTimeoutRef.current);
                    expressionResetTimeoutRef.current = null;
                }

                if (idleRestoreRef.current) {
                    idleRestoreRef.current();
                    idleRestoreRef.current = null;
                }
                appRef.current.stage.removeChild(modelRef.current as unknown as PIXI.DisplayObject);
                modelRef.current.destroy();
                modelRef.current = null;
            }

            // Stop any playing audio
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current = null;
            }

            // Load new model
            const model = await Live2DModel.from(modelPath);
            modelRef.current = model;

            // Extract model name from path
            const modelNameMatch = modelPath.match(/\/Resources\/(?:Commercial_models\/)?([^/]+)\//);
            if (modelNameMatch) {
                const resolvedModelName = modelNameMatch[1];
                activeModelNameRef.current = resolvedModelName;
                setCurrentModel(resolvedModelName);

                // Update backend state
                await updateCurrentModelState(resolvedModelName);
            }

            // Disable idle motions
            const internalModel = model.internalModel as typeof model.internalModel | undefined;
            const motionManager = internalModel?.motionManager;
            if (motionManager?.state) {
                motionManager.stopAllMotions();
                motionManager.state.setReservedIdle?.(undefined, undefined);
                const originalShouldRequestIdleMotion = motionManager.state.shouldRequestIdleMotion.bind(motionManager.state);
                motionManager.state.shouldRequestIdleMotion = () => false;
                idleRestoreRef.current = () => {
                    motionManager.state.shouldRequestIdleMotion = originalShouldRequestIdleMotion;
                };
            }

            // Add to stage and position
            appRef.current.stage.addChild(model as unknown as PIXI.DisplayObject);
            model.anchor.set(0.5, 0.5);
            model.x = appRef.current.screen.width / 2;
            model.y = appRef.current.screen.height / 2;
            model.scale.set(0.2);

            // Setup lip sync handler for new model
            setupLipSyncHandler();

            console.log('[Live2D] Model switched successfully');
        } catch (error) {
            console.error('[Live2D] Failed to switch model:', error);
            alert(`切换模型失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }, [setupLipSyncHandler]);

    useEffect(() => {
        sseCallbacksRef.current = {
            playAction: handlePlayAction,
            playExpression: handlePlayExpression,
            playSound: handlePlaySound,
        };
    }, [handlePlayAction, handlePlayExpression, handlePlaySound]);

    useEffect(() => {
        if (!canvasRef.current || appRef.current) {
            return;
        }

        const setupPixi = async () => {
            try {
                await waitForLive2DCore();

                const Live2DCubismCore = live2dWindow.Live2DCubismCore;
                if (Live2DCubismCore) {
                    startUpCubism4({
                        loggingLevel: 2,
                        logFunction: (message: string) => console.log('[Live2D]', message),
                    });
                    await cubism4Ready();
                } else {
                    throw new Error('Live2D Core SDK not ready');
                }

                const app = new PIXI.Application({
                    view: canvasRef.current ?? undefined,
                    width: window.innerWidth,
                    height: window.innerHeight,
                    backgroundColor: 0x000000,
                    backgroundAlpha: 0.1,
                    autoStart: true,
                    antialias: true,
                });
                appRef.current = app;

                // Get the last model from the models list
                const resourcesData = await getActions();
                const models = resourcesData?.models ?? [];

                if (models.length === 0) {
                    throw new Error('No Live2D models found in Resources directories');
                }

                const defaultModelName = models[models.length - 1];

                // Get model path from API (required - no fallback)
                const modelPath = await getModelPath(defaultModelName);

                if (!modelPath) {
                    throw new Error(`Failed to resolve path for model "${defaultModelName}". Model metadata may be unavailable.`);
                }

                console.log(`[Live2D] Loading default model: ${defaultModelName} from ${modelPath}`);
                const model = await Live2DModel.from(modelPath);
                modelRef.current = model;

                activeModelNameRef.current = defaultModelName;
                setCurrentModel(defaultModelName);

                const internalModel = model.internalModel as typeof model.internalModel | undefined;
                const motionManager = internalModel?.motionManager;
                if (motionManager?.state) {
                    motionManager.stopAllMotions();
                    motionManager.state.setReservedIdle?.(undefined, undefined);
                    const originalShouldRequestIdleMotion = motionManager.state.shouldRequestIdleMotion.bind(motionManager.state);
                    motionManager.state.shouldRequestIdleMotion = () => false;
                    idleRestoreRef.current = () => {
                        motionManager.state.shouldRequestIdleMotion = originalShouldRequestIdleMotion;
                    };
                }

                app.stage.addChild(model as unknown as PIXI.DisplayObject);
                model.anchor.set(0.5, 0.5);
                model.x = app.screen.width / 2;
                model.y = app.screen.height / 2;
                model.scale.set(0.2);

                const handleResize = () => {
                    if (appRef.current && modelRef.current) {
                        appRef.current.renderer.resize(window.innerWidth, window.innerHeight);
                        modelRef.current.x = appRef.current.screen.width / 2;
                        modelRef.current.y = appRef.current.screen.height / 2;
                    }
                };
                window.addEventListener('resize', handleResize);
                resizeHandlerRef.current = handleResize;
            } catch (err) {
                console.error('Failed to initialise Live2D', err);
                if (canvasRef.current) {
                    const errorDiv = document.createElement('div');
                    errorDiv.style.cssText = `
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: rgba(255, 0, 0, 0.8);
                        color: white;
                        padding: 20px;
                        border-radius: 8px;
                        font-family: monospace;
                        z-index: 10000;
                    `;
                    errorDiv.textContent = `Live2D 初始化失败: ${err instanceof Error ? err.message : String(err)}`;
                    document.body.appendChild(errorDiv);
                }
            }
        };

        setupPixi();

        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }

            if (resizeHandlerRef.current) {
                window.removeEventListener('resize', resizeHandlerRef.current);
                resizeHandlerRef.current = null;
            }

            if (appRef.current) {
                appRef.current.destroy(true);
                appRef.current = null;
            }

            if (idleRestoreRef.current) {
                idleRestoreRef.current();
                idleRestoreRef.current = null;
            }

            // Cleanup lip sync
            if (lipSyncHandlerRef.current && modelRef.current) {
                modelRef.current.internalModel.off('beforeModelUpdate', lipSyncHandlerRef.current);
            }

            // Cleanup expression reset timeout
            if (expressionResetTimeoutRef.current) {
                clearTimeout(expressionResetTimeoutRef.current);
                expressionResetTimeoutRef.current = null;
            }

            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
        };
    }, []);

    // Setup lip sync handler when model is ready
    useEffect(() => {
        if (modelRef.current) {
            setupLipSyncHandler();
        }
    }, [currentModel, setupLipSyncHandler]);

    // Setup WebSocket for audio streaming
    useEffect(() => {
        // Delay WebSocket setup to allow other connections to establish
        const timer = setTimeout(() => {
            setupAudioWebSocket();
        }, 1000);

        return () => {
            clearTimeout(timer);
            // Clear any pending reconnect timeout
            if (wsReconnectTimeoutRef.current) {
                clearTimeout(wsReconnectTimeoutRef.current);
                wsReconnectTimeoutRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [setupAudioWebSocket]);

    useEffect(() => {
        if (!currentModel) {
            return;
        }
        updateCurrentModelState(currentModel).catch((error) => {
            console.error('Failed to sync current model state', error);
        });
    }, [currentModel]);

    useEffect(() => {
        if (eventSourceRef.current) {
            return;
        }

        const eventSource = new EventSource('/api/live2d/events');

        const handleActionEvent = (event: MessageEvent) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.action) {
                    sseCallbacksRef.current.playAction(payload.action, payload.sound);
                }
            } catch (error) {
                console.error('Failed to parse action payload', error);
            }
        };

        const handleExpressionEvent = (event: MessageEvent) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.expression) {
                    sseCallbacksRef.current.playExpression(payload.expression);
                }
            } catch (error) {
                console.error('Failed to parse expression payload', error);
            }
        };

        const handleSoundEvent = (event: MessageEvent) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.sound) {
                    sseCallbacksRef.current.playSound(payload.sound);
                }
            } catch (error) {
                console.error('Failed to parse sound payload', error);
            }
        };

        const handleModelSwitchEvent = (event: MessageEvent) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.modelPath) {
                    console.log('[Live2D SSE] Received model switch event:', payload);
                    handleModelSwitch(payload.modelPath);
                }
            } catch (error) {
                console.error('Failed to parse modelSwitch payload', error);
            }
        };

        eventSource.addEventListener('action', handleActionEvent);
        eventSource.addEventListener('expression', handleExpressionEvent);
        eventSource.addEventListener('sound', handleSoundEvent);
        eventSource.addEventListener('modelSwitch', handleModelSwitchEvent);
        eventSource.onerror = (error) => {
            console.error('Live2D SSE connection error', error);
        };
        eventSourceRef.current = eventSource;

        return () => {
            eventSource.removeEventListener('action', handleActionEvent);
            eventSource.removeEventListener('expression', handleExpressionEvent);
            eventSource.removeEventListener('sound', handleSoundEvent);
            eventSource.removeEventListener('modelSwitch', handleModelSwitchEvent);
            eventSource.close();
            eventSourceRef.current = null;
        };
    }, [handleModelSwitch]);

    return (
        <>
            <canvas
                ref={canvasRef}
                style={{ width: '100vw', height: '100vh' }}
            />
            <ChatPanel
                messages={chatMessages}
                onSendMessage={handleSendMessage}
                isProcessing={isProcessing}
                isListening={isListening}
                onToggleListening={handleToggleListening}
                characters={characters}
                onCharacterChange={handleCharacterChange}
                isAudioLocked={isAudioLocked}
                isConnected={wsConnected}
            />
            <ActionPanel
                currentModel={currentModel}
                onPlayAction={handlePlayAction}
                onPlayExpression={handlePlayExpression}
                onPlaySound={handlePlaySound}
                onModelSwitch={(modelName) => console.log('[ActionPanel] Model switch requested:', modelName)}
                onTestLipSync={handleTestLipSync}
                isPlaying={isPlaying}
            />
        </>
    );
};
