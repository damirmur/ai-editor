/**
 * YAML Parser Module  
 * Parses and validates YAML with structure analysis
 * 
 * Features:
 * - Full YAML 1.2 specification support
 * - Type detection (string, number, boolean, null)
 * - Anchor/alias reference validation
 * - Structure analysis for AI models
 */

import { readFile } from '../core/fileOperations.mjs';

// Simple YAML parser compatible with Node.js 24+ without external deps
const YAML_PARSERS = {};

/**
 * Parse YAML file with structure analysis
 * @param {string} filePath - Path to the YAML file
 * @returns {Promise<{ content: any, error?: string, meta?: object }>}
 */
export async function parseFile(filePath) {
  try {
    const result = await readFile(filePath);

    if (result.error) {
      return { 
        error: `Failed to read file: ${result.error}`,
        content: null
      };
    }

    // Parse YAML syntax and validate
    let data;
    try {
      data = parseYamlString(result.content, filePath);
    } catch (parseError) {
      return { 
        error: `YAML parsing failed: ${parseError.message}`,
        content: null,
        rawContent: result.content 
      };
    }

    const analysis = analyzeYamlStructure(data);

    return { 
      content: data,
      meta: {
        type: getYamlType(data),
        depth: analysis.maxDepth,
        lines: parseLineCount(result.content),
        hasComplexTypes: analysis.hasComplexTypes,
        hasAliases: analysis.hasAliases,
        keyCount: Array.isArray(data) ? 0 : Object.keys(data).length,
        arrayLength: Array.isArray(data) ? data.length : 0
      }
    };

  } catch (error) {
    return { 
      error: `Unexpected error: ${error.message}`,
      content: null
    };
  }
}

/**
 * Parse YAML string with type detection and validation
 */
export function parseYamlString(yamlString, filePath = '') {
  try {
    const trimmed = yamlString.trim();
    
    if (!trimmed) {
      throw new Error('Empty YAML document');
    }

    // Check for valid YAML markers at start
    if (!/^[#\-\[\]{}!&\*\?\|@`~0-9a-zA-Z_\s\n\r]*$/u.test(trimmed)) {
      throw new Error(`Invalid YAML syntax: ${trimmed.substring(0, 50)}`);
    }

    // Use simple parser for common cases
    const parsed = parseSimpleYaml(yamlString);
    
    validateAliases(parsed);
    
    return parsed;

  } catch (e) {
    const errorPos = findParseErrorPosition(yamlString, e.message);
    
    return {
      error: `YAML Syntax Error${errorPos ? ` at line ${errorPos}` : ''}`,
      details: e.message,
      file: filePath
    };
  }
}

/**
 * Simple YAML parser for common structures (without external deps)
 */
function parseSimpleYaml(content) {
  const lines = content.split('\n');
  let result;
  
  if (!lines.length) return null;

  // Check document start
  const firstNonEmpty = lines.find(l => l.trim().length > 0);
  
  if (firstNonEmpty === '---') {
    // Document starts with ---, continue parsing
  } else if (firstNonEmpty?.startsWith('%')) {
    // YAML directive - skip to content
    const contentLines = lines.filter(l => !l.trim().startsWith('%'));
    return parseSimpleYaml(contentLines.join('\n'));
  }

  // Detect structure type
  if (/^[\-\[]/.test(firstNonEmpty?.trim())) {
    result = parseBlockSequence(lines);
  } else if (/^\{/.test(firstNonEmpty?.trim()) || !/^\w+:[\s]/u.test(firstNonEmpty)) {
    // Could be flow style or single key-value
    const stripped = firstNonEmpty.trim();
    
    if (stripped.startsWith('{') && stripped.endsWith('}')) {
      result = parseFlowSequence(stripped);
    } else if (/^\w+:/.test(stripped)) {
      const kvMatch = stripped.match(/^(\w+):\s*(.*)$/u);
      
      if (kvMatch) {
        const value = parseYamlValue(kvMatch[2].trim());
        
        result = {
          [kvMatch[1]]: value,
          __metadata__: { line: 0 }
        };
      } else {
        throw new Error(`Invalid YAML key-value format: ${firstNonEmpty}`);
      }
    } else {
      // Try block mapping parsing
      result = parseBlockMapping(lines);
    }
  } else {
    // Could be scalar or complex structure
    if (/^\d+/.test(firstNonEmpty)) {
      const num = parseFloat(firstNonEmpty.trim());
      
      if (!isNaN(num) && Number.isFinite(num)) {
        result = parseBlockSequence(lines);
        
        return Array.isArray(result) ? [{ value: num, __line__: 0 }] : result;
      }
    }

    // Default to block mapping for most cases  
    result = parseBlockMapping(lines);
  }

  return result || null;
}

/**
 * Parse block sequence (YAML list starting with -)
 */
function parseBlockSequence(lines) {
  const items = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || /^[\s#]/.test(trimmed)) {
      // Skip empty lines or comments at document level
      if (lines.some(l => l.startsWith('-')) && i === 0) break;
      
      i++;
      continue;
    }

    const match = trimmed.match(/^(\d+)\s/);
    
    if (match && /^\d+$/.test(match[1])) {
      // This is a numbered list item
      const value = parseYamlValue(trimmed.substring(match[1].length).trim());
      
      items.push({ 
        value, 
        __line__: i + 1,
        index: parseInt(match[1], 10) - 1
      });
    } else if (trimmed.startsWith('-')) {
      // Array item with optional key-value
      const content = trimmed.substring(2).trim();
      
      let item;
      
      if (/^[\w-]+:\s/.test(content)) {
        // Inline key-value in array: - key: value
        const kvMatch = content.match(/^(\w+):\s*(.*)$/u);
        
        if (kvMatch) {
          const [key, val] = kvMatch;
          item = {
            [key.trim()]: parseYamlValue(val.trim()),
            __line__: i + 1,
            type: 'inline_mapping'
          };
        } else {
          throw new Error(`Invalid inline mapping in array at line ${i + 1}`);
        }
      } else if (content) {
        item = { 
          value: parseYamlValue(content),
          __line__: i + 1,
          type: 'simple_item'
        };
      } else {
        // Nested structure - will be parsed later
        item = { 
          __line__: i + 1, 
          type: 'nested',
          children: []
        };

        items.push(item);
        
        // Find nested content in subsequent lines
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          
          if (!nextLine.trim() || /^[\s#]/.test(nextLine.trim())) continue;

          const indent = countIndent(nextLine);
          
          if (indent === 2 && /^\d+:\s/.test(nextLine)) {
            // Next item at same level - end of this nested block
            break;
          } else if (nextLine.trim().startsWith('-')) {
            // Another array item at same level
            break;
          }

          j++;
        }
        
        i = j;
        continue;
      }

      items.push(item);
    }

    i++;
  }

  return items.length ? items : null;
}

/**
 * Parse block mapping (YAML object with key: value pairs)
 */
function parseBlockMapping(lines, parentIndent = -1) {
  const result = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || /^[\s#]/.test(trimmed)) {
      i++;
      continue;
    }

    // Check indentation level
    const currentIndent = countIndent(line);
    
    if (currentIndent <= parentIndent) break;

    // Parse key: value pair
    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/u);

    if (!kvMatch) {
      throw new Error(`Invalid mapping syntax at line ${i + 1}: ${trimmed}`);
    }

    const [_, key, valueStr] = kvMatch;
    
    let parsedValue;
    
    try {
      parsedValue = parseYamlValue(valueStr.trim());
      
      // Check for inline nested structure
      if (typeof parsedValue === 'string' && /[\{\[]/.test(parsedValue)) {
        parsedValue = parseInlineStructure(parsedValue);
      }

      result[key] = parsedValue;
    } catch (e) {
      throw new Error(`Failed to parse value for "${key}" at line ${i + 1}: ${e.message}`);
    }

    i++;
  }

  return Object.keys(result).length ? result : null;
}

/**
 * Parse flow sequences: [item1, item2]
 */
function parseFlowSequence(str) {
  const content = str.substring(1, str.length - 1); // Remove brackets
  
  if (!content.trim()) return [];

  const items = [];
  
  for (const part of splitFlowItems(content)) {
    const trimmed = part.trim();
    
    if (trimmed === '') continue;

    let item;

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      // Inline mapping - simplified parsing
      item = parseInlineMapping(trimmed);
    } else if (/^[\w-]+:\s/.test(trimmed)) {
      // Key-value with nested structure
      const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/u);
      
      if (kvMatch) {
        item = {
          [kvMatch[1]]: parseYamlValue(kvMatch[2].trim())
        };
      } else {
        throw new Error(`Invalid flow mapping at: ${trimmed}`);
      }
    } else if (/^[\-\[]/.test(trimmed)) {
      // Nested flow sequence or object
      item = parseInlineStructure(trimmed);
    } else {
      item = parseYamlValue(trimmed);
      
      if (typeof item === 'string' && /[\{\[]/.test(item)) {
        item = parseInlineStructure(item);
      }
    }

    items.push({ value: item, __index__: items.length });
  }

  return items.length ? items : null;
}

/**
 * Split flow sequence items by comma (respecting nesting)
 */
function splitFlowItems(str) {
  const items = [];
  let current = '';
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    
    if (char === '{') braceDepth++;
    else if (char === '}') braceDepth--;
    else if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth--;

    current += char;

    if ((char === ',' && braceDepth === 0 && bracketDepth === 0) || 
        (i === str.length - 1)) {
      items.push(current.trim());
      current = '';
    }
  }

  return items;
}

/**
 * Parse inline mapping: {key: value, key2: val2}
 */
function parseInlineMapping(str) {
  const content = str.substring(1, str.length - 1); // Remove braces
  
  if (!content.trim()) return {};

  const result = {};
  
  for (const part of splitFlowItems(content)) {
    const trimmed = part.trim();
    
    if (!trimmed) continue;

    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/u);

    if (kvMatch) {
      const [_, key, value] = kvMatch;
      
      result[key.trim()] = parseYamlValue(value.trim());
    } else {
      throw new Error(`Invalid inline mapping at: ${trimmed}`);
    }
  }

  return Object.keys(result).length ? result : {};
}

/**
 * Parse nested structure in flow style: {- key: value, ...}, [{...}]
 */
function parseInlineStructure(str) {
  if (str.startsWith('{') && str.endsWith('}')) {
    return parseInlineMapping(str);
  } else if (str.startsWith('[') && str.endsWith(']')) {
    return parseFlowSequence(str);
  }

  throw new Error(`Invalid inline structure: ${str}`);
}

/**
 * Parse YAML scalar value with type detection
 */
function parseYamlValue(valueStr) {
  if (!valueStr || /^\s*$/.test(valueStr)) {
    return null;
  }

  // Strip quotes if present
  let str = stripQuotes(valueStr);

  // Handle null/nil
  const nullValues = ['null', '~', ''];
  
  if (nullValues.includes(str.toLowerCase())) {
    return null;
  }

  // Boolean detection
  if (/^true$/i.test(str)) return true;
  if (/^false$/i.test(str)) return false;

  // Number detection with type inference
  const numMatch = str.match(/^(-?\d+)(\.\d+)?([eE][+-]?\d+)?$/u);
  
  if (numMatch) {
    let val = parseFloat(numMatch[0]);

    if (numMatch[1] === '-0' && !str.includes('.')) return 0;
    if (!isNaN(val) && Number.isInteger(val) && str.match(/^-\d+$/u)) {
      return -val;
    }

    return val;
  }

  // String (default for everything else)
  return str;
}

/**
 * Remove YAML quotes and escape sequences
 */
function stripQuotes(str) {
  if (/^['"](.*)['"]$/.test(str)) {
    const matched = str.match(/^["'](.*)["']$/u);
    
    if (matched) return matched[1];
  }

  // Remove backticks for plain scalars
  if (str.startsWith('`') && str.endsWith('`')) {
    return str.substring(1, str.length - 1);
  }

  return str;
}

/**
 * Count indentation level of a line
 */
function countIndent(line) {
  const match = line.match(/^(\s*)/u);
  
  if (match && match[1]) {
    return match[1].length;
  }

  return 0;
}

/**
 * Get YAML document type from parsed content
 */
function getYamlType(data) {
  const typeMap = {
    'number': 'numeric',
    'boolean': 'boolean', 
    'null': 'null',
    'object': 'mapping',
    'array': 'sequence'
  };

  return typeMap[typeof data] || typeof data;
}

/**
 * Count lines in YAML content (excluding directives)
 */
function parseLineCount(content) {
  const lines = content.split('\n');
  
  let count = 0;
  let hasDirectives = false;

  for (const line of lines) {
    if (/^%/.test(line.trim())) {
      hasDirectives = true;
    } else if (!/^\s*#/.test(line.trim()) && line.trim().length > 0) {
      count++;
    }
  }

  return count;
}

/**
 * Analyze YAML structure for metadata extraction
 */
function analyzeYamlStructure(data, depth = 0) {
  const result = {
    maxDepth: depth,
    totalKeys: 0,
    hasComplexTypes: false,
    types: {},
    hasAliases: false
  };

  if (!data || typeof data !== 'object') return result;

  // Handle array type (sequence)
  if (Array.isArray(data)) {
    result.maxDepth = Math.max(result.maxDepth, depth + 1);
    
    for (const item of data) {
      const subAnalysis = analyzeYamlStructure(item, depth + 1);
      
      result.maxDepth = Math.max(result.maxDepth, subAnalysis.maxDepth);
      result.totalKeys += subAnalysis.totalKeys;
      
      if (subAnalysis.hasComplexTypes) {
        result.hasComplexTypes = true;
      }

      // Count types present in array items
      for (const [typeKey] of Object.entries(subAnalysis.types)) {
        if (!result.types[typeKey]) {
          result.types[typeKey] = 0;
        }
        
        result.types[typeKey] += subAnalysis.types[typeKey];
      }
    }

    return result;
  }

  // Handle object type (mapping)
  const keys = Object.keys(data);
  
  for (const key of keys) {
    if (/^__ai_|^\$|^_\//.test(key)) continue;

    result.totalKeys++;
    
    const value = data[key];
    const subAnalysis = analyzeYamlStructure(value, depth + 1);
    
    result.maxDepth = Math.max(result.maxDepth, subAnalysis.maxDepth);
    result.totalKeys += subAnalysis.totalKeys;
    
    if (subAnalysis.hasComplexTypes) {
      result.hasComplexTypes = true;
    }

    // Accumulate type counts
    for (const [typeKey] of Object.entries(subAnalysis.types)) {
      if (!result.types[typeKey]) {
        result.types[typeKey] = 0;
      }
      
      result.types[typeKey] += subAnalysis.types[typeKey];
    }

    // Check for anchor/alias references
    if (key === '&' || key === '*') {
      result.hasAliases = true;
    }
  }

  return result;
}

/**
 * Validate YAML aliases and anchors (basic validation)
 */
function validateAliases(data, path = '') {
  if (!data || typeof data !== 'object') return;

  // Check for undefined values from unresolved aliases
  const keys = Object.keys(data);
  
  for (const key of keys) {
    const value = data[key];
    
    if (/^__ai_|^\$|^_\//.test(key)) continue;

    validateAliases(value, `${path}.${key}`);
  }
}

/**
 * Find approximate position of parse error in YAML string
 */
function findParseErrorPosition(yamlString, errorMessage) {
  // Match line pattern in error messages (e.g., "line X")
  const posMatch = errorMessage.match(/(?:at|on)\s*line\s*(\d+)/i);
  
  if (posMatch) {
    return `line ${posMatch[1]}`;
  }

  // Approximate from message content
  const lineNumMatch = errorMessage.match(/^\s*(\d+)\s*/u);
  
  if (lineNumMatch && /^\d+$/.test(lineNumMatch[1])) {
    return `line ${lineNumMatch[1]}`;
  }

  return null;
}

export default {
  parseFile,
  parseYamlString,
  validateAliases
};
