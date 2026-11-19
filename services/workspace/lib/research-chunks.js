const DEFAULT_PARENT_PREVIEW_CHARS = parseInt(process.env.GENLATEX_PARENT_PREVIEW_CHARS || '1200', 10);
const DEFAULT_CHUNK_PREVIEW_CHARS = parseInt(process.env.GENLATEX_CHUNK_PREVIEW_CHARS || '600', 10);

function clampPositiveInt(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildPreview(text, maxChars) {
  if (!text) return '';
  return text.slice(0, maxChars);
}

function extractParentPreview(metadata, extractedContent, maxChars) {
  const previewSources = [
    extractedContent?.full_text,
    extractedContent?.extracted_text,
    metadata?.contentPreview,
    metadata?.content_preview,
    metadata?.preview_text
  ];
  const source = previewSources.find((value) => typeof value === 'string' && value.trim().length > 0);
  return buildPreview(source || '', maxChars);
}

function buildExtractedSummary(extractedContent, chunkCount) {
  if (!extractedContent || typeof extractedContent !== 'object') return null;
  const summary = {
    success: extractedContent?.success === true,
    file_type: extractedContent?.file_type || extractedContent?.fileType || null,
    total_pages: extractedContent?.total_pages ?? extractedContent?.totalPages ?? null,
    total_chars: extractedContent?.total_chars ?? extractedContent?.totalChars ?? null,
    full_text_truncated: extractedContent?.full_text_truncated ?? extractedContent?.fullTextTruncated ?? null,
    chunk_count: chunkCount
  };
  const cleaned = {};
  for (const [key, value] of Object.entries(summary)) {
    if (value !== null && value !== undefined && value !== '') {
      cleaned[key] = value;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

function buildChunkMetadata(chunk, parentInfo, index, previewChars) {
  const chunkContent = chunk?.content || '';
  const chunkPreview = buildPreview(chunkContent, previewChars);
  return {
    isChunk: true,
    isPrimary: false,
    parentFileId: parentInfo.fileId,
    parentFileName: parentInfo.fileName,
    parentFileType: parentInfo.fileType,
    parentFilePath: parentInfo.filePath,
    chunkIndex: index,
    chunkId: chunk?.chunk_id ?? index,
    chunkPreview,
    chunkContent,
    pageStart: chunk?.start_page ?? null,
    pageEnd: chunk?.end_page ?? null,
    charStart: chunk?.char_start ?? null,
    charEnd: chunk?.char_end ?? null,
    sourceType: chunk?.source_type ?? null,
    chunkMeta: chunk?.metadata ?? {}
  };
}

export function splitResearchMetadataForStorage(metadata, parentInfo) {
  const parentPreviewChars = clampPositiveInt(DEFAULT_PARENT_PREVIEW_CHARS, 1200);
  const chunkPreviewChars = clampPositiveInt(DEFAULT_CHUNK_PREVIEW_CHARS, 600);

  const metadataObj = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  const extractedContent = metadataObj.extracted_content || metadataObj.extractedContent || null;
  const chunks = Array.isArray(extractedContent?.chunks) ? extractedContent.chunks : [];

  // Remove extracted content only when chunks exist to keep payloads small.
  if (chunks.length > 0) {
    delete metadataObj.extracted_content;
    delete metadataObj.extractedContent;
  }
  const extractedSummary = buildExtractedSummary(extractedContent, chunks.length);
  if (extractedSummary) {
    metadataObj.extracted_summary = extractedSummary;
  }

  const previewText = extractParentPreview(metadataObj, extractedContent, parentPreviewChars);
  if (previewText) {
    metadataObj.preview_text = previewText;
  }

  metadataObj.isChunk = false;
  metadataObj.isPrimary = true;
  metadataObj.has_chunks = chunks.length > 0;
  metadataObj.chunk_count = chunks.length;

  const chunkRecords = chunks.map((chunk, idx) => {
    const chunkIndex = idx + 1;
    const chunkId = `${parentInfo.fileId}-c${chunk?.chunk_id ?? chunkIndex}`;
    return {
      fileId: chunkId,
      fileName: `${parentInfo.fileName} (chunk ${chunkIndex})`,
      originalName: parentInfo.originalName || parentInfo.fileName,
      filePath: parentInfo.filePath,
      fileType: parentInfo.fileType,
      fileSize: Buffer.byteLength(chunk?.content || '', 'utf8'),
      processingStatus: 'completed',
      processedAt: new Date(),
      metadata: buildChunkMetadata(chunk, parentInfo, chunkIndex, chunkPreviewChars),
      keywords: []
    };
  });

  return { parentMetadata: metadataObj, chunkRecords };
}
