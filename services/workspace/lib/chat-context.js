/**
 * Chat Context Formatting Utility
 * Formats chat history for AI context inclusion
 */

/**
 * Format chat messages for AI context
 * Includes user messages as-is, AI messages with summaries for code modifications
 * 
 * @param {Array} messages - Array of message objects from database
 * @returns {Array} Formatted conversation array: [{role: 'user', content: '...'}, ...]
 */
export function formatChatHistoryForAI(messages = []) {
  if (!messages || messages.length === 0) {
    return [];
  }

  return messages.map(msg => {
    const role = msg.role;
    let content = msg.content || '';

    // For assistant messages, check if we need to use summary
    if (role === 'assistant') {
      const metadata = msg.metadata || {};
      const messageType = msg.message_type || msg.messageType || 'text_response';

      // If it's a code modification, use summary from metadata if available
      if (messageType === 'code_modification') {
        const codeSummary = metadata.codeSummary;
        if (codeSummary) {
          content = codeSummary;
        } else if (metadata.filesModified && metadata.filesModified.length > 0) {
          // Fallback: generate summary from filesModified
          const fileNames = metadata.filesModified.map(f => {
            const parts = f.split('/');
            return parts[parts.length - 1];
          });
          content = `Modified ${fileNames.map(f => `\`${f}\``).join(', ')}`;
        }
      } 
      // If it's a tool call, use minimal summary
      else if (messageType === 'tool_call') {
        const toolSummary = metadata.toolSummary;
        if (toolSummary) {
          content = toolSummary;
        } else {
          content = 'Executed tool operations';
        }
      }
      // For text responses, use content as-is
      // (content already set above)
    }

    return {
      role,
      content: content.trim() || (role === 'user' ? '[Empty message]' : '[No content]')
    };
  }).filter(msg => msg.content && msg.content !== '[Empty message]' && msg.content !== '[No content]');
}

/**
 * Get conversation history formatted for Python backend
 * This is the format expected by the Python API
 * 
 * @param {Array} messages - Array of message objects from database
 * @returns {Array} Conversation history array
 */
export function getConversationHistory(messages = []) {
  return formatChatHistoryForAI(messages);
}
