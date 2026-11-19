'use client';

import { useState } from 'react';
import SpecialInstructionsStep from './SpecialInstructionsStep';
import FileUploadStep from './FileUploadStep';

// MVP: Hide num_pages and import template; AI deduces length and uses default template
const MVP_HIDE_NUM_PAGES = true;

export default function PaperGenerationForm({ onStartGeneration, isGenerating }) {
  const [formData, setFormData] = useState({
    topic: '',
    description: '',
    num_pages: 5,
    createProject: true
  });

  const [specialInstructions, setSpecialInstructions] = useState({
    text: ''
  });

  const [uploadedFiles, setUploadedFiles] = useState([]);

  const [errors, setErrors] = useState({});

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : (name === 'num_pages' ? parseInt(value) || 5 : value)
    }));
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.topic.trim()) {
      newErrors.topic = 'Topic is required';
    }
    
    if (!formData.description.trim()) {
      newErrors.description = 'Description is required';
    }

    if (!MVP_HIDE_NUM_PAGES && (formData.num_pages < 1 || formData.num_pages > 50)) {
      newErrors.num_pages = 'Number of pages must be between 1 and 50';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Include special instructions and uploaded files in the submission
    const submissionData = {
      ...formData,
      num_pages: MVP_HIDE_NUM_PAGES ? null : formData.num_pages,
      specialInstructions: specialInstructions.text ? specialInstructions.text : null,
      uploadedFiles: uploadedFiles.length > 0 ? uploadedFiles : null
    };

    onStartGeneration(submissionData, formData.createProject);
  };

  const handleReset = () => {
    setFormData({
      topic: '',
      description: '',
      num_pages: 5,
      createProject: true
    });
    setSpecialInstructions({
      text: ''
    });
    setUploadedFiles([]);
    setErrors({});
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Generate Document</h2>
        <p className="text-gray-600">
          Enter your requirements and let AI generate a complete LaTeX document for you.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Topic Field */}
        <div>
          <label htmlFor="topic" className="block text-sm font-medium text-gray-700 mb-2">
            Document Topic *
          </label>
          <input
            type="text"
            id="topic"
            name="topic"
            value={formData.topic}
            onChange={handleInputChange}
            placeholder="e.g., Machine Learning in Healthcare"
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.topic ? 'border-red-500' : 'border-gray-300'
            }`}
            disabled={isGenerating}
          />
          {errors.topic && (
            <p className="mt-1 text-sm text-red-600">{errors.topic}</p>
          )}
        </div>

        {/* Description Field */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
            Document Description *
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleInputChange}
            placeholder="Describe the content, sections, style, and any constraints..."
            rows={4}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.description ? 'border-red-500' : 'border-gray-300'
            }`}
            disabled={isGenerating}
          />
          {errors.description && (
            <p className="mt-1 text-sm text-red-600">{errors.description}</p>
          )}
        </div>

        {/* Number of Pages Field - MVP: hidden; AI deduces adequate length */}
        {!MVP_HIDE_NUM_PAGES && (
          <div>
            <label htmlFor="num_pages" className="block text-sm font-medium text-gray-700 mb-2">
              Number of Pages
            </label>
            <div className="flex items-center space-x-4">
              <input
                type="number"
                id="num_pages"
                name="num_pages"
                value={formData.num_pages}
                onChange={handleInputChange}
                min="1"
                max="50"
                className={`w-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  errors.num_pages ? 'border-red-500' : 'border-gray-300'
                }`}
                disabled={isGenerating}
              />
              <span className="text-sm text-gray-600">
                (Recommended: 2-20 pages depending on document type)
              </span>
            </div>
            {errors.num_pages && (
              <p className="mt-1 text-sm text-red-600">{errors.num_pages}</p>
            )}
          </div>
        )}

        {/* Special Instructions Section */}
        <div className="border-t border-gray-200 pt-6">
          <SpecialInstructionsStep
            value={specialInstructions}
            onChange={setSpecialInstructions}
          />
        </div>

        {/* File Upload Section */}
        <div className="border-t border-gray-200 pt-6">
          <FileUploadStep
            value={uploadedFiles}
            onChange={setUploadedFiles}
          />
        </div>

        {/* Project Creation Option */}
        <div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="createProject"
              name="createProject"
              checked={formData.createProject}
              onChange={handleInputChange}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              disabled={isGenerating}
            />
            <label htmlFor="createProject" className="ml-2 block text-sm text-gray-700">
              Create project and extract files automatically
            </label>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            When enabled, the generated document will be automatically added to a new project with all files extracted and ready to edit.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={isGenerating}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-6 py-3 rounded-md font-medium transition-colors flex items-center justify-center"
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Starting Generation...
              </>
            ) : (
              'Generate Document'
            )}
          </button>
          
          <button
            type="button"
            onClick={handleReset}
            disabled={isGenerating}
            className="px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Reset
          </button>
        </div>
      </form>

      {/* Help Text */}
      <div className="mt-6 p-4 bg-blue-50 rounded-md">
        <h3 className="text-sm font-medium text-blue-800 mb-2">Tips for better results:</h3>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• Be specific about the target document type and objective</li>
          <li>• List required sections or slide flow explicitly</li>
          <li>• Include style/tone constraints and formatting preferences</li>
          <li>• Upload source files if the document should reuse existing material</li>
        </ul>
      </div>
    </div>
  );
}

