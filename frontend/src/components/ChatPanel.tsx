/**
 * Chat Panel Component
 *
 * Displays conversation history with bubble-style messages,
 * provides an input box for user text input,
 * and includes voice input toggle and character selector.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import './ChatPanel.css';

export interface ChatMessage {
    id: string;
    type: 'user' | 'ai';
    text: string;
    source?: 'voice' | 'text';
    timestamp: Date;
}

export interface CharacterInfo {
    id: string;
    name: string;
    description: string;
    is_current: boolean;
}

export interface ChatPanelProps {
    /** Messages to display (optional - can be managed externally) */
    messages?: ChatMessage[];
    /** Callback when user sends a message */
    onSendMessage?: (text: string) => void;
    /** Whether the system is currently processing */
    isProcessing?: boolean;
    /** Whether voice input is enabled */
    isListening?: boolean;
    /** Callback to toggle voice input */
    onToggleListening?: (enabled: boolean) => void;
    /** Available characters */
    characters?: CharacterInfo[];
    /** Callback when character is changed */
    onCharacterChange?: (characterId: string) => void;
    /** Whether audio playback is locking the microphone */
    isAudioLocked?: boolean;
    /** Whether WebSocket is connected to backend */
    isConnected?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
    messages: externalMessages,
    onSendMessage,
    isProcessing = false,
    isListening = false,
    onToggleListening,
    characters = [],
    onCharacterChange,
    isAudioLocked = false,
    isConnected = true,
}) => {
    // Use external messages if provided, otherwise use internal state
    const [internalMessages, setInternalMessages] = useState<ChatMessage[]>([]);
    const messages = externalMessages ?? internalMessages;

    const [inputText, setInputText] = useState('');
    const [isExpanded, setIsExpanded] = useState(true);
    const [showCharacterSelector, setShowCharacterSelector] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll to bottom when new messages arrive
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    // Add a new message to the chat (only used when managing internal state)
    const addMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
        if (externalMessages) return; // Don't add if messages are managed externally

        const newMessage: ChatMessage = {
            ...message,
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
        };
        setInternalMessages(prev => [...prev, newMessage]);
    }, [externalMessages]);

    // Handle sending a message
    const handleSend = useCallback(() => {
        const text = inputText.trim();
        if (!text || isProcessing) return;

        // Add user message to chat (only if not externally managed)
        if (!externalMessages) {
            addMessage({
                type: 'user',
                text,
                source: 'text',
            });
        }

        // Clear input
        setInputText('');

        // Notify parent
        if (onSendMessage) {
            onSendMessage(text);
        }
    }, [inputText, isProcessing, externalMessages, addMessage, onSendMessage]);

    // Handle keyboard input
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    // Handle voice toggle
    const handleVoiceToggle = useCallback(() => {
        if (onToggleListening) {
            onToggleListening(!isListening);
        }
    }, [isListening, onToggleListening]);

    // Handle character selection
    const handleCharacterSelect = useCallback((characterId: string) => {
        if (onCharacterChange) {
            onCharacterChange(characterId);
        }
        setShowCharacterSelector(false);
    }, [onCharacterChange]);

    // Format timestamp
    const formatTime = (date: Date): string => {
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Get current character
    const currentCharacter = characters.find(c => c.is_current);

    return (
        <div className={`chat-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
            {/* Header */}
            <div className="chat-panel-header" onClick={() => setIsExpanded(!isExpanded)}>
                <span className="chat-panel-title">
                    对话
                    <span
                        className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}
                        title={isConnected ? '已连接' : '连接断开，正在重连...'}
                    />
                </span>
                <button
                    className="chat-panel-toggle"
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsExpanded(!isExpanded);
                    }}
                >
                    {isExpanded ? '−' : '+'}
                </button>
            </div>

            {isExpanded && (
                <>
                    {/* Control Bar - Character Selector */}
                    <div className="chat-control-bar">
                        {/* Character Selector */}
                        <div className="character-selector-container">
                            <button
                                className="character-selector-btn"
                                onClick={() => setShowCharacterSelector(!showCharacterSelector)}
                                title="切换角色"
                            >
                                <span className="character-selector-icon">👤</span>
                                <span className="character-selector-label">
                                    {currentCharacter?.name || '选择角色'}
                                </span>
                                <span className="character-selector-arrow">
                                    {showCharacterSelector ? '▲' : '▼'}
                                </span>
                            </button>

                            {showCharacterSelector && (
                                <div className="character-selector-dropdown">
                                    <div className="character-selector-header">
                                        角色列表
                                        <span className="character-selector-hint">
                                            配置文件: charas.toml
                                        </span>
                                    </div>
                                    {characters.length > 0 ? (
                                        characters.map((character) => (
                                            <button
                                                key={character.id}
                                                className={`character-option ${character.is_current ? 'active' : ''}`}
                                                onClick={() => handleCharacterSelect(character.id)}
                                            >
                                                <span className="character-option-name">
                                                    {character.name}
                                                </span>
                                                <span className="character-option-hint">
                                                    {character.description}
                                                </span>
                                                {character.is_current && (
                                                    <span className="character-option-check">✓</span>
                                                )}
                                            </button>
                                        ))
                                    ) : (
                                        <div className="character-option-empty">
                                            未连接到后端服务
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Messages Area */}
                    <div className="chat-messages">
                        {messages.length === 0 ? (
                            <div className="chat-empty">
                                <span>开始对话吧...</span>
                                <span className="chat-empty-hint">
                                    {isListening ? '正在聆听语音...' : '开启语音输入或在下方输入文字'}
                                </span>
                            </div>
                        ) : (
                            messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`chat-message ${msg.type}`}
                                >
                                    <div className="chat-bubble">
                                        <span className="chat-text">{msg.text}</span>
                                        <span className="chat-meta">
                                            {msg.source === 'voice' && (
                                                <span className="chat-source">🎤</span>
                                            )}
                                            <span className="chat-time">
                                                {formatTime(msg.timestamp)}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}

                        {/* Processing indicator */}
                        {isProcessing && (
                            <div className="chat-message ai">
                                <div className="chat-bubble typing">
                                    <span className="typing-indicator">
                                        <span></span>
                                        <span></span>
                                        <span></span>
                                    </span>
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="chat-input-area">
                        {/* Recording Button */}
                        <button
                            className={`record-btn ${isListening ? 'recording' : ''} ${isAudioLocked ? 'locked' : ''}`}
                            onClick={handleVoiceToggle}
                            disabled={isProcessing || isAudioLocked}
                            title={isAudioLocked ? '语音播放中...' : (isListening ? '停止录音' : '开始录音')}
                        >
                            {isAudioLocked ? '🔇' : (isListening ? '⏺️录音中...' : '🎙录音')}
                        </button>

                        <input
                            ref={inputRef}
                            type="text"
                            className="chat-input"
                            placeholder={isProcessing ? '处理中...' : '输入消息...'}
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isProcessing}
                        />
                        <button
                            className="chat-send-button"
                            onClick={handleSend}
                            disabled={!inputText.trim() || isProcessing}
                        >
                            发送
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export default ChatPanel;
