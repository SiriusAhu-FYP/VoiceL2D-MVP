import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { startUpCubism4, cubism4Ready } from 'pixi-live2d-display/cubism4';
import { ActionPanel } from './ActionPanel';
import { ChatPanel, ChatMessage, VoiceInfo } from './ChatPanel';
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

// Lip sync configuration - optimized for larger mouth movements
const LIP_SYNC_CONFIG = {
    // Smoothing factors (lower = faster response)
    openSmoothing: 0.5,

    // Volume thresholds - lowered for more sensitivity
    minVolume: 0.005,
    maxVolume: 0.15,

    // Amplification for larger movements
    amplification: 2.5,

    // Live2D parameter IDs for mouth
    mouthOpenParam: 'ParamMouthOpenY',

    // Update rate
    updateRate: 60,
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
    const [statusText, setStatusText] = useState<string>('');
    const [isListening, setIsListening] = useState<boolean>(false);
    const [voices, setVoices] = useState<VoiceInfo[]>([]);

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
            analyserRef.current.smoothingTimeConstant = 0.5;
            console.log('[LipSync] Audio context initialized');
        }
        return audioContextRef.current;
    }, []);

    // Get current volume from audio analyser
    const getCurrentVolume = useCallback((): number => {
        if (!analyserRef.current) return 0;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate RMS volume from frequency data
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length) / 255;

        return rms;
    }, []);

    // Setup lip sync handler that hooks into model's update cycle
    const setupLipSyncHandler = useCallback(() => {
        if (!modelRef.current) return;

        // Remove existing handler
        if (lipSyncHandlerRef.current) {
            modelRef.current.internalModel.off('beforeModelUpdate', lipSyncHandlerRef.current);
        }

        // Create new handler that updates mouth parameter during model update
        const handler = () => {
            if (!lipSyncActiveRef.current || !modelRef.current) return;

            // Get current audio volume
            const volume = getCurrentVolume();

            // Normalize and amplify volume
            let normalizedVolume = Math.min(
                Math.max((volume - LIP_SYNC_CONFIG.minVolume) / (LIP_SYNC_CONFIG.maxVolume - LIP_SYNC_CONFIG.minVolume), 0),
                1
            );

            // Apply amplification
            normalizedVolume = Math.min(normalizedVolume * LIP_SYNC_CONFIG.amplification, 1);

            // Set target value
            targetMouthValueRef.current = normalizedVolume;

            // Smooth transition
            currentMouthValueRef.current += (targetMouthValueRef.current - currentMouthValueRef.current) * LIP_SYNC_CONFIG.openSmoothing;

            // Apply to model using the correct API
            try {
                const internalModel = modelRef.current.internalModel;
                const coreModel = (internalModel as {
                    coreModel?: {
                        setParameterValueById: (id: string, value: number, weight?: number) => void;
                        getParameterIndex: (id: string) => number;
                        setParameterValueByIndex: (index: number, value: number, weight?: number) => void;
                    }
                })?.coreModel;

                if (coreModel) {
                    // Try to set parameter by ID first
                    const paramIndex = coreModel.getParameterIndex(LIP_SYNC_CONFIG.mouthOpenParam);
                    if (paramIndex >= 0) {
                        coreModel.setParameterValueByIndex(paramIndex, currentMouthValueRef.current, 1.0);
                    } else {
                        // Fallback to setParameterValueById
                        coreModel.setParameterValueById(LIP_SYNC_CONFIG.mouthOpenParam, currentMouthValueRef.current, 1.0);
                    }
                }
            } catch (err) {
                // Log error once
                if (currentMouthValueRef.current > 0.1) {
                    console.warn('[LipSync] Failed to set mouth parameter:', err);
                }
            }
        };

        lipSyncHandlerRef.current = handler;
        modelRef.current.internalModel.on('beforeModelUpdate', handler);
        console.log('[LipSync] Handler attached to model');
    }, [getCurrentVolume]);

    // Start lip sync
    const startLipSync = useCallback(() => {
        lipSyncActiveRef.current = true;
        setupLipSyncHandler();
        console.log('[LipSync] Started');
    }, [setupLipSyncHandler]);

    // Stop lip sync
    const stopLipSync = useCallback(() => {
        lipSyncActiveRef.current = false;

        // Smoothly close mouth
        const closeInterval = setInterval(() => {
            currentMouthValueRef.current *= 0.7;
            if (currentMouthValueRef.current < 0.01) {
                currentMouthValueRef.current = 0;
                targetMouthValueRef.current = 0;
                clearInterval(closeInterval);
            }
        }, 16);

        console.log('[LipSync] Stopped');
    }, []);

    // Connect audio element to analyser for lip sync
    const connectAudioToAnalyser = useCallback((audioElement: HTMLAudioElement) => {
        const ctx = initAudioContext();

        // Resume context if suspended (browser autoplay policy)
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        // Each new audio element needs its own MediaElementSource
        // Disconnect previous source if exists
        if (sourceNodeRef.current) {
            try {
                sourceNodeRef.current.disconnect();
            } catch {
                // Ignore disconnect errors
            }
            sourceNodeRef.current = null;
        }

        // Create new source node for this audio element
        try {
            sourceNodeRef.current = ctx.createMediaElementSource(audioElement);
            sourceNodeRef.current.connect(analyserRef.current!);
            analyserRef.current!.connect(ctx.destination);
        } catch (err) {
            // If this audio element was already connected, just log and continue
            console.warn('[LipSync] Could not create media element source:', err);
        }
    }, [initAudioContext]);

    // Play audio with lip sync
    const playAudioWithLipSync = useCallback(async (audioUrl: string): Promise<void> => {
        return new Promise((resolve, reject) => {
            // Stop any existing audio
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }

            setIsPlaying(true);

            const audio = new Audio(audioUrl);
            audioRef.current = audio;

            // Connect to analyser before playing
            connectAudioToAnalyser(audio);

            audio.onplay = () => {
                startLipSync();
            };

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
    }, [connectAudioToAnalyser, startLipSync, stopLipSync]);

    // Handle test lip sync with default audio
    const handleTestLipSync = useCallback(async () => {
        if (isPlaying) {
            console.log('[LipSync] Already playing, ignoring request');
            return;
        }

        console.log('[LipSync] Testing with default audio');
        try {
            await playAudioWithLipSync(testAudioUrl);
            console.log('[LipSync] Test completed');
        } catch (err) {
            console.error('[LipSync] Test failed:', err);
        }
    }, [isPlaying, playAudioWithLipSync]);

    // Audio queue for sequential playback
    const playbackQueueRef = useRef<{ audioData: string; text: string }[]>([]);
    const isPlayingQueueRef = useRef<boolean>(false);

    // Play audio from base64 data with lip sync
    const playBase64Audio = useCallback(async (audioData: string, text: string): Promise<void> => {
        return new Promise(async (resolve, reject) => {
            try {
                const ctx = initAudioContext();
                if (ctx.state === 'suspended') {
                    await ctx.resume();
                }

                // Decode base64 to ArrayBuffer
                const binaryString = atob(audioData);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                // Decode audio data
                const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;

                // Connect to analyser for lip sync
                source.connect(analyserRef.current!);
                analyserRef.current!.connect(ctx.destination);

                setIsPlaying(true);
                startLipSync();

                source.onended = () => {
                    stopLipSync();
                    setIsPlaying(false);
                    resolve();
                };

                source.start();
                console.log('[AudioWS] Playing audio for:', text.substring(0, 30));
            } catch (err) {
                console.error('[AudioWS] Failed to play audio:', err);
                stopLipSync();
                setIsPlaying(false);
                reject(err);
            }
        });
    }, [initAudioContext, startLipSync, stopLipSync]);

    // Process playback queue sequentially
    const processPlaybackQueue = useCallback(async () => {
        if (isPlayingQueueRef.current) return;
        if (playbackQueueRef.current.length === 0) return;

        isPlayingQueueRef.current = true;

        while (playbackQueueRef.current.length > 0) {
            const item = playbackQueueRef.current.shift();
            if (item) {
                try {
                    await playBase64Audio(item.audioData, item.text);
                    // 0.5 second delay between segments as requested
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (err) {
                    console.error('[AudioWS] Error in playback queue:', err);
                }
            }
        }

        isPlayingQueueRef.current = false;

        // Notify server that playback is complete
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'playback_complete' }));
        }
    }, [playBase64Audio]);

    // Setup WebSocket connection for audio
    const setupAudioWebSocket = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            return;
        }

        console.log('[AudioWS] Connecting to', AUDIO_WS_URL);
        const ws = new WebSocket(AUDIO_WS_URL);

        ws.onopen = () => {
            console.log('[AudioWS] Connected');
            ws.send(JSON.stringify({ type: 'ready' }));
        };

        ws.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'connected') {
                    console.log('[AudioWS] Received welcome message');
                } else if (msg.type === 'audio') {
                    // Received audio data - add to queue
                    console.log('[AudioWS] Received audio for:', msg.text?.substring(0, 30));
                    playbackQueueRef.current.push({
                        audioData: msg.audio_data,
                        text: msg.text || '',
                    });
                    // Start processing queue if not already
                    processPlaybackQueue();
                } else if (msg.type === 'user_message') {
                    // Received user message from voice input (text input is added optimistically)
                    // Only add if source is 'voice' to avoid duplicates
                    if (msg.source === 'voice') {
                        console.log('[AudioWS] User message (voice):', msg.text?.substring(0, 30));
                        const newMessage: ChatMessage = {
                            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            type: 'user',
                            text: msg.text || '',
                            source: 'voice',
                            timestamp: new Date(),
                        };
                        setChatMessages(prev => [...prev, newMessage]);
                    }
                } else if (msg.type === 'ai_message') {
                    // Received AI response
                    console.log('[AudioWS] AI message:', msg.text?.substring(0, 30));
                    const newMessage: ChatMessage = {
                        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'ai',
                        text: msg.text || '',
                        timestamp: new Date(),
                    };
                    setChatMessages(prev => [...prev, newMessage]);
                    setIsProcessing(false);
                } else if (msg.type === 'status') {
                    // Status update
                    console.log('[AudioWS] Status:', msg.status);
                    const statusMap: Record<string, string> = {
                        'listening': '正在聆听...',
                        'processing': '处理中...',
                        'speaking': '正在回复...',
                        'idle': '',
                    };
                    setStatusText(statusMap[msg.status] || msg.message || '');
                    setIsProcessing(msg.status === 'processing');
                    // Update listening state based on status
                    if (msg.status === 'listening') {
                        setIsListening(true);
                    } else if (msg.status === 'idle') {
                        // Keep listening state, only idle status doesn't change it
                    }
                } else if (msg.type === 'voices_list') {
                    // Received list of available voices
                    console.log('[AudioWS] Voices list:', msg.voices);
                    setVoices(msg.voices || []);
                } else if (msg.type === 'command_response') {
                    // Response to a command
                    console.log('[AudioWS] Command response:', msg.command, msg.response);
                    if (msg.command === 'toggle_listening') {
                        setIsListening(msg.response?.listening || false);
                    } else if (msg.command === 'get_voices') {
                        setVoices(msg.response?.voices || []);
                    } else if (msg.command === 'switch_voice') {
                        // Update voices list to reflect current voice
                        if (msg.response?.success && msg.response?.current_voice) {
                            setVoices(prev => prev.map(v => ({
                                ...v,
                                is_current: v.name === msg.response.current_voice,
                            })));
                        }
                    }
                } else if (msg.type === 'pong') {
                    // Heartbeat response
                }
            } catch (err) {
                console.error('[AudioWS] Failed to parse message:', err);
            }
        };

        ws.onerror = (err) => {
            console.error('[AudioWS] Error:', err);
        };

        ws.onclose = () => {
            console.log('[AudioWS] Disconnected');
            wsRef.current = null;
            // Attempt reconnect after delay
            setTimeout(() => {
                if (!wsRef.current) {
                    setupAudioWebSocket();
                }
            }, 5000);
        };

        wsRef.current = ws;
    }, [processPlaybackQueue]);

    // Send text input to backend via WebSocket
    const handleSendMessage = useCallback((text: string) => {
        if (!text.trim()) return;

        // Add user message to chat immediately (optimistic update)
        const newMessage: ChatMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'user',
            text: text,
            source: 'text',
            timestamp: new Date(),
        };
        setChatMessages(prev => [...prev, newMessage]);
        setIsProcessing(true);
        setStatusText('处理中...');

        // Send to backend
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'text_input',
                text: text,
            }));
            console.log('[AudioWS] Sent text input:', text.substring(0, 30));
        } else {
            console.error('[AudioWS] WebSocket not connected');
            setIsProcessing(false);
            setStatusText('连接断开');
        }
    }, []);

    // Toggle voice listening
    const handleToggleListening = useCallback((enabled: boolean) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'command',
                command: 'toggle_listening',
                enabled: enabled,
            }));
            console.log('[AudioWS] Toggle listening:', enabled);
        } else {
            console.error('[AudioWS] WebSocket not connected');
        }
    }, []);

    // Change TTS voice
    const handleVoiceChange = useCallback((voiceName: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'command',
                command: 'switch_voice',
                voice_name: voiceName,
            }));
            console.log('[AudioWS] Switch voice:', voiceName);
        } else {
            console.error('[AudioWS] WebSocket not connected');
        }
    }, []);

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
                statusText={statusText}
                isListening={isListening}
                onToggleListening={handleToggleListening}
                voices={voices}
                onVoiceChange={handleVoiceChange}
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
