/**
 * Research Integration Component
 * Main component for managing GitHub, Zotero, and AI features
 */

'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ResearchIntegration({ projectId }) {
  const [activeTab, setActiveTab] = useState('github');
  const [githubLink, setGithubLink] = useState(null);
  const [zoteroConfig, setZoteroConfig] = useState(null);
  const [mendeleyConfig, setMendeleyConfig] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadGitHubLink();
    loadZoteroConfig();
    loadMendeleyConfig();
  }, [projectId]);

  const loadGitHubLink = async () => {
    try {
      const response = await fetch(`/api/github/link?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setGithubLink(data);
      }
    } catch (error) {
      console.error('Error loading GitHub link:', error);
    }
  };

  const loadZoteroConfig = async () => {
    try {
      const response = await fetch(`/api/zotero/sync?projectId=${projectId}&type=config`);
      if (response.ok) {
        const data = await response.json();
        setZoteroConfig(data);
      }
    } catch (error) {
      console.error('Error loading Zotero config:', error);
    }
  };

  const loadMendeleyConfig = async () => {
    try {
      const response = await fetch(`/api/mendeley/sync?projectId=${projectId}&type=config`);
      if (response.ok) {
        const data = await response.json();
        setMendeleyConfig(data);
      }
    } catch (error) {
      console.error('Error loading Mendeley config:', error);
    }
  };

  const tabs = [
    { id: 'github', label: 'GitHub', icon: '🔗' },
    { id: 'zotero', label: 'Zotero', icon: '📚' },
    { id: 'mendeley', label: 'Mendeley', icon: '📖' }
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm border">
      {/* Header */}
      <div className="px-6 py-4 border-b">
        <h2 className="text-xl font-semibold text-gray-900">Research Integration</h2>
        <p className="text-sm text-gray-600 mt-1">
          Connect GitHub repositories, zotero and mendeley, manage references and files....
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex space-x-8 px-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'github' && (
              <GitHubTab 
                projectId={projectId}
                githubLink={githubLink}
                onLinkChange={loadGitHubLink}
              />
            )}
            {activeTab === 'zotero' && (
              <ZoteroTab 
                projectId={projectId}
                zoteroConfig={zoteroConfig}
                onConfigChange={loadZoteroConfig}
              />
            )}
            {activeTab === 'mendeley' && (
              <MendeleyTab 
                projectId={projectId}
                mendeleyConfig={mendeleyConfig}
                onConfigChange={loadMendeleyConfig}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-6 pb-4">
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// GitHub Tab Component
function GitHubTab({ projectId, githubLink, onLinkChange }) {
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [accessToken, setAccessToken] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLinkRepository = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/github/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          repoUrl,
          branch,
          accessToken
        })
      });

      const data = await response.json();

      if (data.success) {
        onLinkChange();
        setRepoUrl('');
        setAccessToken('');
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Error linking repository:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlinkRepository = async () => {
    setLoading(true);

    try {
      const response = await fetch(`/api/github/link?projectId=${projectId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        onLinkChange();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Error unlinking repository:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {githubLink ? (
        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-green-800">Repository Linked</h3>
              <p className="text-sm text-green-700 mt-1">
                {githubLink.linked_repo} (branch: {githubLink.branch})
              </p>
              <p className="text-xs text-green-600 mt-1">
                Linked on {new Date(githubLink.linked_at).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={handleUnlinkRepository}
              disabled={loading}
              className="ml-4 bg-red-100 text-red-800 px-3 py-1 rounded-md text-sm hover:bg-red-200 disabled:opacity-50"
            >
              {loading ? 'Unlinking...' : 'Unlink'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleLinkRepository} className="space-y-4">
          <div>
            <label htmlFor="repoUrl" className="block text-sm font-medium text-gray-700">
              GitHub Repository URL
            </label>
            <input
              type="url"
              id="repoUrl"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/username/repository"
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="branch" className="block text-sm font-medium text-gray-700">
              Branch
            </label>
            <input
              type="text"
              id="branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="accessToken" className="block text-sm font-medium text-gray-700">
              GitHub Access Token (optional)
            </label>
            <input
              type="password"
              id="accessToken"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="ghp_..."
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Required for private repositories
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !repoUrl}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Linking...' : 'Link Repository'}
          </button>
        </form>
      )}

      {githubLink && (
        <div className="bg-gray-50 rounded-md p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Repository Analysis</h4>
          {githubLink.metadata && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Languages:</span>
                <span className="ml-2 text-gray-900">
                  {githubLink.metadata.languages?.join(', ') || 'Unknown'}
                </span>
              </div>
              <div>
                <span className="text-gray-600">Key Files:</span>
                <span className="ml-2 text-gray-900">
                  {githubLink.metadata.key_files?.length || 0}
                </span>
              </div>
              <div>
                <span className="text-gray-600">Figures:</span>
                <span className="ml-2 text-gray-900">
                  {githubLink.metadata.figures?.length || 0}
                </span>
              </div>
              <div>
                <span className="text-gray-600">Description:</span>
                <span className="ml-2 text-gray-900">
                  {githubLink.metadata.readme_summary || 'No description'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Zotero Tab Component
function ZoteroTab({ projectId, zoteroConfig, onConfigChange }) {
  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null); // 'success', 'error', null

  const handleTestConnection = async () => {
    if (!userId || !apiKey) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/zotero/sync?userId=${userId}&apiKey=${apiKey}&type=test`);
      const data = await response.json();

      if (data.success) {
        // Show success message
        alert(`✅ Zotero connection successful!\nUser: ${data.user}\nName: ${data.name}`);
        
        // Load collections
        const collectionsResponse = await fetch(`/api/zotero/sync?userId=${userId}&apiKey=${apiKey}&type=collections`);
        const collectionsData = await collectionsResponse.json();

        if (collectionsData.success) {
          setCollections(collectionsData.collections);
        }
      } else {
        // Show detailed error information
        const errorMsg = data.details ? 
          `Error: ${data.error}\nDetails: ${JSON.stringify(data.details, null, 2)}` : 
          data.error;
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('Error testing connection:', error);
      console.error('Full error details:', error);
      alert('❌ Zotero connection failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (syncType) => {
    setLoading(true);
    try {
      const response = await fetch('/api/zotero/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          userId,
          apiKey,
          collectionKey: selectedCollection,
          syncType
        })
      });

      const data = await response.json();

      if (data.success) {
        onConfigChange();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Error syncing with Zotero:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <label htmlFor="userId" className="block text-sm font-medium text-gray-700">
            Zotero User ID
          </label>
          <input
            type="text"
            id="userId"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="123456"
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700">
            Zotero API Key
          </label>
          <input
            type="password"
            id="apiKey"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="abc123..."
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Get your API key from <a href="https://www.zotero.org/settings/keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-500">Zotero Settings</a>
          </p>
        </div>

        <button
          onClick={handleTestConnection}
          disabled={loading || !userId || !apiKey}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Testing...' : 'Test Connection'}
        </button>
      </div>

      {collections.length > 0 && (
        <div className="space-y-4">
          <div>
            <label htmlFor="collection" className="block text-sm font-medium text-gray-700">
              Select Collection (optional)
            </label>
            <select
              id="collection"
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
              <option value="">All items</option>
              {collections.map((collection) => (
                <option key={collection.key} value={collection.key}>
                  {collection.name} ({collection.itemCount} items)
                </option>
              ))}
            </select>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={() => handleSync(selectedCollection ? 'collection' : 'all')}
              disabled={loading}
              className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Syncing...' : 'Sync References'}
            </button>
          </div>
        </div>
      )}

      {zoteroConfig && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <h4 className="text-sm font-medium text-green-800 mb-2">Sync Status</h4>
          <p className="text-sm text-green-700">
            Last synced: {new Date(zoteroConfig.synced_at).toLocaleString()}
          </p>
          <p className="text-sm text-green-700">
            Items synced: {zoteroConfig.item_count}
          </p>
        </div>
      )}
    </div>
  );
}

// Mendeley Tab Component
function MendeleyTab({ projectId, mendeleyConfig, onConfigChange }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);

  const handleTestConnection = async () => {
    if (!clientId || !clientSecret) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/mendeley/sync?clientId=${clientId}&clientSecret=${clientSecret}&type=test`);
      const data = await response.json();

      if (data.success) {
        alert(`✅ Mendeley connection successful!\nUser: ${data.user}\nName: ${data.name}`);
        
        // Load collections
        const collectionsResponse = await fetch(`/api/mendeley/sync?clientId=${clientId}&clientSecret=${clientSecret}&type=collections`);
        const collectionsData = await collectionsResponse.json();

        if (collectionsData.success) {
          setCollections(collectionsData.collections);
        }
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Error testing connection:', error);
      alert('❌ Mendeley connection failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (syncType) => {
    setLoading(true);
    try {
      const response = await fetch('/api/mendeley/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          clientId,
          clientSecret,
          accessToken,
          refreshToken,
          collectionId: selectedCollection,
          syncType
        })
      });

      const data = await response.json();

      if (data.success) {
        onConfigChange();
        alert('Mendeley sync completed successfully!');
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Error syncing with Mendeley:', error);
      alert('Error syncing with Mendeley: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <label htmlFor="clientId" className="block text-sm font-medium text-gray-700">
            Mendeley Client ID
          </label>
          <input
            type="text"
            id="clientId"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="12345678-abcd-1234-efgh-123456789012"
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="clientSecret" className="block text-sm font-medium text-gray-700">
            Mendeley Client Secret
          </label>
          <input
            type="password"
            id="clientSecret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="abcdef123456..."
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Get your credentials from <a href="https://dev.mendeley.com/myapps.html" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-500">Mendeley Developer Portal</a>
          </p>
        </div>

        <div>
          <label htmlFor="accessToken" className="block text-sm font-medium text-gray-700">
            Access Token (optional)
          </label>
          <input
            type="password"
            id="accessToken"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="MSwxMjM0NTY3ODkw..."
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="refreshToken" className="block text-sm font-medium text-gray-700">
            Refresh Token (optional)
          </label>
          <input
            type="password"
            id="refreshToken"
            value={refreshToken}
            onChange={(e) => setRefreshToken(e.target.value)}
            placeholder="MSwxMjM0NTY3ODkw..."
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <button
          onClick={handleTestConnection}
          disabled={loading || !clientId || !clientSecret}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Testing...' : 'Test Connection'}
        </button>
      </div>

      {collections.length > 0 && (
        <div className="space-y-4">
          <div>
            <label htmlFor="collection" className="block text-sm font-medium text-gray-700">
              Select Collection (optional)
            </label>
            <select
              id="collection"
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
              <option value="">All documents</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name} ({collection.document_count} documents)
                </option>
              ))}
            </select>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={() => handleSync(selectedCollection ? 'collection' : 'all')}
              disabled={loading}
              className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Syncing...' : 'Sync References'}
            </button>
          </div>
        </div>
      )}

      {mendeleyConfig && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <h4 className="text-sm font-medium text-green-800 mb-2">Sync Status</h4>
          <p className="text-sm text-green-700">
            Last synced: {new Date(mendeleyConfig.synced_at).toLocaleString()}
          </p>
          <p className="text-sm text-green-700">
            Documents synced: {mendeleyConfig.document_count}
          </p>
        </div>
      )}

    </div>
  );
}

