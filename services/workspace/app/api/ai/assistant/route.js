/**
 * AI Assistant API
 */

import { NextResponse } from 'next/server';
import { AIWritingAssistant } from '@/lib/ai-assistant.js';

export async function POST(request) {
  try {
    const { action, data } = await request.json();
    
    const aiAssistant = new AIWritingAssistant();
    
    let result;
    
    switch (action) {
      case 'analyze_text':
        result = await aiAssistant.analyzeText(data.text, data.context);
        break;
      case 'generate_suggestions':
        result = await aiAssistant.generateSuggestions(data.text, data.position, data.context);
        break;
      case 'suggest_latex_commands':
        result = await aiAssistant.suggestLaTeXCommands(data.partialCommand, data.context);
        break;
      case 'check_latex_errors':
        result = await aiAssistant.checkLaTeXErrors(data.text);
        break;
      case 'suggest_improvements':
        result = await aiAssistant.suggestLaTeXImprovements(data.text, data.context);
        break;
      case 'generate_latex_content':
        result = await aiAssistant.generateLaTeXContent(data.requirements, data.context);
        break;
      case 'fix_latex_errors':
        result = await aiAssistant.fixLaTeXErrors(data.text, data.errors);
        break;
      case 'generate_abstract':
        result = await aiAssistant.generateAbstract(data.content, data.context);
        break;
      case 'improve_writing':
        result = await aiAssistant.improveWriting(data.text, data.style);
        break;
      case 'generate_citations':
        result = await aiAssistant.generateCitations(data.topic, data.count);
        break;
      case 'generate_research_questions':
        result = await aiAssistant.generateResearchQuestions(data.topic, data.context);
        break;
      case 'summarize_content':
        result = await aiAssistant.summarizeContent(data.text, data.maxLength);
        break;
      case 'translate_content':
        result = await aiAssistant.translateContent(data.text, data.targetLanguage);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in AI assistant:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
