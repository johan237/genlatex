'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ChatPopup from '../../components/ChatPopup';
import { CheckCircle, FileText, Loader2, Sparkles, Upload, X } from 'lucide-react';

export default function NewProjectChat() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const fileInputRef = useRef(null);
  const [projectSpecs, setProjectSpecs] = useState({
    description: '',
    documentType: null,
    details: {}
  });

  // Check authentication
  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch('/api/auth/session');
        const data = await res.json();
        if (data.user) {
          setSession(data.user);
        } else {
          router.push('/login');
        }
      } catch (error) {
        router.push('/login');
      } finally {
        setIsCheckingAuth(false);
      }
    }
    checkSession();
  }, [router]);

  // Initialize with welcome message
  useEffect(() => {
    const welcomeMessage = {
      id: 1,
      role: 'assistant',
      content: `👋 **Welcome to GenLaTeX!**

I'm here to help you create your document. Let's start by understanding what you need.

**What would you like to create today?**

Some examples:
- 📊 A research paper about climate change
- 📝 A professional CV/resume
- 💼 A business report on quarterly sales
- 📧 A formal letter
- 🎓 A thesis or dissertation
- 📈 A presentation on data science

Tell me what you have in mind, and I'll ask you some questions to make sure we get it just right!`,
      timestamp: new Date()
    };

    setMessages([welcomeMessage]);
  }, []);

  // Handle file uploads
  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploadedFiles(prev => [...prev, ...files]);

    // Add system message about uploaded files
    const fileNames = files.map(f => f.name).join(', ');
    const systemMessage = {
      id: Date.now(),
      role: 'assistant',
      content: `✅ **Files uploaded successfully:** ${fileNames}\n\nI'll use these as reference when creating your document.`,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, systemMessage]);
  };

  // Remove uploaded file
  const handleRemoveFile = (index) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Build detailed prompt from specs
  const buildPromptFromSpecs = (specs) => {
    const { documentType, description, details } = specs;

    let prompt = `Create a professional ${documentType} `;

    if (documentType === 'cv' || documentType === 'resume') {
      prompt += `using the moderncv LaTeX package with a modern, professional style.\n\n`;
      prompt += `**CRITICAL Requirements:**\n`;
      prompt += `- Use \\documentclass{moderncv} with casual or classic style\n`;
      prompt += `- Use the ACTUAL user information provided below - DO NOT use placeholders\n`;
      prompt += `- Fill in real name, contact info, experience, education, and skills from the content\n`;
      prompt += `- Include all standard CV sections: Summary, Experience, Education, Skills\n`;
      prompt += `- Use proper moderncv commands (\\cventry, \\cvitem, \\section)\n`;
      prompt += `- Make it visually appealing with appropriate spacing and formatting\n`;
      prompt += `- NO PLACEHOLDER TEXT - use only the real information provided\n\n`;
    } else if (documentType === 'letter') {
      prompt += `using a formal letter format.\n\n`;
    } else if (documentType === 'presentation') {
      prompt += `using the beamer package for slides.\n\n`;
    } else {
      prompt += `.\n\n`;
    }

    prompt += `**Content Details:**\n`;
    prompt += `${description}\n\n`;

    if (details && Object.keys(details).length > 0) {
      prompt += `**Additional Requirements:**\n`;
      Object.entries(details).forEach(([key, value]) => {
        if (value && value !== '') {
          prompt += `- ${key}: ${value}\n`;
        }
      });
    }

    if (uploadedFiles.length > 0) {
      prompt += `\n**Reference Files:**\n`;
      prompt += `The following files have been uploaded as reference:\n`;
      uploadedFiles.forEach(file => {
        prompt += `- ${file.name}\n`;
      });
    }

    return prompt;
  };

  // Handle chat messages (ChatPopup passes { message, mode, mentionedFiles, taggedImportedFileIds }; we accept string or that object)
  const handleSendMessage = async (payload) => {
    const messageText = typeof payload === 'string' ? payload : (payload?.message ?? '');
    if (!messageText.trim()) return;

    const requestId = Date.now();

    // Add user message (content must be a string for React to render)
    const userMessage = {
      id: requestId,
      role: 'user',
      content: messageText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // Send to AI for requirements gathering (credentials so session cookie is sent)
      const response = await fetch('/api/ai/project-requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          conversation: [...messages, userMessage].map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : String(m.content ?? '')
          })),
          uploadedFiles: uploadedFiles.map(f => f.name),
          currentSpecs: projectSpecs
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', errorText);
        throw new Error('Failed to get AI response');
      }

      const data = await response.json();

      // Add AI response
      const aiMessage = {
        id: requestId + 1,
        role: 'assistant',
        content: typeof data.message === 'string' ? data.message : JSON.stringify(data),
        timestamp: new Date()
      };

      setMessages(prev => [...prev, aiMessage]);

      // Update project specs
      if (data.specs) {
        setProjectSpecs(data.specs);
      }

      // Check if requirements are complete
      if (data.requirementsComplete) {
        // Show confirmation and create project
        setTimeout(() => handleCreateProject(data.specs), 1500);
      }

    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = {
        id: requestId + 1,
        role: 'assistant',
        content: '❌ Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Create project after requirements are gathered
  const handleCreateProject = async (specs) => {
    setIsCreatingProject(true);

    try {
      const rawDocumentType = String(specs.documentType || 'article').toLowerCase();
      const normalizedDocumentType = rawDocumentType === 'presentation'
        ? 'slides'
        : (rawDocumentType === 'resume' ? 'cv' : rawDocumentType);

      // Step 1: Create the project shell first (no heavy file processing here)
      const formData = new FormData();
      formData.append('name', specs.projectName || 'New Project');
      formData.append('type', normalizedDocumentType || 'document');
      formData.append('documentType', normalizedDocumentType || 'article');
      formData.append('workflowMode', 'manual');
      formData.append('useAIGeneration', 'false');
      formData.append('description', specs.description || '');

      const projectResponse = await fetch('/api/projects', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      if (!projectResponse.ok) {
        throw new Error('Failed to create project');
      }

      const project = await projectResponse.json();

      const generatingMessage = {
        id: Date.now(),
        role: 'assistant',
        content: `Project created. Starting AI generation for your ${specs.documentType || 'document'}...`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, generatingMessage]);

      // Step 2: Start generation with multipart payload so uploaded files are included as context
      const detailedPrompt = buildPromptFromSpecs(specs);
      const generationFormData = new FormData();
      generationFormData.append('project_id', project.id);
      generationFormData.append('topic', specs.projectName || 'New Document');
      generationFormData.append('description', detailedPrompt);
      generationFormData.append('document_mode', 'true');
      generationFormData.append('document_type', normalizedDocumentType || 'article');
      if (normalizedDocumentType === 'cv') {
        generationFormData.append('document_template', 'moderncv');
      }
      uploadedFiles.forEach((file) => {
        generationFormData.append('uploadedFiles', file, file.name);
      });

      const generateResponse = await fetch('/api/agent/documents/generate-with-project', {
        method: 'POST',
        credentials: 'include',
        body: generationFormData
      });

      if (!generateResponse.ok) {
        const errorText = await generateResponse.text().catch(() => '');
        console.warn('AI generation failed:', errorText);
        setIsCreatingProject(false);

        const errorMessage = {
          id: Date.now() + 2,
          role: 'assistant',
          content: 'Generation could not be started. Opening the editor so you can continue manually.',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);

        setTimeout(() => {
          router.push(`/editor/${project.id}`);
        }, 1200);
        return;
      }

      const generateData = await generateResponse.json();
      const documentId = generateData.document_id || generateData.paper_id;

      if (!documentId) {
        console.error('No document ID returned from generation');
        setIsCreatingProject(false);

        const warningMessage = {
          id: Date.now() + 3,
          role: 'assistant',
          content: 'Generation started but tracking information is missing. Opening the editor.',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, warningMessage]);

        setTimeout(() => {
          router.push(`/editor/${project.id}`);
        }, 1200);
        return;
      }

      console.log('Generation started with document ID:', documentId);
      const progressMessage = {
        id: Date.now() + 4,
        role: 'assistant',
        content: 'Generation started. Opening the editor and tracking progress in real time...',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, progressMessage]);

      setTimeout(() => {
        router.push(`/editor/${project.id}?aiGenerating=true`);
      }, 900);

    } catch (error) {
      console.error('Error creating project:', error);
      setIsCreatingProject(false);

      const errorMessage = {
        id: Date.now(),
        role: 'assistant',
        content: '❌ Sorry, I couldn\'t create the project. Please try again or contact support.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };
  // Show loading while checking authentication
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Sparkles className="w-6 h-6 text-blue-500" />
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                New Project Setup
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Let's create your document together
              </p>
            </div>
          </div>

          {/* Progress indicator */}
          {projectSpecs.documentType && (
            <div className="flex items-center space-x-2 text-sm">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-gray-600 dark:text-gray-300">
                {projectSpecs.documentType}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Chat Interface */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg h-[calc(100vh-200px)]">
          <ChatPopup
            variant="inline"
            isOpen={true}
            onClose={() => {}} // Prevent closing
            externalMessages={messages}
            externalLoading={isLoading || isCreatingProject}
            onSendMessage={handleSendMessage}
          />
        </div>

        {/* File upload section */}
        <div className="mt-4">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.csv,.xlsx,.txt,.bib,.tex"
            onChange={handleFileUpload}
            className="hidden"
          />

          {uploadedFiles.length === 0 ? (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3 flex-1">
                  <FileText className="w-5 h-5 text-blue-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-blue-900 dark:text-blue-100">
                      Have reference materials?
                    </p>
                    <p className="text-blue-700 dark:text-blue-300 mt-1">
                      Upload PDFs, Word docs, CSVs, or other files to help me understand your requirements better.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isCreatingProject}
                  className="ml-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-lg text-sm font-medium flex items-center space-x-2 transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Uploaded files display */}
        {uploadedFiles.length > 0 && (
          <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-green-900 dark:text-green-100">
                Uploaded files ({uploadedFiles.length})
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isCreatingProject}
                className="px-3 py-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white rounded-md text-xs font-medium flex items-center space-x-1.5 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Add more</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {uploadedFiles.map((file, index) => (
                <div
                  key={index}
                  className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-green-300 dark:border-green-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 flex items-center space-x-2"
                >
                  <FileText className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <span className="max-w-xs truncate">{file.name}</span>
                  <button
                    onClick={() => handleRemoveFile(index)}
                    disabled={isCreatingProject}
                    className="ml-1 p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded disabled:opacity-50"
                    title="Remove file"
                  >
                    <X className="w-3.5 h-3.5 text-red-500" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Creating project loader */}
        {isCreatingProject && (
          <div className="mt-6 p-6 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center space-x-4">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              <div>
                <p className="font-medium text-gray-900 dark:text-white">
                  Creating your project...
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  This will just take a moment
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
