/**
 * Live2D 动作控制浮窗组件
 * 显示在右下角，包含动作按钮和控制按钮
 */

import React, { useState, useEffect } from 'react';
import { getActions, playAction, playExpression, playSound, type ResourcesData, type MotionInfo } from '../api/live2d-api';
import './ActionPanel.css';

interface ActionPanelProps {
    currentModel: string; // 当前模型名称，如 'Mao', 'Haru'
    onPlayAction?: (action: string, sound?: string) => void;
    onPlayExpression?: (expression: string) => void;
    onPlaySound?: (sound: string) => void;
}

export const ActionPanel: React.FC<ActionPanelProps> = ({
    currentModel,
    onPlayAction,
    onPlayExpression,
    onPlaySound
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [resourcesData, setResourcesData] = useState<ResourcesData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 加载动作列表
        const loadActions = async () => {
            setLoading(true);
            const data = await getActions();
            setResourcesData(data);
            setLoading(false);
        };
        loadActions();
    }, []);

    const handlePlayAction = async (motion: MotionInfo) => {
        // 先调用本地回调（如果存在）
        if (onPlayAction) {
            onPlayAction(motion.group, motion.sound);
        }
        // 同时调用API（传递动作组名称）
        await playAction(motion.group, motion.sound);
    };

    const handlePlayExpression = async (expressionName: string) => {
        if (onPlayExpression) {
            onPlayExpression(expressionName);
        }
        await playExpression(expressionName);
    };

    const handlePlaySound = async (sound: string) => {
        if (onPlaySound) {
            onPlaySound(sound);
        }
        await playSound(sound);
    };

    const currentModelActions = resourcesData?.actions[currentModel];
    const motions = currentModelActions?.motions || [];
    const expressions = currentModelActions?.expressions || [];
    const sounds = currentModelActions?.sounds || [];

    // 按组分类动作
    const motionsByGroup = motions.reduce((acc, motion) => {
        if (!acc[motion.group]) {
            acc[motion.group] = [];
        }
        acc[motion.group].push(motion);
        return acc;
    }, {} as Record<string, MotionInfo[]>);

    return (
        <>
            {/* 切换按钮 */}
            <button
                className="action-panel-toggle"
                onClick={() => setIsVisible(!isVisible)}
                title={isVisible ? '隐藏动作面板' : '显示动作面板'}
            >
                {isVisible ? '▼' : '▲'}
            </button>

            {/* 动作面板 */}
            {isVisible && (
                <div className="action-panel">
                    <div className="action-panel-header">
                        <h3>动作控制</h3>
                        <button
                            className="action-panel-close"
                            onClick={() => setIsVisible(false)}
                        >
                            ×
                        </button>
                    </div>

                    <div className="action-panel-content">
                        {loading ? (
                            <div className="action-panel-loading">加载中...</div>
                        ) : (
                            <>
                                {/* 动作按钮 */}
                                {Object.keys(motionsByGroup).length > 0 && (
                                    <div className="action-section">
                                        <h4>动作</h4>
                                        <div className="action-buttons">
                                            {Object.entries(motionsByGroup).map(([group, groupMotions]) => (
                                                <div key={group} className="action-group">
                                                    <span className="action-group-label">{group}</span>
                                                    <div className="action-group-buttons">
                                                        {groupMotions.map((motion, index) => (
                                                            <button
                                                                key={`${motion.group}_${index}`}
                                                                className="action-button"
                                                                onClick={() => handlePlayAction(motion)}
                                                                title={motion.sound ? `播放动作 + 声音` : '播放动作'}
                                                            >
                                                                {motion.group.replace(/^Tap/, '点击')}
                                                                {index > 0 && ` ${index + 1}`}
                                                                {motion.sound && ' 🔊'}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* 表情按钮 */}
                                {expressions.length > 0 && (
                                    <div className="action-section">
                                        <h4>表情</h4>
                                        <div className="action-buttons">
                                            {expressions.map((expr) => (
                                                <button
                                                    key={expr.name}
                                                    className="action-button expression-button"
                                                    onClick={() => handlePlayExpression(expr.name)}
                                                >
                                                    {expr.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* 声音按钮 */}
                                {sounds.length > 0 && (
                                    <div className="action-section">
                                        <h4>声音 🔊</h4>
                                        <div className="action-buttons">
                                            {sounds.map((sound, index) => {
                                                const soundName = sound.split('/').pop()?.replace(/\.(wav|mp3|ogg)$/i, '') || `Sound ${index + 1}`;
                                                return (
                                                    <button
                                                        key={sound}
                                                        className="action-button sound-button"
                                                        onClick={() => handlePlaySound(sound)}
                                                    >
                                                        🔊 {soundName}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {motions.length === 0 && expressions.length === 0 && sounds.length === 0 && (
                                    <div className="action-panel-empty">
                                        当前模型没有可用的动作、表情或声音
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

