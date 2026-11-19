// SPDX-License-Identifier: MIT

'use client';

import { useRef, useEffect } from 'react';
import { useTheme } from 'next-themes';

export default function ChatHistoryPanel({ 
  messages = [], 
  onCollapse, 
  isLoading = false,
  className = "" 
}) {
  const messagesEndRef = useRef(null);
  const { theme } = useTheme();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className={`
      flex flex-col h-64
      ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-50'}
      ${className}
    `}>
      {/* Messages Area */}
      <div className={`
        flex-1 overflow-y-auto p-4 space-y-4
        ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-50'}
      `}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className={`
              w-12 h-12 rounded-full flex items-center justify-center mb-3
              ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'}
            `}>
              <svg 
                width="24" 
                height="24" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                className={`w-6 h-6 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <h3 className={`text-sm font-medium mb-1 ${theme === 'dark' ? 'text-gray-200' : 'text-gray-900'}`}>
              Start a conversation
            </h3>
            <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              Ask questions or execute LaTeX commands
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`
                  max-w-[85%] rounded-lg px-3 py-2 shadow-sm
                  ${message.role === 'user'
                    ? 'bg-[#2563EB] text-white'
                    : theme === 'dark'
                      ? 'bg-gray-700 text-gray-100'
                      : 'bg-gray-100 text-gray-900'
                  }
                  ${message.isError 
                    ? 'bg-red-100 text-red-800 border border-red-200' 
                    : ''
                  }
                `}
              >
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {message.content}
                </div>
                <div className={`
                  text-xs mt-1 opacity-70
                  ${message.role === 'user' ? 'text-blue-100' : 'text-gray-500'}
                `}>
                  {formatTime(message.timestamp)}
                </div>
              </div>
            </div>
          ))
        )}
        
        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className={`
              max-w-[85%] rounded-lg px-3 py-2 shadow-sm
              ${theme === 'dark' ? 'bg-gray-700 text-gray-100' : 'bg-gray-100 text-gray-900'}
            `}>
              <div className="flex items-center space-x-2">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
                <span className="text-xs">Thinking...</span>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
