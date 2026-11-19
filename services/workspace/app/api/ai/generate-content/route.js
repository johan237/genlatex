/**
 * AI Content Generation API
 * Generates initial content based on user inputs and project type
 */

import { NextResponse } from 'next/server';
import { AIModelClient } from '@/lib/aimodel-client.js';

export async function POST(request) {
  try {
    const { projectType, projectData, session } = await request.json();

    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const aiClient = new AIModelClient();
    
    // Generate content based on project type
    let generatedContent = '';
    let template = '';
    
    switch (projectType) {
      case 'research':
        generatedContent = await generateResearchContent(deepseek, projectData);
        template = getResearchTemplate(projectData);
        break;
      case 'review':
        generatedContent = await generateReviewContent(deepseek, projectData);
        template = getReviewTemplate(projectData);
        break;
      case 'project':
        generatedContent = await generateProjectContent(deepseek, projectData);
        template = getProjectTemplate(projectData);
        break;
      case 'blog':
        generatedContent = await generateBlogContent(deepseek, projectData);
        template = getBlogTemplate(projectData);
        break;
      default:
        return NextResponse.json({ error: 'Invalid project type' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      content: generatedContent,
      template: template,
      metadata: {
        projectType,
        generatedAt: new Date().toISOString(),
        editor: projectData.editor || 'latex'
      }
    });

  } catch (error) {
    console.error('AI content generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate content', details: error.message },
      { status: 500 }
    );
  }
}

async function generateResearchContent(deepseek, data) {
  const prompt = `Generate a comprehensive research article structure and initial content based on the following information:

Project Name: ${data.name || 'Research Project'}
Template: ${data.format || 'Basic Template'}
Publication Target: ${data.publicationTarget || 'Academic Journal'}
Editor: ${data.editor || 'LaTeX'}

Extra Materials:
- GitHub Link: ${data.extraMaterials?.githubLink || 'None'}
- Upload Code: ${data.extraMaterials?.uploadCode ? 'Yes' : 'No'}
- Upload Files: ${data.extraMaterials?.uploadFiles ? 'Yes' : 'No'}
- Upload Review: ${data.extraMaterials?.uploadReview ? 'Yes' : 'No'}

Please generate:
1. A complete LaTeX document structure with appropriate sections
2. Placeholder content for each section with guidance on what to include
3. Professional academic paper structure
4. Bibliography structure
5. Abstract and keywords sections

Focus on creating a professional academic paper structure that can be customized by the user.`;

  const response = await aiClient.generateLaTeXContent(prompt, data);
  return response.content || response;
}

async function generateReviewContent(deepseek, data) {
  const prompt = `Generate a comprehensive review article structure and initial content based on the following information:

Project Name: ${data.name || 'Review Article'}
Focus Type: ${data.focus || 'Thematic'}
Editor: ${data.editor || 'LaTeX'}

Sources Information:
- DOIs: ${data.sources?.addDOIs || 'None provided'}
- Upload PDFs: ${data.sources?.uploadPDFs ? 'Yes' : 'No'}
- AI Enrichment: ${data.sources?.aiEnrichment ? 'Enabled' : 'Disabled'}

Please generate:
1. A complete LaTeX document structure appropriate for a review article
2. Placeholder content for each section with guidance on what to include
3. Literature review framework based on the focus type (${data.focus})
4. Methodology section for systematic review approach
5. Bibliography structure with example entries
6. Abstract and keywords sections

Focus on creating a comprehensive review structure that can accommodate the specified focus type and source materials.`;

  const response = await aiClient.generateLaTeXContent(prompt, data);
  return response.content || response;
}

async function generateProjectContent(deepseek, data) {
  const prompt = `Generate a comprehensive project document structure and initial content based on the following information:

Project Name: ${data.name || 'Project Document'}
Project Type: ${data.projectType || 'Assignment'}
Editor: ${data.editor || 'LaTeX'}

Attachments:
- Upload Templates: ${data.attachments?.uploadTemplates ? 'Yes' : 'No'}
- Upload Code: ${data.attachments?.uploadCode ? 'Yes' : 'No'}
- Upload Answers: ${data.attachments?.uploadAnswers ? 'Yes' : 'No'}
- AI Analysis: ${data.attachments?.aiAnalysis ? 'Enabled' : 'Disabled'}

Please generate:
1. A complete document structure appropriate for the project type (${data.projectType})
2. Placeholder content for each section with guidance on what to include
3. Methodology and approach sections
4. Results and analysis framework
5. Conclusion and recommendations sections
6. Bibliography structure if needed

Focus on creating a professional document structure that matches the project type and can accommodate the specified attachments.`;

  const response = await aiClient.generateLaTeXContent(prompt, data);
  return response.content || response;
}

async function generateBlogContent(deepseek, data) {
  const prompt = `Generate a comprehensive blog post structure and initial content based on the following information:

Project Name: ${data.name || 'Blog Post'}
Description: ${data.description || 'Blog post about an interesting topic'}
Editor: ${data.editor || 'Tiptap'}

Optional Links:
- Source Links: ${data.optionalLinks?.sourceLinks || 'None'}
- References: ${data.optionalLinks?.references || 'None'}
- Discussion Points: ${data.optionalLinks?.discussionPoints || 'None'}
- Media Embeds: ${data.optionalLinks?.media ? 'Enabled' : 'Disabled'}

Please generate:
1. A complete blog post structure with engaging sections
2. Initial content based on the description provided
3. Introduction that hooks the reader
4. Main content sections with clear headings
5. Conclusion that summarizes key points
6. Call-to-action or discussion prompts

Focus on creating an engaging, well-structured blog post that incorporates the provided description and optional materials.`;

  const response = await aiClient.generateLaTeXContent(prompt, data);
  return response.content || response;
}

function getResearchTemplate(data) {
  // Return a basic template that users can customize
  return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}

\\title{${data.name || 'Your Research Title'}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
Your abstract goes here. This should be a concise summary of your research, including the problem, methodology, key findings, and conclusions.
\\end{abstract}

\\textbf{Keywords:} keyword1, keyword2, keyword3

\\section{Introduction}
Your introduction section. Start with the motivation and background, then state your research question and contributions.

\\section{Related Work}
Review of relevant literature and previous work in your field.

\\section{Methodology}
Describe your approach, methods, and experimental setup.

\\section{Results}
Present your findings with appropriate figures and tables.

\\section{Discussion}
Analyze your results and discuss their implications.

\\section{Conclusion}
Summarize your contributions and suggest future work.

\\begin{thebibliography}{99}
\\bibitem{ref1}
Sample reference
\\end{thebibliography}

\\end{document}`;
}

function getReviewTemplate(data) {
  return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}

\\title{${data.name || 'Your Review Article Title'}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
Your abstract goes here. This should summarize the scope of your review, the methodology used, and key findings.
\\end{abstract}

\\textbf{Keywords:} keyword1, keyword2, keyword3

\\section{Introduction}
Your introduction section. Provide context and motivation for the review.

\\section{Methodology}
Describe your review methodology, search strategy, and inclusion/exclusion criteria.

\\section{Results}
Present your findings organized by the focus type (${data.focus || 'thematic'}).

\\section{Discussion}
Analyze the findings and discuss implications.

\\section{Conclusion}
Summarize key findings and suggest future research directions.

\\begin{thebibliography}{99}
\\bibitem{ref1}
Sample reference
\\end{thebibliography}

\\end{document}`;
}

function getProjectTemplate(data) {
  const projectType = data.projectType || 'assignment';
  
  switch (projectType) {
    case 'thesis':
      return `\\documentclass[12pt]{report}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}
\\usepackage{geometry}
\\geometry{margin=2.5cm}

\\title{${data.name || 'Your Thesis Title'}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\tableofcontents
\\listoffigures
\\listoftables

\\begin{abstract}
Your abstract goes here.
\\end{abstract}

\\chapter{Introduction}
Your introduction chapter.

\\chapter{Literature Review}
Review of relevant literature.

\\chapter{Methodology}
Describe your research methodology.

\\chapter{Results}
Present your findings.

\\chapter{Discussion}
Analyze your results.

\\chapter{Conclusion}
Summarize your contributions and suggest future work.

\\begin{thebibliography}{99}
\\bibitem{ref1}
Sample reference
\\end{thebibliography}

\\end{document}`;

    case 'technical':
      return `\\documentclass[11pt,a4paper]{report}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}

\\title{${data.name || 'Your Technical Document Title'}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\tableofcontents

\\chapter{Executive Summary}
Your executive summary.

\\chapter{Introduction}
Your introduction.

\\chapter{Background}
Background information.

\\chapter{Methodology}
Describe your methodology.

\\chapter{Results}
Present your results.

\\chapter{Discussion}
Discuss your findings.

\\chapter{Conclusions and Recommendations}
Your conclusions and recommendations.

\\begin{thebibliography}{99}
\\bibitem{ref1}
Sample reference
\\end{thebibliography}

\\end{document}`;

    default:
      return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}

\\title{${data.name || 'Your Project Title'}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
Your abstract goes here.
\\end{abstract}

\\section{Introduction}
Your introduction section.

\\section{Methodology}
Describe your approach and methods.

\\section{Results}
Present your findings.

\\section{Discussion}
Analyze your results.

\\section{Conclusion}
Summarize your work and findings.

\\begin{thebibliography}{99}
\\bibitem{ref1}
Sample reference
\\end{thebibliography}

\\end{document}`;
  }
}

function getBlogTemplate(data) {
  return `# ${data.name || 'Your Blog Post Title'}

## Introduction

${data.description || 'Your blog post introduction goes here.'}

## Main Content

### Section 1
Your main content section.

### Section 2
Another content section.

### Section 3
Final content section.

## Conclusion

Summarize your key points and provide a call to action.

---

*Published on ${new Date().toLocaleDateString()}*

## References

${data.optionalLinks?.sourceLinks ? data.optionalLinks.sourceLinks.split('\n').map(link => `- ${link}`).join('\n') : 'No references provided'}

## Discussion Points

${data.optionalLinks?.discussionPoints || 'No discussion points provided'}`;
}
