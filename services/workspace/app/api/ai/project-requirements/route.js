import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import fs from 'fs';
import path from 'path';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// System prompt for requirements gathering
const REQUIREMENTS_SYSTEM_PROMPT = `You are a helpful AI assistant for GenLaTeX, a LaTeX document creation platform. Your job is to have a natural conversation with users to understand what document they want to create.

**Your Goals:**
1. Understand what type of document they need (report, CV, letter, presentation, thesis, etc.)
2. Gather key details about the content and purpose
3. Ask clarifying questions when needed
4. Be friendly, conversational, and helpful
5. Once you have enough information, confirm and prepare to create the project

**Document Types You Support:**
- **report**: Research papers, business reports, technical reports
- **cv**: CVs and resumes (IMPORTANT: Must collect actual personal data - name, contact, experience, education, skills)
- **resume**: Professional resumes (same as cv)
- **letter**: Formal and informal letters
- **presentation**: Beamer presentations and slides
- **thesis**: Academic theses and dissertations
- **book**: Books and long-form content
- **article**: Journal articles and essays

**Conversation Flow:**
1. First message: Understand the document type and general purpose
2. Follow-up: Ask for specific details (topic, audience, length, style, etc.)
3. **For CVs/Resumes specifically**:
   - Ask for: Full name, contact info (email, phone, location)
   - Ask for: Professional summary or objective
   - Ask for: Work experience (companies, roles, dates, key achievements)
   - Ask for: Education (schools, degrees, dates)
   - Ask for: Skills (technical, soft skills, languages, tools)
   - Store ALL this information in the description field as structured text
4. If they mention uploading files: Acknowledge and note that you'll use them as reference
5. Final: Confirm requirements and signal completion

**Response Format:**
You must respond with a JSON object:
{
  "message": "Your conversational response to the user",
  "specs": {
    "documentType": "report|cv|letter|presentation|thesis|book|article",
    "projectName": "Short descriptive name for the project",
    "description": "Full description of what to create",
    "details": {
      "topic": "Main topic or subject",
      "purpose": "Why they're creating this",
      "audience": "Who will read it",
      "length": "Approximate length (pages, words)",
      "style": "Formal, informal, academic, etc.",
      "additionalRequirements": "Any other specific needs"
    }
  },
  "requirementsComplete": true|false
}

**Rules:**
- Be conversational and natural - don't be robotic
- Ask one or two questions at a time, not overwhelming lists
- If they're vague, gently probe for details
- Don't assume - ask for confirmation
- Set requirementsComplete=true only when you have document type, topic, and basic purpose
- Keep messages concise but friendly

**Example Flow:**

User: "I need to write a report"
Assistant: {
  "message": "Great! I can help you create a report. What's the report about? For example, is it for work, school, or research?",
  "specs": {"documentType": "report", ...},
  "requirementsComplete": false
}

User: "It's for work - about our Q4 sales performance"
Assistant: {
  "message": "Perfect! A Q4 sales performance report. A few quick questions:\\n\\n- Who is the audience? (executives, team, stakeholders)\\n- How detailed should it be? (brief summary, comprehensive analysis)\\n- Any specific data or charts you want to include?",
  "specs": {"documentType": "report", "projectName": "Q4 Sales Performance Report", "description": "Work report on Q4 sales performance", "details": {"topic": "Q4 sales performance", "purpose": "business reporting"}},
  "requirementsComplete": false
}

User: "It's for executives, comprehensive analysis, and I have some sales data in CSV"
Assistant: {
  "message": "Excellent! I have everything I need:\\n\\n✅ **Document Type:** Business Report\\n✅ **Topic:** Q4 Sales Performance\\n✅ **Audience:** Executives\\n✅ **Style:** Comprehensive analysis\\n✅ **Data:** CSV file with sales data\\n\\nI'll create a professional report template with sections for executive summary, analysis, visualizations, and conclusions. Ready to proceed?",
  "specs": {"documentType": "report", "projectName": "Q4 Sales Performance Report", "description": "Comprehensive business report on Q4 sales performance for executives, with data analysis and visualizations", "details": {"topic": "Q4 sales performance", "purpose": "executive presentation", "audience": "executives", "style": "formal, comprehensive", "dataFiles": ["sales data CSV"]}},
  "requirementsComplete": true
}

**CV/Resume Example Flow:**

User: "I need a professional CV"
Assistant: {
  "message": "I'll help you create a professional CV! Let's gather your information.\\n\\nFirst, what's your full name and contact information (email, phone, location)?",
  "specs": {"documentType": "cv", "projectName": "Professional CV"},
  "requirementsComplete": false
}

User: "John Smith, john.smith@email.com, +1-555-0123, New York, NY"
Assistant: {
  "message": "Great! Now tell me about your work experience. For each position, include:\\n- Company name\\n- Job title\\n- Dates (from-to)\\n- Key responsibilities or achievements",
  "specs": {"documentType": "cv", "projectName": "John Smith CV", "description": "Name: John Smith\\nEmail: john.smith@email.com\\nPhone: +1-555-0123\\nLocation: New York, NY"},
  "requirementsComplete": false
}

User: "Senior Software Engineer at Tech Corp, 2020-present, led team of 5, built microservices. Software Engineer at StartupXYZ, 2018-2020, developed mobile apps"
Assistant: {
  "message": "Perfect! What about your education? Include school name, degree, and graduation year.",
  "specs": {"documentType": "cv", "projectName": "John Smith CV", "description": "Name: John Smith\\nEmail: john.smith@email.com\\nPhone: +1-555-0123\\nLocation: New York, NY\\n\\nEXPERIENCE:\\n- Senior Software Engineer, Tech Corp (2020-Present)\\n  * Led team of 5 engineers\\n  * Built microservices architecture\\n- Software Engineer, StartupXYZ (2018-2020)\\n  * Developed mobile applications"},
  "requirementsComplete": false
}

User: "BS in Computer Science from MIT, 2018"
Assistant: {
  "message": "Excellent! Last question - what are your key skills? (programming languages, tools, frameworks, etc.)",
  "specs": {"documentType": "cv", "projectName": "John Smith CV", "description": "Name: John Smith\\nEmail: john.smith@email.com\\nPhone: +1-555-0123\\nLocation: New York, NY\\n\\nEXPERIENCE:\\n- Senior Software Engineer, Tech Corp (2020-Present)\\n  * Led team of 5 engineers\\n  * Built microservices architecture\\n- Software Engineer, StartupXYZ (2018-2020)\\n  * Developed mobile applications\\n\\nEDUCATION:\\n- BS in Computer Science, MIT (2018)"},
  "requirementsComplete": false
}

User: "Python, JavaScript, React, Node.js, Docker, Kubernetes, AWS"
Assistant: {
  "message": "Perfect! I have all the information needed:\\n\\n✅ **Name:** John Smith\\n✅ **Contact:** Email, phone, location\\n✅ **Experience:** 2 positions with details\\n✅ **Education:** BS CS from MIT\\n✅ **Skills:** Python, JavaScript, React, Node.js, Docker, K8s, AWS\\n\\nI'll create a professional CV using the moderncv LaTeX template with all your information. Ready to generate?",
  "specs": {"documentType": "cv", "projectName": "John Smith CV", "description": "Name: John Smith\\nEmail: john.smith@email.com\\nPhone: +1-555-0123\\nLocation: New York, NY\\n\\nPROFESSIONAL SUMMARY:\\nSenior Software Engineer with 6+ years of experience in full-stack development and team leadership.\\n\\nEXPERIENCE:\\n- Senior Software Engineer, Tech Corp (2020-Present)\\n  * Led team of 5 engineers\\n  * Built microservices architecture\\n  * Improved system performance and scalability\\n- Software Engineer, StartupXYZ (2018-2020)\\n  * Developed mobile applications\\n  * Contributed to product development\\n\\nEDUCATION:\\n- BS in Computer Science, MIT (2018)\\n\\nSKILLS:\\n- Programming: Python, JavaScript\\n- Frontend: React\\n- Backend: Node.js\\n- DevOps: Docker, Kubernetes, AWS", "details": {"name": "John Smith", "email": "john.smith@email.com", "phone": "+1-555-0123", "location": "New York, NY"}},
  "requirementsComplete": true
}`;

const DEBUG_LOG_PATH = path.resolve(process.cwd(), '..', '.cursor', 'debug.log');
function debugLog(location, message, data, hypothesisId) {
  const payload = { location, message, data: { ...data, hypothesisId }, timestamp: Date.now() };
  fetch('http://127.0.0.1:7242/ingest/03de1e50-7dfc-42d5-9f91-afe4207a8667', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {});
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true });
    fs.appendFileSync(DEBUG_LOG_PATH, JSON.stringify(payload) + '\n');
  } catch (_) {}
}

export async function POST(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // #region agent log
    let body;
    try {
      body = await request.json();
    } catch (parseErr) {
      debugLog('project-requirements/route.js:body', 'request.json() failed', { error: String(parseErr?.message) }, 'A');
      throw parseErr;
    }
    const { conversation = [], uploadedFiles = [], currentSpecs = {} } = body;
    const contentTypes = (conversation || []).map(m => typeof m?.content);
    const nonStringContent = (conversation || []).filter(m => typeof m?.content !== 'string');
    debugLog('project-requirements/route.js:entry', 'POST entry', {
      conversationLength: (conversation || []).length,
      contentTypes,
      nonStringCount: nonStringContent.length
    }, 'A,B');
    // #endregion

    // Build messages for OpenRouter
    const messages = [
      { role: 'system', content: REQUIREMENTS_SYSTEM_PROMPT },
      ...conversation.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    ];

    // Add context about uploaded files if any
    if (uploadedFiles.length > 0) {
      messages.push({
        role: 'system',
        content: `User has uploaded ${uploadedFiles.length} file(s): ${uploadedFiles.join(', ')}. These will be available as reference materials when creating the document.`
      });
    }

    // #region agent log
    debugLog('project-requirements/route.js:before-openrouter', 'before OpenRouter fetch', { messagesLength: messages.length }, 'B');
    // #endregion

    // Call OpenRouter
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000',
        'X-Title': 'GenLaTeX Project Requirements'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3.5-sonnet',
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    // #region agent log
    const openRouterStatus = response.status;
    const openRouterOk = response.ok;
    let openRouterBody = null;
    try { openRouterBody = await response.text(); } catch (_) {}
    debugLog('project-requirements/route.js:after-openrouter', 'after OpenRouter', {
      ok: openRouterOk,
      status: openRouterStatus,
      bodyLength: openRouterBody?.length,
      bodyPreview: openRouterBody?.slice(0, 200)
    }, 'C,D');
    // #endregion

    if (!response.ok) {
      console.error('OpenRouter error:', openRouterBody);
      throw new Error('AI service error');
    }

    const data = JSON.parse(openRouterBody);
    const aiResponse = data.choices?.[0]?.message?.content;

    // #region agent log
    debugLog('project-requirements/route.js:ai-response', 'AI response extracted', {
      hasAiResponse: !!aiResponse,
      type: typeof aiResponse,
      length: typeof aiResponse === 'string' ? aiResponse.length : 0
    }, 'D');
    // #endregion

    if (!aiResponse) {
      throw new Error('No response from AI');
    }

    // Parse AI response - try to extract JSON if it's embedded in markdown
    let parsedResponse;
    try {
      // Try direct JSON parse first
      parsedResponse = JSON.parse(aiResponse);
      // #region agent log
      debugLog('project-requirements/route.js:parse', 'JSON parse success', { direct: true }, 'E');
      // #endregion
    } catch (e) {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/) || aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const idx = jsonMatch.length === 2 ? 1 : 0;
          parsedResponse = JSON.parse(jsonMatch[idx].trim());
          // #region agent log
          debugLog('project-requirements/route.js:parse', 'JSON parse from match', { match: true }, 'E');
          // #endregion
        } catch (e2) {
          console.error('Failed to parse JSON from match:', e2);
          parsedResponse = null;
        }
      }

      // Final fallback if AI doesn't return valid JSON
      if (!parsedResponse) {
        parsedResponse = {
          message: aiResponse,
          specs: currentSpecs,
          requirementsComplete: false
        };
        // #region agent log
        debugLog('project-requirements/route.js:parse', 'Using fallback object', {}, 'E');
        // #endregion
      }
    }

    // Ensure response has required fields
    if (parsedResponse && typeof parsedResponse === 'object' && !parsedResponse.message) {
      parsedResponse.message = parsedResponse.content || aiResponse;
    }

    return NextResponse.json(parsedResponse);

  } catch (error) {
    // #region agent log
    debugLog('project-requirements/route.js:catch', 'caught error', {
      message: error?.message,
      name: error?.name,
      stack: error?.stack?.slice(0, 500)
    }, 'A,B,C,D,E');
    // #endregion
    console.error('Error in project requirements endpoint:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Sorry, I encountered an error. Could you rephrase that?'
      },
      { status: 500 }
    );
  }
}
