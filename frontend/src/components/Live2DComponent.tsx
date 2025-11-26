import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { startUpCubism4, cubism4Ready } from 'pixi-live2d-display/cubism4';
import { ActionPanel } from './ActionPanel';
import { VersionBadge } from './VersionBadge';
import { updateCurrentModelState } from '../api/live2d-api';

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

const live2dWindow = window as Live2DWindow;
live2dWindow.PIXI = PIXI;

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
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const handlePlayAction = useCallback((action: string, sound?: string) => {
        if (!modelRef.current) {
            console.warn('Model not loaded yet');
            return;
        }

        let motionGroup = action;
        if (motionGroup.includes('@')) {
            motionGroup = motionGroup.replace('@', '');
        }

        modelRef.current.motion(motionGroup, undefined, 3).catch((err) => {
            console.error('Failed to play motion:', err);
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
            const audio = new Audio(`/Resources/${modelNameForAssets}/${sound}`);
            audioRef.current = audio;
            audio.play().catch((err) => {
                console.error('Failed to play sound:', err);
            });
        }
    }, [currentModel]);

    const handlePlayExpression = useCallback((expression: string) => {
        if (!modelRef.current) {
            console.warn('Model not loaded yet');
            return;
        }

        modelRef.current.expression(expression).catch((err) => {
            console.error('Failed to play expression:', err);
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
        const audio = new Audio(`/Resources/${modelNameForAssets}/${sound}`);
        audioRef.current = audio;
        audio.play().catch((err) => {
            console.error('Failed to play sound:', err);
        });
    }, [currentModel]);

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
                    const logFunction = Live2DCubismCore.LogLevel_Verbose !== undefined
                        ? (message: string) => console.log('[Live2D]', message)
                        : undefined;
                    startUpCubism4({
                        logFunction,
                        loggingLevel: 2,
                    });
                    await cubism4Ready();
                } else {
                    throw new Error('Live2D Core SDK not ready');
                }

                const app = new PIXI.Application({
                    view: canvasRef.current,
                    width: window.innerWidth,
                    height: window.innerHeight,
                    backgroundColor: 0x000000,
                    backgroundAlpha: 0.1,
                    autoStart: true,
                    antialias: true,
                });
                appRef.current = app;

                const modelPath = '/Resources/Haru/Haru.model3.json';
                const model = await Live2DModel.from(modelPath);
                modelRef.current = model;

                const modelNameMatch = modelPath.match(/\/Resources\/([^/]+)\//);
                if (modelNameMatch) {
                    const resolvedModelName = modelNameMatch[1];
                    activeModelNameRef.current = resolvedModelName;
                    setCurrentModel(resolvedModelName);
                }

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
        };
    }, []);

    useEffect(() => {
        if (!currentModel) {
            return;
        }
        updateCurrentModelState(currentModel).catch((error) => {
            console.error('Failed to sync current model state', error);
        });
    }, [currentModel]);

    useEffect(() => {
        if (!import.meta.env.DEV) {
            return;
        }

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

        eventSource.addEventListener('action', handleActionEvent);
        eventSource.addEventListener('expression', handleExpressionEvent);
        eventSource.addEventListener('sound', handleSoundEvent);
        eventSource.onerror = (error) => {
            console.error('Live2D SSE connection error', error);
        };
        eventSourceRef.current = eventSource;

        return () => {
            eventSource.removeEventListener('action', handleActionEvent);
            eventSource.removeEventListener('expression', handleExpressionEvent);
            eventSource.removeEventListener('sound', handleSoundEvent);
            eventSource.close();
            eventSourceRef.current = null;
        };
    }, []);

    return (
        <>
            <VersionBadge />
            <canvas
                ref={canvasRef}
                style={{ width: '100vw', height: '100vh' }}
            />
            <ActionPanel
                currentModel={currentModel}
                onPlayAction={handlePlayAction}
                onPlayExpression={handlePlayExpression}
                onPlaySound={handlePlaySound}
            />
        </>
    );
};
