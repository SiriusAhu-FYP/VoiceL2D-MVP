import React, { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { startUpCubism4, cubism4Ready } from 'pixi-live2d-display/cubism4';
import { ActionPanel } from './ActionPanel';

//  hack: 告诉插件 PIXI 实例在哪里
(window as any).PIXI = PIXI;

// 等待 Live2D Core SDK 加载完成
const waitForLive2DCore = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        // 检查是否已经加载
        if ((window as any).Live2DCubismCore) {
            resolve();
            return;
        }

        // 等待加载
        let attempts = 0;
        const maxAttempts = 50; // 最多等待5秒

        const checkInterval = setInterval(() => {
            attempts++;
            if ((window as any).Live2DCubismCore) {
                clearInterval(checkInterval);
                resolve();
            } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                reject(new Error('Live2D Core SDK 加载超时'));
            }
        }, 100);
    });
};

export const Live2DComponent: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const modelRef = useRef<Live2DModel | null>(null);
    const resizeHandlerRef = useRef<(() => void) | null>(null);
    const [currentModel, setCurrentModel] = useState<string>('Mao');
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // 播放动作的函数
    const handlePlayAction = (action: string, sound?: string) => {
        if (!modelRef.current) {
            console.warn('Model not loaded yet');
            return;
        }

        // 播放动作 - 修正动作组名称格式
        // action可能是 "TapBody" 或 "Tap@Body"，需要转换为 "TapBody"
        let motionGroup = action;
        if (motionGroup.includes('@')) {
            motionGroup = motionGroup.replace('@', '');
        }

        modelRef.current.motion(motionGroup, undefined, 3).catch((err) => {
            console.error('Failed to play motion:', err);
        });

        // 播放声音（如果有）
        if (sound) {
            // 停止之前的音频
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }

            // 创建新的音频
            const audio = new Audio(`/Resources/${currentModel}/${sound}`);
            audioRef.current = audio;
            audio.play().catch((err) => {
                console.error('Failed to play sound:', err);
            });
        }
    };

    // 播放表情的函数
    const handlePlayExpression = (expression: string) => {
        if (!modelRef.current) {
            console.warn('Model not loaded yet');
            return;
        }

        modelRef.current.expression(expression).catch((err) => {
            console.error('Failed to play expression:', err);
        });
    };

    // 播放声音的函数
    const handlePlaySound = (sound: string) => {
        // 停止之前的音频
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }

        // 创建新的音频
        const audio = new Audio(`/Resources/${currentModel}/${sound}`);
        audioRef.current = audio;
        audio.play().catch((err) => {
            console.error('Failed to play sound:', err);
        });
    };

    useEffect(() => {
        // 立即检查 canvas 是否存在
        if (!canvasRef.current) {
            return;
        }

        // 在 React 严格模式下，useEffect 会运行两次。
        // 我们只在 appRef.current 为 null 时才初始化
        if (appRef.current) {
            return;
        }

        const setupPixi = async () => {
            try {
                // 1. 等待 Live2D Core SDK 加载完成
                console.log('等待 Live2D Core SDK 加载...');
                await waitForLive2DCore();
                console.log('Live2D Core SDK 已加载');

                // 2. 启动 Cubism 4 框架
                const Live2DCubismCore = (window as any).Live2DCubismCore;
                if (Live2DCubismCore) {
                    startUpCubism4({
                        logFunction: Live2DCubismCore.LogLevel_Verbose !== undefined
                            ? (message: string) => console.log('[Live2D]', message)
                            : undefined as any,
                        loggingLevel: 2, // LogLevel_Info
                    });
                    // 等待 Cubism 4 框架准备就绪
                    await cubism4Ready();
                    console.log('Cubism 4 框架已启动');
                } else {
                    throw new Error('Live2D Core SDK 未正确加载');
                }

                // 3. 创建 App 实例 (pixi.js v6 使用同步初始化)
                const app = new PIXI.Application({
                    view: canvasRef.current!,
                    width: window.innerWidth,
                    height: window.innerHeight,
                    backgroundColor: 0x000000,
                    backgroundAlpha: 0.1,
                    autoStart: true,
                    antialias: true,
                });

                // 4. 只有在 init 成功后，才将 app 实例存入 ref
                appRef.current = app;

                // 5. 加载模型
                console.log('开始加载 Live2D 模型...');
                const modelPath = '/Resources/Mao/Mao.model3.json';
                const model = await Live2DModel.from(modelPath);
                console.log('Live2D 模型加载成功');

                modelRef.current = model;

                // 提取模型名称
                const modelNameMatch = modelPath.match(/\/Resources\/([^\/]+)\//);
                if (modelNameMatch) {
                    setCurrentModel(modelNameMatch[1]);
                }

                app.stage.addChild(model as any);

                // 设置模型
                model.anchor.set(0.5, 0.5);
                model.x = app.screen.width / 2;
                model.y = app.screen.height / 2;
                model.scale.set(0.2);

                // 启用自动交互（使用类型断言）
                (model as any).interactive = true;
                (model as any).buttonMode = true;

                // 添加点击事件
                model.on('pointerdown', (event: any) => {
                    const hitAreas = model.hitTest(event.data.global.x, event.data.global.y);
                    if (hitAreas.includes('Body')) {
                        model.motion('TapBody', undefined, 3);
                    }
                });

                // 添加窗口大小调整处理
                const handleResize = () => {
                    if (appRef.current) {
                        appRef.current.renderer.resize(window.innerWidth, window.innerHeight);
                        model.x = appRef.current.screen.width / 2;
                        model.y = appRef.current.screen.height / 2;
                    }
                };
                window.addEventListener('resize', handleResize);
                resizeHandlerRef.current = handleResize;

            } catch (err) {
                console.error("初始化或加载 L2D 失败:", err);
                // 显示错误信息到页面
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
                    errorDiv.textContent = `Live2D 加载失败: ${err instanceof Error ? err.message : String(err)}`;
                    document.body.appendChild(errorDiv);
                }
            }
        };

        setupPixi();

        // 组件卸载时的 cleanup
        return () => {
            // 停止音频
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            // 移除 resize 事件监听器
            if (resizeHandlerRef.current) {
                window.removeEventListener('resize', resizeHandlerRef.current);
                resizeHandlerRef.current = null;
            }
            // 检查 appRef.current 是否存在并且确实是一个 Pixi App
            if (appRef.current) {
                appRef.current.destroy(true);
                appRef.current = null;
            }
        };
    }, []); // 空依赖数组，确保只运行一次

    // 设置全局回调供API使用（在组件挂载后）
    useEffect(() => {
        if (modelRef.current) {
            // 延迟设置，确保modelRef已经设置
            setTimeout(() => {
                if ((window as any).__live2dSetCallbacks) {
                    (window as any).__live2dSetCallbacks(
                        (action: string, sound?: string) => {
                            handlePlayAction(action, sound);
                        },
                        (expression: string) => {
                            handlePlayExpression(expression);
                        },
                        (sound: string) => {
                            handlePlaySound(sound);
                        }
                    );
                }
            }, 1000);
        }
    }, [currentModel]);

    return (
        <>
            <canvas
                ref={canvasRef}
                style={{ width: '100vw', height: '100vh' }} // 确保 canvas 占满屏幕
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