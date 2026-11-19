/**
 * Mendeley Integration API
 * Handles Mendeley library synchronization and reference management
 */

import { NextResponse } from 'next/server';

// Mendeley API configuration
const MENDELEY_API_BASE = 'https://api.mendeley.com';

// Helper function to get Mendeley access token
async function getMendeleyToken(clientId, clientSecret) {
  try {
    const response = await fetch('https://api.mendeley.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'all'
      })
    });

    if (!response.ok) {
      throw new Error(`Token request failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Error getting Mendeley token:', error);
    throw error;
  }
}

// Test Mendeley connection
async function testMendeleyConnection(clientId, clientSecret) {
  try {
    const token = await getMendeleyToken(clientId, clientSecret);
    
    // Test API access by getting user profile
    const response = await fetch(`${MENDELEY_API_BASE}/profiles/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.mendeley-document.1+json'
      }
    });

    if (!response.ok) {
      throw new Error(`API test failed: ${response.statusText}`);
    }

    const profile = await response.json();
    return {
      success: true,
      user: profile.id,
      name: profile.display_name || profile.first_name + ' ' + profile.last_name
    };
  } catch (error) {
    console.error('Mendeley connection test failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Get Mendeley collections
async function getMendeleyCollections(clientId, clientSecret) {
  try {
    const token = await getMendeleyToken(clientId, clientSecret);
    
    const response = await fetch(`${MENDELEY_API_BASE}/collections`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.mendeley-document.1+json'
      }
    });

    if (!response.ok) {
      throw new Error(`Collections request failed: ${response.statusText}`);
    }

    const collections = await response.json();
    return {
      success: true,
      collections: collections.map(collection => ({
        id: collection.id,
        name: collection.name,
        document_count: collection.document_count || 0
      }))
    };
  } catch (error) {
    console.error('Error getting Mendeley collections:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Sync Mendeley documents
async function syncMendeleyDocuments(clientId, clientSecret, collectionId = null) {
  try {
    const token = await getMendeleyToken(clientId, clientSecret);
    
    // Build URL for documents (with or without collection filter)
    let url = `${MENDELEY_API_BASE}/documents`;
    if (collectionId) {
      url = `${MENDELEY_API_BASE}/collections/${collectionId}/documents`;
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.mendeley-document.1+json'
      }
    });

    if (!response.ok) {
      throw new Error(`Documents request failed: ${response.statusText}`);
    }

    const documents = await response.json();
    
    // Process documents for LaTeX bibliography
    const processedDocuments = documents.map(doc => ({
      id: doc.id,
      title: doc.title,
      authors: doc.authors?.map(author => `${author.first_name} ${author.last_name}`).join(', ') || 'Unknown',
      year: doc.year,
      journal: doc.source,
      doi: doc.identifiers?.find(id => id.type === 'doi')?.value,
      url: doc.identifiers?.find(id => id.type === 'url')?.value,
      abstract: doc.abstract,
      keywords: doc.keywords?.join(', '),
      type: doc.type || 'article'
    }));

    return {
      success: true,
      documents: processedDocuments,
      count: processedDocuments.length
    };
  } catch (error) {
    console.error('Error syncing Mendeley documents:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// GET - Test connection or get collections
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const clientSecret = searchParams.get('clientSecret');
    const type = searchParams.get('type') || 'test';

    if (!clientId || !clientSecret) {
      return NextResponse.json({
        success: false,
        error: 'Client ID and Client Secret are required'
      }, { status: 400 });
    }

    switch (type) {
      case 'test':
        const testResult = await testMendeleyConnection(clientId, clientSecret);
        return NextResponse.json(testResult);

      case 'collections':
        const collectionsResult = await getMendeleyCollections(clientId, clientSecret);
        return NextResponse.json(collectionsResult);

      case 'config':
        // Return stored configuration (placeholder)
        return NextResponse.json({
          success: true,
          config: null // Would be loaded from database
        });

      default:
        return NextResponse.json({
          success: false,
          error: 'Invalid request type'
        }, { status: 400 });
    }
  } catch (error) {
    console.error('Mendeley API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}

// POST - Sync documents
export async function POST(request) {
  try {
    const { projectId, clientId, clientSecret, collectionId, syncType } = await request.json();

    if (!projectId || !clientId || !clientSecret) {
      return NextResponse.json({
        success: false,
        error: 'Project ID, Client ID, and Client Secret are required'
      }, { status: 400 });
    }

    // Sync documents from Mendeley
    const syncResult = await syncMendeleyDocuments(clientId, clientSecret, collectionId);

    if (!syncResult.success) {
      return NextResponse.json(syncResult, { status: 400 });
    }

    // Here you would typically save the synced documents to your database
    // For now, we'll just return the success response
    
    return NextResponse.json({
      success: true,
      message: 'Mendeley sync completed successfully',
      documentCount: syncResult.count,
      syncedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Mendeley sync error:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}
