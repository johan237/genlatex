/**
 * Zotero Integration API (Pro only)
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { isUserPro } from '@/lib/user-subscription.js';

export async function POST(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const isPro = await isUserPro(session.id);
    if (!isPro) {
      return NextResponse.json(
        {
          error: 'zotero_pro_only',
          message: 'Zotero integration requires a Pro subscription',
          upgradeUrl: '/dashboard?openUpgrade=1'
        },
        { status: 403 }
      );
    }

    const { projectId, userId, apiKey, collectionKey, syncType = 'collection' } = await request.json();
    
    if (!projectId || !userId || !apiKey) {
      return NextResponse.json(
        { error: 'Project ID, Zotero user ID, and API key are required' },
        { status: 400 }
      );
    }
    
    // Simple test connection
    try {
      const testResponse = await fetch(`https://api.zotero.org/users/${userId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!testResponse.ok) {
        return NextResponse.json(
          { error: `Zotero connection failed: HTTP ${testResponse.status}` },
          { status: 400 }
        );
      }
      
      const userInfo = await testResponse.json();
      
      return NextResponse.json({
        success: true,
        message: 'Zotero connection successful',
        user_info: {
          username: userInfo.username,
          name: userInfo.name
        }
      });
    } catch (error) {
      return NextResponse.json(
        { error: `Zotero connection failed: ${error.message}` },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error syncing with Zotero:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const isPro = await isUserPro(session.id);
    if (!isPro) {
      return NextResponse.json(
        {
          error: 'zotero_pro_only',
          message: 'Zotero integration requires a Pro subscription',
          upgradeUrl: '/dashboard?openUpgrade=1'
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const apiKey = searchParams.get('apiKey');
    const type = searchParams.get('type') || 'collections';
    const projectId = searchParams.get('projectId');
    
    // Handle config requests
    if (type === 'config' && projectId) {
      const { readFile } = await import('@/lib/files.js');
      try {
        const config = await readFile(projectId, 'zotero_config.json', { encoding: 'utf8' });
        if (!config) throw new Error('No config');
        const str = typeof config === 'string' ? config : (Buffer.isBuffer(config) ? config.toString('utf8') : String(config));
        return NextResponse.json({
          success: true,
          ...JSON.parse(str)
        });
      } catch (error) {
        return NextResponse.json(
          { error: 'No Zotero configuration found' },
          { status: 404 }
        );
      }
    }
    
    if (!userId || !apiKey) {
      return NextResponse.json(
        { error: 'Zotero user ID and API key are required' },
        { status: 400 }
      );
    }
    
    let result;
    
    if (type === 'test') {
      // Test connection using items endpoint (which we know works)
      console.log('🔍 Testing Zotero connection...');
      console.log('📋 User ID:', userId, '(type:', typeof userId, ')');
      console.log('🔑 API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'MISSING', '(length:', apiKey ? apiKey.length : 0, ')');
      
      // Validate inputs
      if (!userId || userId.trim() === '') {
        console.log('❌ User ID is empty or invalid');
        result = {
          success: false,
          error: 'User ID is required and cannot be empty'
        };
      } else if (!apiKey || apiKey.trim() === '') {
        console.log('❌ API Key is empty or invalid');
        result = {
          success: false,
          error: 'API Key is required and cannot be empty'
        };
      } else {
        try {
          // Test using items endpoint (which works)
          const itemsUrl = `https://api.zotero.org/users/${userId}/items?limit=1`;
          console.log('🌐 Testing with Items URL:', itemsUrl);
          
          const headers = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'GenLaTeX/1.0'
          };
          
          const testResponse = await fetch(itemsUrl, {
            method: 'GET',
            headers: headers
          });
          
          console.log('📡 Response Status:', testResponse.status);
          console.log('📡 Response Status Text:', testResponse.statusText);
          
          if (!testResponse.ok) {
            const errorText = await testResponse.text();
            console.log('❌ Error Response Body:', errorText);
            
            result = {
              success: false,
              error: `HTTP ${testResponse.status}: ${testResponse.statusText}`,
              details: errorText,
              url: itemsUrl
            };
          } else {
            const items = await testResponse.json();
            console.log('✅ Connection successful! Found', items.length, 'items');
            
            result = {
              success: true,
              user: `User ${userId}`,
              name: 'Zotero User',
              userId: userId,
              itemsCount: items.length
            };
          }
        } catch (error) {
          console.error('💥 Fetch Error:', error);
          result = {
            success: false,
            error: error.message,
            stack: error.stack
          };
        }
      }
    } else if (type === 'collections') {
      // Get collections
      console.log('📚 Getting Zotero collections...');
      console.log('📋 User ID:', userId);
      console.log('🔑 API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'MISSING');
      
      try {
        const collectionsUrl = `https://api.zotero.org/users/${userId}/collections`;
        console.log('🌐 Collections URL:', collectionsUrl);
        
        const collectionsResponse = await fetch(collectionsUrl, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        console.log('📡 Collections Response Status:', collectionsResponse.status);
        console.log('📡 Collections Response Status Text:', collectionsResponse.statusText);
        
        if (!collectionsResponse.ok) {
          const errorText = await collectionsResponse.text();
          console.log('❌ Collections Error Response Body:', errorText);
          
          result = {
            success: false,
            error: `HTTP ${collectionsResponse.status}: ${collectionsResponse.statusText}`,
            details: errorText,
            url: collectionsUrl
          };
        } else {
          const collections = await collectionsResponse.json();
          console.log('✅ Collections Data:', collections);
          
          result = {
            success: true,
            collections: collections.map(col => ({
              key: col.key,
              name: col.data.name,
              parent: col.data.parentCollection,
              itemCount: col.meta.numItems
            }))
          };
        }
      } catch (error) {
        console.error('💥 Collections Fetch Error:', error);
        result = {
          success: false,
          error: error.message,
          stack: error.stack
        };
      }
    } else if (type === 'ping') {
      // Simple ping test
      result = {
        success: true,
        message: 'Zotero API endpoint is working',
        timestamp: new Date().toISOString(),
        userId: userId,
        apiKeyLength: apiKey ? apiKey.length : 0
      };
    } else {
      return NextResponse.json(
        { error: 'Invalid type. Use "collections", "test", or "ping"' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting Zotero data:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
