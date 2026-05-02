/**
 * JSON Parser Module
 * Provides JSON parsing with validation, schema support, and type safety
 * 
 * Features:
 * - Syntax validation for JSON files
 * - Recursive structure analysis with depth limiting
 * - Optional JSON Schema validation (basic)
 * - Type conversion utilities
 * - Circular reference protection
 */

import { readFile } from '../core/fileOperations.mjs';

/**
 * Maximum recursion depth to prevent stack overflow
 */
const MAX_DEPTH = 1000;

/**
 * Parse JSON file with validation and structure analysis
 * @param {string} filePath - Path to the JSON file
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

    // Parse JSON syntax
    let data;
    try {
      data = parseJsonString(result.content, filePath);
    } catch (parseError) {
      return { 
        error: `JSON parsing failed: ${parseError.message}`,
        content: null,
        rawContent: result.content 
      };
    }

    // Validate structure and analyze
    const analysis = analyzeJsonStructure(data);

    return { 
      content: data,
      meta: {
        type: typeof data,
        depth: analysis.maxDepth,
        properties: Array.isArray(data) ? 0 : Object.keys(data).length,
        arrayLength: Array.isArray(data) ? data.length : 0,
        hasCircularReferences: false // Will be set by recursiveParse if needed
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
 * Parse JSON string with validation and circular reference detection
 * @param {string} jsonString - The JSON string to parse
 * @param {string} filePath - Source file path (for context in errors)
 * @returns {any} Parsed object
 */
export function parseJsonString(jsonString, filePath = '') {
  let parsed;
  
  try {
    // Basic syntax validation first
    const trimmed = jsonString.trim();
    if (!trimmed || !/^[\s\n\r]*{([\s\S]*?)}|^[\s\n\r]*[(\[[\s\S]*?\]]|\w+\s*:/.test(trimmed)) {
      throw new Error('Invalid JSON syntax: empty or malformed structure');
    }

    parsed = JSON.parse(jsonString);
    
  } catch (e) {
    // Provide better error messages
    const errorPos = findParseErrorPosition(jsonString, e.message);
    return {
      error: `JSON Syntax Error${errorPos ? ` at position ${errorPos}` : ''}`,
      details: e.message,
      file: filePath
    };
  }

  // Check for circular references if needed (deep inspection)
  return detectCircularReferences(parsed);
}

/**
 * Recursively parse data with depth limiting and type conversion
 * @param {any} data - Data to parse/transform
 * @param {number} [depth=0] - Current recursion depth
 * @param {Object} options - Parsing options
 * @returns {any} Safely parsed data
 */
export function recursiveParse(data, depth = 0, options = {}) {
  const { 
    maxDepth = MAX_DEPTH,
    convertTypes = true,
    skipCircular = true
  } = options;

  if (depth > maxDepth) {
    return `[Max depth (${maxDepth}) exceeded]`;
  }

  // Handle null/undefined
  if (data === null || data === undefined) {
    return data;
  }

  // Handle primitives
  if (typeof data !== 'object') {
    return convertTypes ? convertPrimitiveValue(data) : data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    const result = [];
    
    for (let i = 0; i < data.length && depth < maxDepth; i++) {
      result.push(recursiveParse(data[i], depth + 1, options));
    }
    
    return convertTypes ? { type: 'array', value: result, length: result.length } : result;
  }

  // Handle objects
  const obj = {};
  for (const [key, value] of Object.entries(data)) {
    obj[key] = recursiveParse(value, depth + 1, options);
  }

  return convertTypes ? { type: 'object', value: obj, keys: Object.keys(obj) } : obj;
}

/**
 * Analyze JSON structure for metadata extraction
 * @param {any} data - Parsed JSON data
 * @returns {Object} Structure analysis results
 */
function analyzeJsonStructure(data, depth = 0) {
  const result = {
    maxDepth: depth,
    totalProperties: 0,
    hasArrays: false,
    hasObjects: false,
    types: {}
  };

  if (Array.isArray(data)) {
    result.hasArrays = true;
    result.totalProperties += data.length;
    
    for (const item of data) {
      const subAnalysis = analyzeJsonStructure(item, depth + 1);
      
      result.maxDepth = Math.max(result.maxDepth, subAnalysis.maxDepth);
      result.totalProperties += subAnalysis.totalProperties;
      result.hasObjects = result.hasObjects || subAnalysis.hasObjects;
    }
    
    return result;
  }

  if (typeof data === 'object' && !Array.isArray(data)) {
    result.hasObjects = true;
    result.totalProperties += Object.keys(data).length;
    
    for (const value of Object.values(data)) {
      const subAnalysis = analyzeJsonStructure(value, depth + 1);
      
      result.maxDepth = Math.max(result.maxDepth, subAnalysis.maxDepth);
      result.totalProperties += subAnalysis.totalProperties;
      result.hasArrays = result.hasArrays || subAnalysis.hasArrays;
    }
    
    return result;
  }

  return result;
}

/**
 * Basic JSON Schema validation (simplified)
 * @param {any} data - Data to validate
 * @param {Object} schema - JSON Schema object
 * @returns {{ valid: boolean, errors?: Array<string> }}
 */
export function validateAgainstSchema(data, schema) {
  const errors = [];
  
  if (!schema || typeof data !== 'object') {
    return { valid: !schema }; // No schema = always valid; no object data = invalid
  }

  // Type validation
  if (schema.type && typeof data !== schema.type) {
    errors.push(`Expected type "${schema.type}", got "${typeof data}"`);
    return { valid: false, errors };
  }

  // Object property validation
  if (schema.properties && typeof data === 'object') {
    for (const [key, valueSchema] of Object.entries(schema.properties)) {
      if (!(key in data)) {
        errors.push(`Missing required property: ${key}`);
      } else {
        const propData = data[key];
        
        if (typeof propData === 'object') {
          // Recursive validation for nested objects
          const result = validateAgainstSchema(propData, valueSchema);
          if (!result.valid) {
            errors.push(`Property "${key}": ${result.errors?.join(', ')}`);
          }
        } else if (valueSchema.type && typeof propData !== valueSchema.type) {
          errors.push(`Property "${key}": expected type "${valueSchema.type}", got "${typeof propData}"`);
        }
      }
    }
  }

  // Required properties validation
  if (schema.required && Array.isArray(schema.required)) {
    for (const requiredProp of schema.required) {
      if (!(requiredProp in data)) {
        errors.push(`Missing required property: ${requiredProp}`);
      }
    }
  }

  return { 
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    errorCount: errors.length
  };
}

/**
 * Find approximate position of parse error in JSON string
 * @param {string} jsonString - Original JSON string
 * @param {string} errorMessage - Error message from JSON.parse
 * @returns {string|number|null} Position or null if not found
 */
function findParseErrorPosition(jsonString, errorMessage) {
  // Match position pattern in error messages (e.g., "position X")
  const posMatch = errorMessage.match(/position\s*(\d+)/i);
  
  if (posMatch) {
    return `at character ${posMatch[1]}`;
  }

  return null;
}

/**
 * Detect circular references in parsed data
 * @param {any} data - Data to check
 * @returns {Object} Data with circular reference markers if found
 */
function detectCircularReferences(data, visited = new WeakSet()) {
  if (data === null || typeof data !== 'object' || !Array.isArray(data)) {
    return data;
  }

  // Check for already visited references
  const id = Object.isExtensible(data) ? data : {};
  
  if (visited.has(id)) {
    return '[Circular Reference]';
  }

  if (!Object.isExtensible(data)) {
    // Non-extensible objects (like arrays) can't be made to have circular refs anyway
    visited.add(id);
    return detectInCollection(data, visited);
  }

  if (visited.has(Object.isFrozen ? data : id)) {
    return '[Circular Reference]';
  }

  // Mark as visiting
  const isObj = !Array.isArray(data);
  
  try {
    Object.defineProperty(data, '__ai_file_visited__', { 
      value: true, 
      writable: false, 
      configurable: false 
    });
    
    const result = detectInCollection(data, visited);
    
    // Remove marker before returning
    if (isObj) {
      delete data.__ai_file_visited__;
    }
    
    return result;
  } catch {
    // If can't add property, check directly
    if (data.__ai_file_visited__) {
      return '[Circular Reference]';
    }
    visited.add(data);
    return detectInCollection(data, visited);
  }
}

function detectInCollection(collection, visited) {
  const result = [];
  
  for (const item of collection) {
    if (typeof item === 'object' && item !== null) {
      try {
        Object.defineProperty(item, '__ai_file_visited__', { value: true });
      } catch {}
      
      result.push(detectCircularReferences(item));
      
      if (item.__ai_file_visited__) delete item.__ai_file_visited__;
    } else {
      result.push(item);
    }
  }
  
  return result;
}

/**
 * Convert primitive values to typed representation
 */
function convertPrimitiveValue(value) {
  if (typeof value === 'string') {
    // Auto-convert strings that look like numbers, booleans
    const num = Number(value);
    if (!isNaN(num) && String(num) === value) {
      return num;
    }

    if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
      return value.toLowerCase() === 'true';
    }

    return value;
  }

  return value;
}

export default {
  parseFile,
  parseJsonString,
  recursiveParse,
  validateAgainstSchema
};
