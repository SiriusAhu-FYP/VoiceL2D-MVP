/**
 * Chat Panel Component
 *
 * Displays conversation history with bubble-style messages,
 * provides an input box for user text input,
 * and includes voice input toggle and TTS voice selector.
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

export interface VoiceInfo {
    name: string;
    prompt_text: string;
    is_current: boolean;
}

export interface ChatPanelProps {
    /** Messages to display (optional - can be managed externally) */
    messages?: ChatMessage[];
    /** Callback when user sends a message */
    onSendMessage?: (text: string) => void;
    /** Whether the system is currently processing */
    isProcessing?: boolean;
    /** Current status text to display */
    statusText?: string;
    /** Whether voice input is enabled */
    isListening?: boolean;
    /** Callback to toggle voice input */
    onToggleListening?: (enabled: boolean) => void;
    /** Available TTS voices */
    voices?: VoiceInfo[];
    /** Callback when voice is changed */
    onVoiceChange?: (voiceName: string) => void;
    /** Whether audio playback is locking the microphone */
    isAudioLocked?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
    messages: externalMessages,
    onSendMessage,
    isProcessing = false,
    statusText,
    isListening = false,
    onToggleListening,
    voices = [],
    onVoiceChange,
    isAudioLocked = false,
}) => {
    // Use external messages if provided, otherwise use internal state
    const [internalMessages, setInternalMessages] = useState<ChatMessage[]>([]);
    const messages = externalMessages ?? internalMessages;

    const [inputText, setInputText] = useState('');
    const [isExpanded, setIsExpanded] = useState(true);
    const [showVoiceSelector, setShowVoiceSelector] = useState(false);
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

    // Handle voice selection
    const handleVoiceSelect = useCallback((voiceName: string) => {
        if (onVoiceChange) {
            onVoiceChange(voiceName);
        }
        setShowVoiceSelector(false);
    }, [onVoiceChange]);

    // Format timestamp
    const formatTime = (date: Date): string => {
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Get current voice name
    const currentVoice = voices.find(v => v.is_current);

    return (
        <div className={`chat-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
            {/* Header */}
            <div className="chat-panel-header" onClick={() => setIsExpanded(!isExpanded)}>
                <span className="chat-panel-title">对话</span>
                <div className="chat-panel-header-right">
                    {statusText && (
                        <span className="chat-panel-status">{statusText}</span>
                    )}
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
            </div>

            {isExpanded && (
                <>
                    {/* Control Bar */}
                    <div className="chat-control-bar">
                        {/* Voice Input Toggle */}
                        <button
                            className={`voice-toggle-btn ${isListening ? 'active' : ''} ${isAudioLocked ? 'locked' : ''}`}
                            onClick={handleVoiceToggle}
                            disabled={isProcessing || isAudioLocked}
                            title={isAudioLocked ? '语音播放中...' : (isListening ? '关闭语音输入' : '开启语音输入')}
                        >
                            <span className="voice-icon">
                                {isAudioLocked ? '🔇' : (isListening ? '🎤' : '🎙️')}
                            </span>
                            <span className="voice-label">
                                {isAudioLocked ? '播放中' : (isListening ? '语音已开启' : '语音已关闭')}
                            </span>
                        </button>

                        {/* Voice Selector */}
                        {voices.length > 0 && (
                            <div className="voice-selector-container">
                                <button
                                    className="voice-selector-btn"
                                    onClick={() => setShowVoiceSelector(!showVoiceSelector)}
                                    title="选择TTS音色"
                                >
                                    <span className="voice-selector-icon">🔊</span>
                                    <span className="voice-selector-label">
                                        {currentVoice?.name || '选择音色'}
                                    </span>
                                    <span className="voice-selector-arrow">
                                        {showVoiceSelector ? '▲' : '▼'}
                                    </span>
                                </button>

                                {showVoiceSelector && (
                                    <div className="voice-selector-dropdown">
                                        <div className="voice-selector-header">
                                            TTS 音色列表
                                            <span className="voice-selector-hint">
                                                配置文件: client/utils/config.toml
                                            </span>
                                        </div>
                                        {voices.map((voice) => (
                                            <button
                                                key={voice.name}
                                                className={`voice-option ${voice.is_current ? 'active' : ''}`}
                                                onClick={() => handleVoiceSelect(voice.name)}
                                            >
                                                <span className="voice-option-name">
                                                    {voice.name}
                                                </span>
                                                <span className="voice-option-hint">
                                                    {voice.prompt_text.substring(0, 20)}...
                                                </span>
                                                {voice.is_current && (
                                                    <span className="voice-option-check">✓</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
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
