/**
 * Unified document type/template/schema configuration.
 * Shared by dashboard (client) and project creation routes (server).
 */

export const DOCUMENT_TYPES = [
  { id: 'article', label: 'Article', description: 'General articles, papers, and long-form documents' },
  { id: 'report', label: 'Report', description: 'Technical, analytical, and operational reports' },
  { id: 'business', label: 'Business Document', description: 'Business reports, briefs, and strategy documents' },
  { id: 'technical', label: 'Technical Document', description: 'Specifications, architecture docs, and manuals' },
  { id: 'slides', label: 'Presentation', description: 'Slide decks and talk material (Beamer)' },
  { id: 'cv', label: 'CV / Resume', description: 'Professional CVs and resumes' },
  { id: 'letter', label: 'Letter', description: 'Formal letters and correspondence' },
  { id: 'invoice', label: 'Invoice', description: 'Billing documents and quotations' },
  { id: 'proposal', label: 'Proposal', description: 'Project and grant proposals' }
];

export const DOCUMENT_TEMPLATES = [
  {
    id: 'academic_paper',
    type: 'article',
    label: 'Academic Paper',
    description: 'Structured formal paper layout',
    schemaId: 'article_general'
  },
  {
    id: 'modern_article',
    type: 'article',
    label: 'Modern Article',
    description: 'Clean article layout for readable long-form content',
    schemaId: 'article_general'
  },
  {
    id: 'technical_report',
    type: 'report',
    label: 'Technical Report',
    description: 'Methods, findings, and recommendations',
    schemaId: 'report_technical'
  },
  {
    id: 'business_report',
    type: 'business',
    label: 'Business Report',
    description: 'Executive-ready reporting and decision support',
    schemaId: 'business_report'
  },
  {
    id: 'technical_document',
    type: 'technical',
    label: 'Technical Document',
    description: 'Specification-style technical writing template',
    schemaId: 'technical_document'
  },
  {
    id: 'presentation_standard',
    type: 'slides',
    label: 'Presentation',
    description: 'Standard slide deck structure for talks and briefs',
    schemaId: 'slides_standard'
  },
  {
    id: 'modern_resume',
    type: 'cv',
    label: 'Modern Resume',
    description: 'Concise, impact-oriented resume format',
    schemaId: 'cv_professional'
  },
  {
    id: 'professional_letter',
    type: 'letter',
    label: 'Professional Letter',
    description: 'Formal letter with polished business tone',
    schemaId: 'letter_professional'
  },
  {
    id: 'invoice_standard',
    type: 'invoice',
    label: 'Invoice',
    description: 'Clear invoice layout with totals and terms',
    schemaId: 'invoice_standard'
  },
  {
    id: 'project_proposal',
    type: 'proposal',
    label: 'Project Proposal',
    description: 'Proposal format with scope, timeline, and budget',
    schemaId: 'proposal_project'
  }
];

export const DOCUMENT_SCHEMAS = {
  article_general: {
    id: 'article_general',
    outputLabel: 'Long-form article or paper',
    focus: 'clear structure, readable narrative, and complete sections',
    requiredSignals: [
      'well-defined purpose and audience',
      'logical flow between sections',
      'clear headings and transitions',
      'clean formatting and readability'
    ],
    structure: ['Title', 'Introduction', 'Main Sections', 'Conclusion']
  },
  report_technical: {
    id: 'report_technical',
    outputLabel: 'Technical report',
    focus: 'evidence-backed findings with actionable recommendations',
    requiredSignals: [
      'problem/context definition',
      'approach or method',
      'findings or analysis',
      'recommendations and next steps'
    ],
    structure: ['Executive Summary', 'Context', 'Method', 'Findings', 'Recommendations', 'Appendix']
  },
  business_report: {
    id: 'business_report',
    outputLabel: 'Business report',
    focus: 'decision support for stakeholders',
    requiredSignals: [
      'business objective',
      'key metrics or evidence',
      'option comparison',
      'recommended action'
    ],
    structure: ['Executive Summary', 'Current State', 'Analysis', 'Options', 'Recommendation', 'Implementation']
  },
  technical_document: {
    id: 'technical_document',
    outputLabel: 'Technical document',
    focus: 'precise specification and implementation clarity',
    requiredSignals: [
      'scope and assumptions',
      'architecture/spec details',
      'interfaces or requirements',
      'constraints and validation notes'
    ],
    structure: ['Overview', 'Scope', 'Architecture/Spec', 'Implementation Notes', 'Validation', 'Appendix']
  },
  slides_standard: {
    id: 'slides_standard',
    outputLabel: 'Presentation deck',
    focus: 'concise slide narrative with clear flow',
    requiredSignals: [
      'audience-fit messaging',
      'story progression',
      'visual clarity',
      'clear call to action or conclusion'
    ],
    structure: ['Title', 'Agenda', 'Core Content', 'Key Takeaways', 'Q&A']
  },
  cv_professional: {
    id: 'cv_professional',
    outputLabel: 'Professional CV/resume',
    focus: 'target-role alignment and measurable impact',
    requiredSignals: [
      'role-aligned summary',
      'quantified achievements',
      'relevant skills',
      'concise structure'
    ],
    structure: ['Header', 'Summary', 'Experience', 'Projects', 'Skills', 'Education']
  },
  letter_professional: {
    id: 'letter_professional',
    outputLabel: 'Professional letter',
    focus: 'clear purpose, tone, and call to action',
    requiredSignals: [
      'recipient and objective',
      'clear supporting points',
      'polished tone',
      'explicit close'
    ],
    structure: ['Header', 'Opening', 'Body', 'Closing']
  },
  invoice_standard: {
    id: 'invoice_standard',
    outputLabel: 'Invoice',
    focus: 'complete billing details and payment clarity',
    requiredSignals: [
      'issuer and recipient info',
      'itemized lines',
      'totals and taxes',
      'payment terms'
    ],
    structure: ['Header', 'Billing Details', 'Line Items', 'Totals', 'Payment Terms']
  },
  proposal_project: {
    id: 'proposal_project',
    outputLabel: 'Project proposal',
    focus: 'scope, delivery plan, and value proposition',
    requiredSignals: [
      'problem/opportunity',
      'proposed approach',
      'timeline and deliverables',
      'budget and assumptions'
    ],
    structure: ['Executive Summary', 'Problem', 'Proposed Approach', 'Timeline', 'Budget', 'Risks', 'Conclusion']
  }
};

export const DEFAULT_DOCUMENT_TYPE = 'article';

const DEFAULT_TEMPLATE_BY_TYPE = {
  article: 'modern_article',
  report: 'technical_report',
  business: 'business_report',
  technical: 'technical_document',
  slides: 'presentation_standard',
  cv: 'modern_resume',
  letter: 'professional_letter',
  invoice: 'invoice_standard',
  proposal: 'project_proposal'
};

const STYLE_THEME_PATTERNS = [
  { pattern: /\bblue\b|\bnavy\b|\bcorporate\b/, label: 'blue/corporate palette' },
  { pattern: /\bred\b/, label: 'red-accent palette' },
  { pattern: /\bgreen\b/, label: 'green-accent palette' },
  { pattern: /\bdark\b/, label: 'dark theme' },
  { pattern: /\blight\b/, label: 'light theme' },
  { pattern: /\bblack and white\b|\bmonochrome\b/, label: 'monochrome palette' }
];

const STYLE_LAYOUT_PATTERNS = [
  { pattern: /\btwo[- ]column\b|\b2[- ]column\b/, label: 'two-column layout' },
  { pattern: /\bsingle[- ]column\b|\b1[- ]column\b/, label: 'single-column layout' },
  { pattern: /\bcompact\b/, label: 'compact spacing' },
  { pattern: /\bairy\b|\bspacious\b/, label: 'airy spacing' }
];

const STYLE_TONE_PATTERNS = [
  { pattern: /\bmodern\b/, label: 'modern style' },
  { pattern: /\bminimal\b|\bminimalist\b/, label: 'minimal style' },
  { pattern: /\bformal\b/, label: 'formal style' },
  { pattern: /\bcreative\b/, label: 'creative style' },
  { pattern: /\bprofessional\b/, label: 'professional style' }
];

function normalizeType(documentType = DEFAULT_DOCUMENT_TYPE) {
  return DOCUMENT_TYPES.some((item) => item.id === documentType)
    ? documentType
    : DEFAULT_DOCUMENT_TYPE;
}

export function getDocumentTypes() {
  return [...DOCUMENT_TYPES];
}

export function getTemplatesForType(documentType = DEFAULT_DOCUMENT_TYPE) {
  const normalizedType = normalizeType(documentType);
  return DOCUMENT_TEMPLATES.filter((item) => item.type === normalizedType);
}

export function getDefaultTemplateForType(documentType = DEFAULT_DOCUMENT_TYPE) {
  const normalizedType = normalizeType(documentType);
  return DEFAULT_TEMPLATE_BY_TYPE[normalizedType] || DEFAULT_TEMPLATE_BY_TYPE[DEFAULT_DOCUMENT_TYPE];
}

export function getResolvedTemplate(documentType = DEFAULT_DOCUMENT_TYPE, templateId = null) {
  const templates = getTemplatesForType(documentType);
  if (!templates.length) {
    return null;
  }
  if (templateId) {
    const matched = templates.find((item) => item.id === templateId);
    if (matched) return matched;
  }
  const fallbackId = getDefaultTemplateForType(documentType);
  return templates.find((item) => item.id === fallbackId) || templates[0];
}

export function resolveDocumentConfig(documentType = DEFAULT_DOCUMENT_TYPE, templateId = null) {
  const normalizedType = normalizeType(documentType);
  const typeConfig = DOCUMENT_TYPES.find((item) => item.id === normalizedType) || DOCUMENT_TYPES[0];
  const template = getResolvedTemplate(normalizedType, templateId);
  const schema = template?.schemaId ? DOCUMENT_SCHEMAS[template.schemaId] || null : null;

  return {
    type: typeConfig,
    template,
    schema
  };
}

export function extractStyleDirectives(styleInput = '') {
  const text = String(styleInput || '').toLowerCase();
  if (!text) return [];

  const directives = [];
  for (const item of STYLE_THEME_PATTERNS) {
    if (item.pattern.test(text)) directives.push(item.label);
  }
  for (const item of STYLE_LAYOUT_PATTERNS) {
    if (item.pattern.test(text)) directives.push(item.label);
  }
  for (const item of STYLE_TONE_PATTERNS) {
    if (item.pattern.test(text)) directives.push(item.label);
  }

  return Array.from(new Set(directives));
}

export function buildDocumentInstructionBlock(documentType = DEFAULT_DOCUMENT_TYPE, templateId = null, styleInput = '') {
  const resolved = resolveDocumentConfig(documentType, templateId);
  const styleDirectives = extractStyleDirectives(styleInput);
  const typeLabel = resolved.type?.label || 'Document';
  const templateLabel = resolved.template?.label || 'Default template';
  const schema = resolved.schema;

  const lines = [
    'DOCUMENT REQUIREMENTS:',
    `- Output type: ${typeLabel}`,
    `- Template profile: ${templateLabel}`,
    '- Generate complete compilable LaTeX content (no placeholders left unresolved).',
    '- Preserve existing confirmed user content unless the user asked to replace it.'
  ];

  if (schema?.outputLabel) {
    lines.push(`- Deliverable: ${schema.outputLabel}`);
  }
  if (schema?.focus) {
    lines.push(`- Core focus: ${schema.focus}`);
  }
  if (Array.isArray(schema?.requiredSignals) && schema.requiredSignals.length > 0) {
    lines.push(`- Must cover: ${schema.requiredSignals.join('; ')}`);
  }
  if (Array.isArray(schema?.structure) && schema.structure.length > 0) {
    lines.push(`- Preferred section flow: ${schema.structure.join(' -> ')}`);
  }
  if (styleDirectives.length > 0) {
    lines.push(`- Style controls from user language: ${styleDirectives.join('; ')}`);
  }

  return lines.join('\n');
}
