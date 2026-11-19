import { NextResponse } from 'next/server';
import { genlatexAgentClient } from '@/lib/genlatex-agent-client.js';
import { canUserUseAI, recordAIUsage } from '@/lib/user-subscription.js';
import { AI_TOKEN_COSTS } from '@/lib/ai-token-costs.js';
import { readFile, writeFile } from '@/lib/files.js';

export async function POST(request) {
  try {
    const { prompt, content, context = {}, userId, projectId } = await request.json();

    if (!prompt) {
      return NextResponse.json({ 
        success: false,
        result: '',
        error: 'Prompt is required',
        paper_id: null,
        citations: []
      }, { status: 400 });
    }

    // Check AI usage limits if userId is provided
    if (userId) {
      const tokenCost = AI_TOKEN_COSTS.chat;
      const canUse = await canUserUseAI(userId, tokenCost);

      if (!canUse.allowed) {
        return NextResponse.json({
          success: false,
          result: '',
          error: 'AI token limit reached. Upgrade to Pro for unlimited AI requests.',
          tokensUsed: canUse.tokensUsed,
          tokenLimit: canUse.tokenLimit,
          remaining: canUse.remaining,
          upgradeRequired: true,
          paper_id: null,
          citations: []
        }, { status: 403 });
      }
    }

    if (!genlatexAgentClient.isEnabled()) {
      return NextResponse.json({
        success: false,
        result: '',
        error: 'GenLaTeX Agent is not enabled',
        paper_id: null,
        citations: []
      }, { status: 503 });
    }

    // Call genlatex-agent
    const result = await genlatexAgentClient.makePaper({
      prompt,
      content: content || '',
      context
    });

    if (result.success) {
      // Record AI usage
      if (userId) {
        try {
          await recordAIUsage(userId, AI_TOKEN_COSTS.chat);
        } catch (error) {
          console.error('Error recording AI usage:', error);
        }
      }

      // Handle file operations if projectId is provided (write directly to storage: MinIO or FS)
      if (projectId && result.result) {
        try {
          const targetFile = context.targetFile || 'main.tex';
          console.log(`📝 Replacing entire file: ${targetFile}`);
          await writeFile(projectId, targetFile, result.result);
          console.log(`✅ Replaced ${targetFile} with complete paper content`);

          if (result.citations && result.citations.length > 0) {
            let bibContent = '';
            try {
              const data = await readFile(projectId, 'references.bib', { encoding: 'utf8' });
              if (data) bibContent = typeof data === 'string' ? data : data.toString('utf8');
            } catch {
              // File doesn't exist, start fresh
            }

            for (const citation of result.citations) {
              if (citation.key || citation.citation_key) {
                const key = citation.key || citation.citation_key;
                const title = citation.title || 'Unknown Title';
                const authors = Array.isArray(citation.authors) ? citation.authors.join(' and ') : (citation.authors || 'Unknown');
                const year = citation.year || '2024';
                const url = citation.url || '';
                bibContent += `@article{${key},
  title={${title}},
  author={${authors}},
  year={${year}}${url ? `,
  url={${url}}` : ''}
}

`;
              }
            }

            await writeFile(projectId, 'references.bib', bibContent);
            console.log(`✅ Created/updated references.bib with ${result.citations.length} citation(s)`);
          }
        } catch (fileError) {
          console.error('Error writing files:', fileError);
          // Continue even if file write fails - return success but log error
        }
      }

      return NextResponse.json({
        success: true,
        result: result.result,
        citations: result.citations || [],
        paper_id: result.paper_id || null,
        agent: 'genlatex-agent',
        message: projectId ? 'Paper generated and saved to project' : 'Paper generated',
        error: null
      });
    } else {
      return NextResponse.json({
        success: false,
        result: result.result || '',
        error: result.error || 'Failed to generate paper',
        paper_id: null,
        citations: []
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Make Paper API error:', error);
    return NextResponse.json({
      success: false,
      result: '',
      error: error.message || 'Failed to process request',
      paper_id: null,
      citations: []
    }, { status: 500 });
  }
}
