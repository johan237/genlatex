/**
 * Robust JSON recovery utility
 * Attempts to recover as much data as possible from corrupted JSON
 */

/**
 * Try to repair and parse corrupted JSON, retaining as much data as possible
 * @param {string} content - Raw JSON string (possibly corrupted)
 * @param {object} options - Options
 * @param {string} options.filePath - Path for backup file (optional)
 * @returns {{ data: object|null, recovered: boolean, repairs: string[] }}
 */
export function recoverJSON(content, options = {}) {
  const repairs = [];
  let data = null;
  let recovered = false;

  if (!content || typeof content !== 'string') {
    return { data: null, recovered: false, repairs: ['Empty or invalid input'] };
  }

  // 1. Try normal parse first
  try {
    data = JSON.parse(content);
    if (typeof data === 'object' && data !== null) {
      return { data, recovered: false, repairs: [] };
    }
  } catch (e) {
    // Continue to recovery
  }

  let working = content.trim();

  // 2. Remove BOM if present
  if (working.charCodeAt(0) === 0xFEFF) {
    working = working.slice(1);
    repairs.push('Removed BOM');
  }

  // 3. Remove control characters (except newline, tab)
  const cleanedControl = working.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  if (cleanedControl !== working) {
    working = cleanedControl;
    repairs.push('Removed control characters');
  }

  // 4. Try parse after basic cleanup
  try {
    data = JSON.parse(working);
    if (typeof data === 'object' && data !== null) {
      return { data, recovered: true, repairs };
    }
  } catch (e) {
    // Continue
  }

  // 5. Fix trailing commas before } or ]
  const noTrailingCommas = working.replace(/,(\s*[}\]])/g, '$1');
  if (noTrailingCommas !== working) {
    working = noTrailingCommas;
    repairs.push('Removed trailing commas');
    try {
      data = JSON.parse(working);
      if (typeof data === 'object' && data !== null) {
        return { data, recovered: true, repairs };
      }
    } catch (e) {
      // Continue
    }
  }

  // 6. Try to close truncated JSON (count braces/brackets)
  let openBraces = 0, openBrackets = 0;
  let inString = false, escape = false;
  for (const char of working) {
    if (escape) { escape = false; continue; }
    if (char === '\\') { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') openBraces++;
    if (char === '}') openBraces--;
    if (char === '[') openBrackets++;
    if (char === ']') openBrackets--;
  }

  if (openBraces > 0 || openBrackets > 0) {
    // JSON is truncated - try to close it
    let closing = '';
    // Close any unclosed string (heuristic: if odd number of quotes after last complete value)
    const lastQuoteIndex = working.lastIndexOf('"');
    const afterLastQuote = working.slice(lastQuoteIndex + 1);
    if (lastQuoteIndex > 0 && !afterLastQuote.includes('}') && !afterLastQuote.includes(']')) {
      // Might be in the middle of a string value - close it
      working = working + '"';
      repairs.push('Closed unclosed string');
    }
    
    // Remove trailing incomplete key or value
    working = working.replace(/,\s*"[^"]*$/, ''); // Remove trailing incomplete key
    working = working.replace(/,\s*$/, ''); // Remove trailing comma
    working = working.replace(/:\s*$/, ': null'); // Add null for incomplete value

    for (let i = 0; i < openBrackets; i++) closing += ']';
    for (let i = 0; i < openBraces; i++) closing += '}';
    working = working + closing;
    repairs.push(`Closed ${openBraces} brace(s) and ${openBrackets} bracket(s)`);

    try {
      data = JSON.parse(working);
      if (typeof data === 'object' && data !== null) {
        return { data, recovered: true, repairs };
      }
    } catch (e) {
      // Continue
    }
  }

  // 7. Last resort: extract key-value pairs with regex and build object
  repairs.push('Attempting regex extraction of key-value pairs');
  const extracted = {};

  // Extract string values: "key": "value"
  const stringMatches = content.matchAll(/"([^"]+)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g);
  for (const match of stringMatches) {
    extracted[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // Extract number values: "key": 123
  const numberMatches = content.matchAll(/"([^"]+)"\s*:\s*(-?\d+(?:\.\d+)?)/g);
  for (const match of numberMatches) {
    if (!(match[1] in extracted)) {
      extracted[match[1]] = parseFloat(match[2]);
    }
  }

  // Extract boolean values: "key": true/false
  const boolMatches = content.matchAll(/"([^"]+)"\s*:\s*(true|false)/g);
  for (const match of boolMatches) {
    if (!(match[1] in extracted)) {
      extracted[match[1]] = match[2] === 'true';
    }
  }

  // Extract null values: "key": null
  const nullMatches = content.matchAll(/"([^"]+)"\s*:\s*null/g);
  for (const match of nullMatches) {
    if (!(match[1] in extracted)) {
      extracted[match[1]] = null;
    }
  }

  // Try to extract nested objects - specifically aiGeneration
  const aiGenMatch = content.match(/"aiGeneration"\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/);
  if (aiGenMatch) {
    const aiGenContent = '{' + aiGenMatch[1] + '}';
    try {
      extracted.aiGeneration = JSON.parse(aiGenContent);
      repairs.push('Extracted aiGeneration object');
    } catch (e) {
      // Try to extract documentId or paperId from aiGeneration block
      const documentIdMatch = aiGenMatch[1].match(/"documentId"\s*:\s*"([^"]+)"/);
      const paperIdMatch = aiGenMatch[1].match(/"paperId"\s*:\s*"([^"]+)"/);
      const id = documentIdMatch?.[1] ?? paperIdMatch?.[1];
      if (id) {
        extracted.aiGeneration = { documentId: id, paperId: id };
        repairs.push('Extracted document id from aiGeneration');
      }
    }
  }

  if (Object.keys(extracted).length > 0) {
    return { data: extracted, recovered: true, repairs };
  }

  return { data: null, recovered: false, repairs: [...repairs, 'Could not recover any data'] };
}

/**
 * Parse project metadata with recovery
 * @param {string} content - Raw metadata content
 * @param {string} filePath - File path for logging
 * @returns {object} - Parsed metadata (possibly recovered) or empty object
 */
export function parseProjectMetadata(content, filePath = '') {
  const { data, recovered, repairs } = recoverJSON(content);
  
  if (recovered) {
    console.warn(`🔧 Recovered project metadata${filePath ? ` from ${filePath}` : ''}`);
    console.warn(`   Repairs applied: ${repairs.join(', ')}`);
  }
  
  if (!data) {
    console.error(`❌ Could not recover metadata${filePath ? ` from ${filePath}` : ''}`);
    console.error(`   Attempted repairs: ${repairs.join(', ')}`);
    return {};
  }
  
  return data;
}

export default { recoverJSON, parseProjectMetadata };
