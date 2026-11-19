/**
 * Tiptap Editor Component
 * Rich text editor with WYSIWYG interface
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { useToast } from './Toast';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Link } from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Underline } from '@tiptap/extension-underline';
import { TextAlign } from '@tiptap/extension-text-align';
import { Superscript } from '@tiptap/extension-superscript';
import { Subscript } from '@tiptap/extension-subscript';
import { Focus } from '@tiptap/extension-focus';
import { Dropcursor } from '@tiptap/extension-dropcursor';

export default function TiptapEditor({ 
  content = '', 
  onChange, 
  projectId, 
  fileName = 'main.md',
  placeholder = 'Start writing...',
  isDarkMode = false
}) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline cursor-pointer',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg cursor-pointer',
        },
        inline: false,
        allowBase64: true,
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse border border-gray-300',
        },
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: {
          class: 'border border-gray-300 bg-gray-100 font-semibold',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-gray-300 p-2',
        },
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Superscript,
      Subscript,
      Focus.configure({
        className: 'has-focus',
        mode: 'all',
      }),
      Dropcursor.configure({
        color: '#3b82f6',
        width: 2,
      }),
    ],
    content,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
      debouncedSave(html);
    },
  });

  // Debounced save function
  const debouncedSave = useCallback(
    debounce(async (content) => {
      if (!projectId) return;
      
      setIsSaving(true);
      try {
        const response = await fetch(`/api/files/${projectId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName,
            content,
            type: 'markdown'
          }),
        });

        if (response.ok) {
          setLastSaved(new Date());
        }
      } catch (error) {
        console.error('Error saving file:', error);
      } finally {
        setIsSaving(false);
      }
    }, 1000),
    [projectId, fileName]
  );

  // Image upload handler
  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.warning('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.warning('Image size must be less than 5MB');
      return;
    }

    setIsUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        // Insert image into editor
        editor.chain().focus().setImage({ src: result.url }).run();
        toast.success('Image uploaded successfully');
      } else {
        toast.error('Upload failed: ' + result.error);
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      // Reset file input
      event.target.value = '';
    }
  };

  // Image URL handler
  const handleImageUrl = () => {
    const url = window.prompt('Enter image URL:');
    if (url && url.trim()) {
      // Basic URL validation
      try {
        new URL(url);
        editor.chain().focus().setImage({ src: url.trim() }).run();
      } catch (error) {
        toast.warning('Please enter a valid URL');
      }
    }
  };

  // Handle image selection and resize
  const handleImageClick = (event) => {
    const img = event.target;
    if (img.tagName === 'IMG') {
      console.log('Image selected:', img);
      setSelectedImage(img);
      img.classList.add('selected');
      
      // Remove selection from other images
      const allImages = document.querySelectorAll('.ProseMirror img');
      allImages.forEach(image => {
        if (image !== img) {
          image.classList.remove('selected');
        }
      });
    }
  };

  // Handle resize handle mouse events (Figma-style)
  const handleResizeMouseDown = (event, handle) => {
    event.preventDefault();
    event.stopPropagation();
    
    setIsResizing(true);
    setResizeHandle(handle);
    
    const img = selectedImage;
    if (!img) return;
    
    // Add resizing class for visual feedback
    img.classList.add('resizing');
    
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = img.offsetWidth;
    const startHeight = img.offsetHeight;
    
    const handleMouseMove = (e) => {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      const maintainAspectRatio = e.shiftKey;
      
      let newWidth = startWidth;
      let newHeight = startHeight;
      
      switch (handle) {
        case 'se': // Southeast corner
          if (maintainAspectRatio) {
            const scale = Math.max(deltaX / startWidth, deltaY / startHeight);
            newWidth = Math.max(50, Math.min(1000, startWidth + startWidth * scale));
            newHeight = Math.max(50, Math.min(1000, startHeight + startHeight * scale));
          } else {
            newWidth = Math.max(50, Math.min(1000, startWidth + deltaX));
            newHeight = Math.max(50, Math.min(1000, startHeight + deltaY));
          }
          break;
          
        case 'sw': // Southwest corner
          if (maintainAspectRatio) {
            const scale = Math.max(-deltaX / startWidth, deltaY / startHeight);
            newWidth = Math.max(50, Math.min(1000, startWidth - startWidth * scale));
            newHeight = Math.max(50, Math.min(1000, startHeight + startHeight * scale));
          } else {
            newWidth = Math.max(50, Math.min(1000, startWidth - deltaX));
            newHeight = Math.max(50, Math.min(1000, startHeight + deltaY));
          }
          break;
          
        case 'ne': // Northeast corner
          if (maintainAspectRatio) {
            const scale = Math.max(deltaX / startWidth, -deltaY / startHeight);
            newWidth = Math.max(50, Math.min(1000, startWidth + startWidth * scale));
            newHeight = Math.max(50, Math.min(1000, startHeight - startHeight * scale));
          } else {
            newWidth = Math.max(50, Math.min(1000, startWidth + deltaX));
            newHeight = Math.max(50, Math.min(1000, startHeight - deltaY));
          }
          break;
          
        case 'nw': // Northwest corner
          if (maintainAspectRatio) {
            const scale = Math.max(-deltaX / startWidth, -deltaY / startHeight);
            newWidth = Math.max(50, Math.min(1000, startWidth - startWidth * scale));
            newHeight = Math.max(50, Math.min(1000, startHeight - startHeight * scale));
          } else {
            newWidth = Math.max(50, Math.min(1000, startWidth - deltaX));
            newHeight = Math.max(50, Math.min(1000, startHeight - deltaY));
          }
          break;
          
        case 'e': // East edge
          newWidth = Math.max(50, Math.min(1000, startWidth + deltaX));
          break;
          
        case 'w': // West edge
          newWidth = Math.max(50, Math.min(1000, startWidth - deltaX));
          break;
          
        case 's': // South edge
          newHeight = Math.max(50, Math.min(1000, startHeight + deltaY));
          break;
          
        case 'n': // North edge
          newHeight = Math.max(50, Math.min(1000, startHeight - deltaY));
          break;
      }
      
      // Apply the new dimensions
      img.style.width = `${newWidth}px`;
      img.style.height = `${newHeight}px`;
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeHandle(null);
      
      // Remove resizing class
      img.classList.remove('resizing');
      
      // Update editor content
      if (editor) {
        const html = editor.getHTML();
        onChange(html);
      }
      
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleImageResize = (direction, amount = 10) => {
    if (!selectedImage) return;
    
    const currentWidth = selectedImage.offsetWidth;
    let newWidth;
    
    switch (direction) {
      case 'increase':
        newWidth = Math.min(currentWidth + amount, 800); // Max 800px
        break;
      case 'decrease':
        newWidth = Math.max(currentWidth - amount, 100); // Min 100px
        break;
      case 'reset':
        newWidth = 'auto';
        break;
      default:
        return;
    }
    
    selectedImage.style.width = typeof newWidth === 'number' ? `${newWidth}px` : newWidth;
    
    // Update editor content
    if (editor) {
      const html = editor.getHTML();
      onChange(html);
    }
  };

  const handleImageDelete = () => {
    if (!selectedImage) return;
    
    selectedImage.remove();
    setSelectedImage(null);
    
    // Update editor content
    if (editor) {
      const html = editor.getHTML();
      onChange(html);
    }
  };

  // Add resize handles to selected image
  useEffect(() => {
    if (selectedImage) {
      console.log('Creating resize handles for:', selectedImage);
      
      // Remove existing handles
      const existingHandles = document.querySelectorAll('.resize-handle');
      existingHandles.forEach(handle => handle.remove());
      
      // Ensure parent has relative positioning
      const parent = selectedImage.parentNode;
      if (parent) {
        parent.style.position = 'relative';
        parent.style.display = 'inline-block';
      }
      
      // Create resize handles
      const handles = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'];
      
      handles.forEach(handle => {
        const resizeHandle = document.createElement('div');
        resizeHandle.className = `resize-handle ${handle}`;
        resizeHandle.style.position = 'absolute';
        resizeHandle.style.zIndex = '10';
        resizeHandle.addEventListener('mousedown', (e) => {
          console.log('Resize handle clicked:', handle);
          handleResizeMouseDown(e, handle);
        });
        
        // Append to the same parent as the image
        if (parent) {
          parent.appendChild(resizeHandle);
          console.log('Created handle:', handle, resizeHandle);
        }
      });
    } else {
      // Remove all resize handles when no image is selected
      const existingHandles = document.querySelectorAll('.resize-handle');
      existingHandles.forEach(handle => handle.remove());
    }
  }, [selectedImage]);

  // Handle click outside to deselect images
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (selectedImage && !event.target.closest('.ProseMirror img') && !event.target.closest('.resize-handle')) {
        selectedImage.classList.remove('selected');
        setSelectedImage(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [selectedImage]);

  // Load content on mount
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (editor) {
        const content = editor.getHTML();
        if (content && projectId) {
          fetch(`/api/files/${projectId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName,
              content,
              type: 'markdown'
            }),
          });
        }
      }
    };
  }, [editor, projectId, fileName]);

  if (!editor) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col border rounded-lg shadow-sm ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      {/* Compact Toolbar */}
      <div className={`border-b px-3 py-2 ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center space-x-1">
          {/* Undo/Redo */}
          <button
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().chain().focus().undo().run()}
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-50 transition-colors"
            title="Undo"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <button
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().chain().focus().redo().run()}
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-50 transition-colors"
            title="Redo"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6" />
            </svg>
          </button>

          {/* Heading Dropdown */}
          <select
            value={editor.isActive('heading', { level: 1 }) ? 'h1' : 
                   editor.isActive('heading', { level: 2 }) ? 'h2' : 
                   editor.isActive('heading', { level: 3 }) ? 'h3' : 'paragraph'}
            onChange={(e) => {
              if (e.target.value === 'h1') editor.chain().focus().toggleHeading({ level: 1 }).run();
              else if (e.target.value === 'h2') editor.chain().focus().toggleHeading({ level: 2 }).run();
              else if (e.target.value === 'h3') editor.chain().focus().toggleHeading({ level: 3 }).run();
              else editor.chain().focus().setParagraph().run();
            }}
            className="px-1.5 py-0.5 border border-gray-300 rounded text-xs font-medium bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="paragraph">Normal text</option>
            <option value="h1">H1</option>
            <option value="h2">H2</option>
            <option value="h3">H3</option>
          </select>

          <div className="w-px h-4 bg-gray-300 mx-1"></div>

          {/* Text Formatting */}
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive('bold') ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Bold"
          >
            <strong className="text-xs">B</strong>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive('italic') ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Italic"
          >
            <em className="text-xs">I</em>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive('strike') ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Strikethrough"
          >
            <s className="text-xs">S</s>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive('code') ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Code"
          >
            <code className="text-xs">{'</>'}</code>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive('underline') ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Underline"
          >
            <u className="text-xs">U</u>
          </button>
          <button
            onClick={() => {
              const url = window.prompt('Enter URL:');
              if (url) {
                editor.chain().focus().setLink({ href: url }).run();
              }
            }}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive('link') ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Link"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive('superscript') ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Superscript"
          >
            <span className="text-xs">X²</span>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleSubscript().run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive('subscript') ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Subscript"
          >
            <span className="text-xs">X₂</span>
          </button>

          <div className="w-px h-4 bg-gray-300 mx-1"></div>

          {/* Lists */}
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive('bulletList') ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Bullet List"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="6" cy="6" r="1.5"/>
              <circle cx="6" cy="12" r="1.5"/>
              <circle cx="6" cy="18" r="1.5"/>
              <rect x="11" y="5" width="11" height="2" rx="1"/>
              <rect x="11" y="11" width="11" height="2" rx="1"/>
              <rect x="11" y="17" width="11" height="2" rx="1"/>
            </svg>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive('orderedList') ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Numbered List"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="4" width="3" height="2" rx="1"/>
              <rect x="3" y="9" width="3" height="2" rx="1"/>
              <rect x="3" y="14" width="3" height="2" rx="1"/>
              <rect x="3" y="19" width="3" height="2" rx="1"/>
              <rect x="9" y="5" width="12" height="2" rx="1"/>
              <rect x="9" y="10" width="12" height="2" rx="1"/>
              <rect x="9" y="15" width="12" height="2" rx="1"/>
              <rect x="9" y="20" width="12" height="2" rx="1"/>
            </svg>
          </button>

          <div className="w-px h-4 bg-gray-300 mx-1"></div>

          {/* Alignment */}
          <button
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive({ textAlign: 'left' }) ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Align Left"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="6" width="18" height="2" rx="1"/>
              <rect x="3" y="10" width="12" height="2" rx="1"/>
              <rect x="3" y="14" width="15" height="2" rx="1"/>
              <rect x="3" y="18" width="9" height="2" rx="1"/>
            </svg>
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive({ textAlign: 'center' }) ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Align Center"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="6" width="18" height="2" rx="1"/>
              <rect x="6" y="10" width="12" height="2" rx="1"/>
              <rect x="4.5" y="14" width="15" height="2" rx="1"/>
              <rect x="7.5" y="18" width="9" height="2" rx="1"/>
            </svg>
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              editor.isActive({ textAlign: 'right' }) ? 'bg-purple-100 text-purple-600' : ''
            }`}
            title="Align Right"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="6" width="18" height="2" rx="1"/>
              <rect x="9" y="10" width="12" height="2" rx="1"/>
              <rect x="6" y="14" width="15" height="2" rx="1"/>
              <rect x="12" y="18" width="9" height="2" rx="1"/>
            </svg>
          </button>

          <div className="flex-1"></div>

          {/* Upload Status */}
          {isUploading && (
            <div className="flex items-center space-x-1 text-xs text-blue-600">
              <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Uploading...</span>
            </div>
          )}

          {/* Image Controls */}
          {selectedImage && (
            <div className="flex items-center space-x-1 text-xs">
              <span className="text-gray-600">Image:</span>
              <button
                onClick={() => {
                  console.log('Selected image:', selectedImage);
                  console.log('Handles:', document.querySelectorAll('.resize-handle'));
                }}
                className="px-1 py-0.5 bg-blue-200 text-blue-700 rounded hover:bg-blue-300"
                title="Debug info"
              >
                Debug
              </button>
              <button
                onClick={() => handleImageResize('decrease')}
                className="px-1 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                title="Decrease size"
              >
                −
              </button>
              <button
                onClick={() => handleImageResize('increase')}
                className="px-1 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                title="Increase size"
              >
                +
              </button>
              <button
                onClick={() => handleImageResize('reset')}
                className="px-1 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                title="Reset size"
              >
                ↺
              </button>
              <button
                onClick={handleImageDelete}
                className="px-1 py-0.5 bg-red-200 text-red-700 rounded hover:bg-red-300"
                title="Delete image"
              >
                ×
              </button>
            </div>
          )}

          {/* Image Upload Button */}
          <div className="relative">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              id="image-upload"
            />
            <label
              htmlFor="image-upload"
              className="px-1.5 py-0.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors flex items-center space-x-1 cursor-pointer"
              title="Upload Image"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>Image</span>
            </label>
          </div>

          {/* Image URL Button */}
          <button
            onClick={handleImageUrl}
            className="px-1.5 py-0.5 bg-green-500 text-white text-xs rounded hover:bg-green-600 transition-colors flex items-center space-x-1"
            title="Add Image URL"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>URL</span>
          </button>
        </div>
      </div>

      {/* Document Content Area */}
      <div className={`flex-1 overflow-auto ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
        <div className="max-w-3xl mx-auto py-4 px-6">
          <div onClick={handleImageClick}>
            <EditorContent 
              editor={editor} 
              className={`min-h-full focus:outline-none ${isDarkMode ? 'text-white' : 'text-black'}`}
              style={{
                fontSize: '14px',
                lineHeight: '1.5',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            />
          </div>
        </div>
      </div>

      {/* Custom Styles for Document-like Appearance */}
      <style jsx global>{`
        .ProseMirror {
          outline: none;
          min-height: 200px;
        }
        
        .ProseMirror h1 {
          font-size: 1.75rem;
          font-weight: 700;
          line-height: 1.2;
          margin: 1.5rem 0 0.75rem 0;
          color: #1f2937;
        }
        
        .ProseMirror h2 {
          font-size: 1.5rem;
          font-weight: 600;
          line-height: 1.3;
          margin: 1.25rem 0 0.5rem 0;
          color: #374151;
        }
        
        .ProseMirror h3 {
          font-size: 1.25rem;
          font-weight: 600;
          line-height: 1.4;
          margin: 1rem 0 0.5rem 0;
          color: #4b5563;
        }
        
        .ProseMirror p {
          margin: 0.5rem 0;
          line-height: 1.5;
        }
        
        .ProseMirror ul, .ProseMirror ol {
          margin: 0.5rem 0;
          padding-left: 1.25rem;
        }
        
        .ProseMirror li {
          margin: 0.125rem 0;
        }
        
        .ProseMirror blockquote {
          border-left: 3px solid #e5e7eb;
          padding-left: 0.75rem;
          margin: 0.75rem 0;
          font-style: italic;
          color: #6b7280;
        }
        
        .ProseMirror code {
          background-color: #f3f4f6;
          padding: 0.125rem 0.25rem;
          border-radius: 0.25rem;
          font-size: 0.875rem;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        }
        
        .ProseMirror pre {
          background-color: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 0.375rem;
          padding: 0.75rem;
          margin: 0.75rem 0;
          overflow-x: auto;
        }
        
        .ProseMirror pre code {
          background-color: transparent;
          padding: 0;
          font-size: 0.875rem;
        }
        
        .ProseMirror a {
          color: #2563eb;
          text-decoration: underline;
        }
        
        .ProseMirror a:hover {
          color: #1d4ed8;
        }
        
        .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 0.375rem;
          margin: 0.75rem 0;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .ProseMirror img:hover {
          box-shadow: 0 0 0 2px #3b82f6;
        }
        
        .ProseMirror img.selected {
          box-shadow: 0 0 0 2px #3b82f6;
          outline: none;
          position: relative;
          user-select: none;
        }
        
        .ProseMirror img.selected::after {
          content: '';
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          border: 2px solid #3b82f6;
          pointer-events: none;
          border-radius: 4px;
        }
        
        .ProseMirror img.resizing {
          box-shadow: 0 0 0 2px #2563eb;
          opacity: 0.8;
        }
        
        .ProseMirror img.resizing::after {
          border-color: #2563eb;
        }
        
        .resize-handle {
          position: absolute;
          background: #3b82f6;
          border: 2px solid white;
          border-radius: 2px;
          z-index: 10;
          transition: all 0.1s ease;
        }
        
        .resize-handle:hover {
          background: #2563eb;
          transform: scale(1.1);
        }
        
        .resize-handle.nw {
          top: -8px;
          left: -8px;
          width: 16px;
          height: 16px;
          cursor: nw-resize;
        }
        
        .resize-handle.ne {
          top: -8px;
          right: -8px;
          width: 16px;
          height: 16px;
          cursor: ne-resize;
        }
        
        .resize-handle.sw {
          bottom: -8px;
          left: -8px;
          width: 16px;
          height: 16px;
          cursor: sw-resize;
        }
        
        .resize-handle.se {
          bottom: -8px;
          right: -8px;
          width: 16px;
          height: 16px;
          cursor: se-resize;
        }
        
        .resize-handle.n {
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          width: 16px;
          height: 8px;
          cursor: n-resize;
        }
        
        .resize-handle.s {
          bottom: -8px;
          left: 50%;
          transform: translateX(-50%);
          width: 16px;
          height: 8px;
          cursor: s-resize;
        }
        
        .resize-handle.w {
          top: 50%;
          left: -8px;
          transform: translateY(-50%);
          width: 8px;
          height: 16px;
          cursor: w-resize;
        }
        
        .resize-handle.e {
          top: 50%;
          right: -8px;
          transform: translateY(-50%);
          width: 8px;
          height: 16px;
          cursor: e-resize;
        }
        
        .ProseMirror .has-focus {
          outline: none;
        }
        
        .ProseMirror .dropcursor {
          position: relative;
        }
        
        .ProseMirror .dropcursor::after {
          content: '';
          position: absolute;
          left: -2px;
          right: -2px;
          top: 0;
          bottom: 0;
          background: #3b82f6;
          pointer-events: none;
        }
        
        .ProseMirror table {
          border-collapse: collapse;
          margin: 0.75rem 0;
          width: 100%;
        }
        
        .ProseMirror table th,
        .ProseMirror table td {
          border: 1px solid #d1d5db;
          padding: 0.375rem;
          text-align: left;
        }
        
        .ProseMirror table th {
          background-color: #f9fafb;
          font-weight: 600;
        }
        
        .ProseMirror strong {
          font-weight: 600;
        }
        
        .ProseMirror em {
          font-style: italic;
        }
        
        .ProseMirror s {
          text-decoration: line-through;
        }
        
        .ProseMirror u {
          text-decoration: underline;
        }
        
        .ProseMirror sup {
          vertical-align: super;
          font-size: 0.75em;
        }
        
        .ProseMirror sub {
          vertical-align: sub;
          font-size: 0.75em;
        }
        
        .ProseMirror .is-empty::before {
          content: attr(data-placeholder);
          float: left;
          color: #9ca3af;
          pointer-events: none;
          height: 0;
        }
      `}</style>
    </div>
  );
}

// Debounce utility function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
