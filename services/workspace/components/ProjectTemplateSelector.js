/**
 * Project Template Selector Component
 * Allows users to create new projects from predefined templates
 */

import { useState, useEffect } from 'react';

export default function ProjectTemplateSelector({ onClose, onProjectCreated }) {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const response = await fetch('/api/templates/project');
      const data = await response.json();
      if (data.success) {
        setTemplates(data.templates);
      }
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  };

  const handleCreateProject = async () => {
    if (!selectedTemplate || !projectName.trim()) {
      alert('Please select a template and enter a project name');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/templates/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          projectName: projectName.trim(),
          projectDescription: projectDescription.trim(),
          metadata: {
            title: projectName.trim(),
            description: projectDescription.trim(),
            createdFrom: selectedTemplate.name
          }
        })
      });

      const data = await response.json();
      if (data.success) {
        alert('✅ Project created successfully!');
        onProjectCreated(data.project);
        onClose();
      } else {
        alert('❌ Failed to create project: ' + data.error);
      }
    } catch (error) {
      console.error('Error creating project:', error);
      alert('❌ Error creating project: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'academic': return '🎓';
      case 'conference': return '🏛️';
      case 'journal': return '📄';
      case 'thesis': return '📚';
      case 'report': return '📊';
      default: return '📝';
    }
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'academic': return 'bg-blue-100 text-blue-800';
      case 'conference': return 'bg-green-100 text-green-800';
      case 'journal': return 'bg-purple-100 text-purple-800';
      case 'thesis': return 'bg-orange-100 text-orange-800';
      case 'report': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (previewMode && selectedTemplate) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-xl font-semibold">Template Preview: {selectedTemplate.name}</h2>
            <button
              onClick={() => setPreviewMode(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
            <div className="mb-6">
              <h3 className="text-lg font-medium mb-2">Template Description</h3>
              <p className="text-gray-600">{selectedTemplate.description}</p>
            </div>
            
            <div className="mb-6">
              <h3 className="text-lg font-medium mb-2">Files Included</h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {Object.entries(selectedTemplate.files || {}).map(([filename, content]) => (
                    <div key={filename} className="flex items-center text-sm">
                      <span className="text-gray-500 mr-2">
                        {content === 'directory' ? '📁' : '📄'}
                      </span>
                      <span className="font-mono">{filename}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            {selectedTemplate.metadata && (
              <div className="mb-6">
                <h3 className="text-lg font-medium mb-2">Template Metadata</h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(selectedTemplate.metadata).map(([key, value]) => (
                      <div key={key}>
                        <span className="font-medium capitalize">{key}:</span>
                        <span className="ml-2 text-gray-600">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setPreviewMode(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
              >
                Back to Selection
              </button>
              <button
                onClick={() => {
                  setPreviewMode(false);
                  setSelectedTemplate(selectedTemplate);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Use This Template
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold">Create Project from Template</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="flex h-[calc(90vh-80px)]">
          {/* Template Selection */}
          <div className="w-1/2 border-r overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-medium mb-4">Choose a Template</h3>
              
              <div className="space-y-3">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                      selectedTemplate?.id === template.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => setSelectedTemplate(template)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center mb-2">
                          <span className="text-2xl mr-2">
                            {getCategoryIcon(template.category)}
                          </span>
                          <h4 className="font-medium">{template.name}</h4>
                          <span className={`ml-2 px-2 py-1 text-xs rounded-full ${getCategoryColor(template.category)}`}>
                            {template.category}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{template.description}</p>
                        <div className="text-xs text-gray-500">
                          {Object.keys(template.files || {}).length} files included
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewMode(true);
                        }}
                        className="ml-2 text-blue-600 hover:text-blue-800 text-sm"
                      >
                        Preview
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Project Configuration */}
          <div className="w-1/2 overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-medium mb-4">Project Configuration</h3>
              
              {selectedTemplate ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Project Name *
                    </label>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="Enter project name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Project Description
                    </label>
                    <textarea
                      value={projectDescription}
                      onChange={(e) => setProjectDescription(e.target.value)}
                      placeholder="Brief description of your project"
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="font-medium mb-2">Selected Template</h4>
                    <div className="flex items-center mb-2">
                      <span className="text-xl mr-2">
                        {getCategoryIcon(selectedTemplate.category)}
                      </span>
                      <span className="font-medium">{selectedTemplate.name}</span>
                    </div>
                    <p className="text-sm text-gray-600">{selectedTemplate.description}</p>
                  </div>
                  
                  <div className="flex space-x-3 pt-4">
                    <button
                      onClick={onClose}
                      className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateProject}
                      disabled={loading || !projectName.trim()}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Creating...' : 'Create Project'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">📝</div>
                  <p>Select a template to configure your project</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
