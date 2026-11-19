// SPDX-License-Identifier: MIT

// Simple Monaco worker fallback
// This helps reduce worker warnings in development
self.onmessage = function(e) {
  // Basic worker functionality for Monaco Editor
  // In production, this would be replaced by the actual Monaco workers
  self.postMessage({
    type: 'ready'
  });
};
