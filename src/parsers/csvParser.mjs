/**
 * CSV Parser Module
 * Provides lightweight CSV parsing with header analysis and delimiter support
 * 
 * Features:
 * - Simple split-based parsing (no heavy regex for performance)
 * - Header analysis for key-value conversion
 * - Delimiter detection and customization
 * - Quoted field handling
 * - Streaming support for large files
 */

import { streamLargeFile, searchFile } from '../core/fileOperations.mjs';

/**
 * Parse CSV file with header analysis
 * @param {string} filePath - Path to the CSV file
 * @returns {Promise<{ headers: string[], rows: any[] }>}}
 */
export async function parseFile(filePath) {
  try {
    // For large files, return streaming parser
    const stats = await getFileSize(filePath);
    
    if (stats && stats > 10 * 1024 * 1024) {
      return { 
        headers: null,
        rows: [],
        warning: 'File is too large. Use parseStream() for streaming parsing.',
        fileSize: stats
      };
    }

    const content = await readFile(filePath);
    
    if (content.error) {
      return { error: `Failed to read file: ${content.error}` };
    }

    return parseCsvContent(content.content, filePath);
  } catch (error) {
    return { 
      error: `CSV parsing failed: ${error.message}`,
      rows: [],
      headers: []
    };
  }
}

/**
 * Parse CSV content string with options
 * @param {string} content - CSV content to parse
 * @param {Object} options - Parsing options
 * @returns {{ headers: string[], rows: any[] }}
 */
export function parseText(content, options = {}) {
  const { 
    delimiter = ',',
    hasHeader = true,
    skipEmptyRows = true,
    trimValues = true,
    quotedFieldsOnly = false
  } = options;

  return {
    headers: null, // Set after first row parsing
    rows: parseCsvLines(content, delimiter, hasHeader, skipEmptyRows, trimValues, quotedFieldsOnly)
  };
}

/**
 * Parse CSV lines into array of objects (with header) or arrays
 */
function parseCsvLines(content, delimiter, hasHeader, skipEmptyRows, trimValues, quotedFieldsOnly) {
  const lines = content.split(/\r?\n/);
  const rows = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip empty lines if configured
    if (!line || /^\s*$/.test(line)) {
      continue;
    }

    const fields = parseCsvLine(line, delimiter, quotedFieldsOnly);
    
    rows.push({ 
      lineNumber: i + 1,
      raw: line,
      data: hasHeader ? convertToKeyValues(fields) : fields 
    });
  }

  // Extract headers from first row if hasHeader is true
  if (hasHeader && rows.length > 0) {
    const headersRow = rows.find(r => r.data instanceof Array);
    
    if (headersRow) {
      const headerNames = headersRow.data.map(h => trimValues ? h.trim() : h);
      
      // Convert remaining rows to key-value objects
      for (const row of rows) {
        if (row.data instanceof Array) continue; // Skip the original headers array
        
        const keyValueRow = {};
        
        headerNames.forEach((header, index) => {
          if (index < row.data.length) {
            const value = trimValues ? row.data[index].trim() : row.data[index];
            // Convert numeric strings to numbers where appropriate
            if (/^\d+$/.test(value)) {
              keyValueRow[header] = parseInt(value, 10);
            } else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
              keyValueRow[header] = value.toLowerCase() === 'true';
            } else {
              keyValueRow[header] = value;
            }
          }
        });
        
        rows[row.lineNumber - 1].data = keyValueRow;
      }
    }
  }

  return rows;
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCsvLine(line, delimiter, quotedFieldsOnly) {
  const fields = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      // Handle quoted field
      if (inQuotes && line[i + 1] === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(currentField);
      currentField = '';
    } else {
      currentField += char;
    }
  }

  // Add last field
  fields.push(currentField);

  return quotedFieldsOnly ? fields : trimEmptyFields(fields);
}

/**
 * Convert array of strings to key-value object using header names as keys
 */
function convertToKeyValues(fields) {
  return fields.map((field, index) => ({ 
    [`field_${index}`]: field 
  }));
}

/**
 * Trim empty fields and clean up data
 */
function trimEmptyFields(fields) {
  return fields.filter(field => {
    if (!field) return false;
    
    const trimmed = field.trim();
    return trimmed !== '';
  });
}

/**
 * Get file size without loading content
 */
async function getFileSize(filePath) {
  try {
    // Try to use the stats function from core module
    const fs = await import('fs');
    const stat = await fs.promises.stat(filePath);
    return stat.size;
  } catch {
    return null;
  }
}

/**
 * Parse CSV stream for large files
 * @param {string} filePath - Path to the CSV file
 * @param {function(row): Promise<void>} onRow - Callback for each row parsed
 * @returns {Promise<{ success: boolean, rowCount?: number }}>}}
 */
export async function parseStream(filePath, onRow) {
  return new Promise(async (resolve, reject) => {
    let rowCount = 0;
    
    try {
      // Detect delimiter from first line
      const firstChunk = await readFirstLine(filePath);
      const detectedDelimiter = detectDelimiter(firstChunk);
      
      let buffer = '';
      
      await streamFile(filePath, async (chunk) => {
        buffer += chunk;
        
        // Split by newlines
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // Keep last incomplete line in buffer
        
        for (const line of lines) {
          if (!line || /^\s*$/.test(line)) continue;
          
          rowCount++;
          const fields = parseCsvLine(line, detectedDelimiter);
          
          await onRow({ 
            lineNumber: rowCount,
            raw: line,
            data: fields,
            delimiter: detectedDelimiter
          });
        }
      });

      resolve({ success: true, rowCount });
      
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Read first line to detect delimiter
 */
async function readFirstLine(filePath) {
  const content = await readFile(filePath);
  
  if (content.error || !content.content) {
    throw new Error('Failed to read file');
  }

  return content.content.split(/\r?\n/)[0];
}

/**
 * Detect CSV delimiter from sample data
 */
function detectDelimiter(sample) {
  // Common delimiters in order of preference
  const delimiters = [',', ';', '\t', '|'];
  
  for (const delimiter of delimiters) {
    if (sample.includes(delimiter)) {
      return delimiter;
    }
  }

  // Default to comma
  return ',';
}

/**
 * Validate CSV structure consistency
 */
export function validateStructure(rows) {
  const result = {
    valid: true,
    expectedFields: null,
    inconsistencies: []
  };

  if (!rows || rows.length === 0) {
    return { 
      ...result,
      valid: false,
      error: 'No data rows found'
    };
  }

  // Get first row as reference
  const firstRow = rows[0];
  
  if (firstRow.data instanceof Array) {
    result.expectedFields = firstRow.data.length;
  } else if (typeof firstRow.data === 'object') {
    result.expectedFields = Object.keys(firstRow.data).length;
  }

  // Check each row for consistency
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    let expectedLength, actualLength;
    
    if (result.expectedFields === null) continue;
    
    if (row.data instanceof Array) {
      expectedLength = result.expectedFields;
      actualLength = row.data.length;
      
      if (expectedLength !== actualLength) {
        result.inconsistencies.push({
          lineNumber: i + 1,
          type: 'field_count',
          expected: expectedLength,
          actual: actualLength
        });
        
        if (result.inconsistencies.length >= 5) break; // Limit warnings
      }
    } else if (typeof row.data === 'object') {
      actualLength = Object.keys(row.data).length;
      
      if (expectedFields !== actualLength) {
        result.valid = false;
        result.inconsistencies.push({
          lineNumber: i + 1,
          type: 'field_count',
          expected: expectedFields,
          actual: actualLength
        });
        
        if (result.inconsistencies.length >= 5) break;
      }
    }
  }

  return result;
}

export default {
  parseFile,
  parseText,
  parseStream,
  validateStructure
};
