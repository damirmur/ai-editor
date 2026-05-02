/**
 * Commands Module - CLI Command Definitions and Implementations
 * 
 * Available commands:
 * - read <path> [options]    - Read file content
 * - edit <path> <content>    - Edit/write file (with transaction support)
 * - search <path> <query>    - Search for pattern in file
 * - validate <path>          - Validate and parse file format
 * - mkdir <path>             - Create directories
 */

import { 
  readFile, 
  writeFile, 
  createDirectories, 
  searchFile,
  streamLargeFile,
  fileExists 
} from '../core/fileOperations.mjs';
import TransactionManager from '../core/transactionManager.mjs';
import JsonParser from '../parsers/jsonParser.mjs';
import CsvParser from '../parsers/csvParser.mjs';

/**
 * Auto-detect and parse file by format
 */
async function autoParseFile(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  
  switch (ext) {
    case 'json':
      return await JsonParser.parseFile(filePath);
    
    case 'csv':
      return await CsvParser.parseFile(filePath);
    
    default:
      // Try to auto-detect based on content for common formats
      const contentResult = await readFile(filePath);
      
      if (contentResult.error) {
        return { error: `Failed to read file: ${contentResult.error}` };
      }

      const lines = contentResult.content.split('\n');
      
      // Check for JSON structure
      const firstLine = lines[0].trim();
      if (/^[\{\[]/.test(firstLine)) {
        return await JsonParser.parseFile(filePath);
      }
      
      // Assume text/binary - return raw content
      return { 
        content: contentResult.content,
        format: 'text',
        type: typeof lines[0] === 'string' ? 'text/plain' : null
      };
  }
}

/**
 * Execute read command
 * @param {Object} args - Command arguments
 */
export function cmdRead(args) {
  const filePath = args.path || '';
  const options = { streamLargeFiles: true, ...args };
  
  return async () => {
    try {
      if (!filePath) {
        return JSON.stringify({ error: 'Missing path argument' });
      }

      // Check if file exists
      const existsResult = await fileExists(filePath);
      
      if (!existsResult.exists) {
        return JSON.stringify({ 
          error: `File not found: ${filePath}`,
          suggestedAction: 'Use "mkdir" to create directory first' 
        });
      }

      // Read file based on size and options
      const result = await readFile(filePath, options);
      
      if (result.error) {
        return JSON.stringify({ error: `Read failed: ${result.error}` });
      }

      // Auto-parse based on format
      const parsedResult = await autoParseFile(filePath);
      
      return JSON.stringify(parsedResult);
    } catch (error) {
      return JSON.stringify({ 
        error: `Unexpected error: ${error.message}`,
        stack: error.stack
      });
    }
  };
}

/**
 * Execute edit command with transaction support
 * @param {Object} args - Command arguments  
 */
export function cmdEdit(args) {
  const filePath = args.path || '';
  const newContent = args.content || '';
  
  return async () => {
    if (!filePath || !newContent) {
      return JSON.stringify({ 
        error: 'Usage: edit <path> <content>',
        fields: { path: 'required', content: 'required' }
      });
    }

    try {
      // Execute with transaction for automatic rollback on failure
      const result = await TransactionManager.executeWithTransaction(filePath, () => Promise.resolve(newContent));
      
      return JSON.stringify(result);
      
    } catch (error) {
      return JSON.stringify({ 
        error: `Edit failed: ${error.message}`,
        suggestedAction: 'Check file permissions and path validity'
      });
    }
  };
}

/**
 * Execute search command with streaming support
 * @param {Object} args - Command arguments
 */
export function cmdSearch(args) {
  const filePath = args.path || '';
  const query = args.query || '';
  const options = { maxResults: 100, ...args };
  
  return async () => {
    if (!filePath || !query) {
      return JSON.stringify({ 
        error: 'Usage: search <path> <query>',
        fields: { path: 'required', query: 'required' }
      });
    }

    try {
      const result = await searchFile(filePath, query, options);
      
      if (result.error) {
        return JSON.stringify({ error: `Search failed: ${result.error}` });
      }

      // Return structured results with context
      return JSON.stringify({
        filePath,
        query,
        ...result
      });
    } catch (error) {
      return JSON.stringify({ 
        error: `Search error: ${error.message}`,
        suggestedAction: 'Check if file exists and is readable'
      });
    }
  };
}

/**
 * Execute validate command - auto-detect format and validate
 * @param {Object} args - Command arguments
 */
export function cmdValidate(args) {
  const filePath = args.path || '';
  
  return async () => {
    if (!filePath) {
      return JSON.stringify({ 
        error: 'Usage: validate <path>',
        fields: { path: 'required' }
      });
    }

    try {
      // Check file existence first
      const existsResult = await fileExists(filePath);
      
      if (!existsResult.exists) {
        return JSON.stringify({ 
          error: `File not found: ${filePath}`,
          exists: false
        });
      }

      // Try to parse based on extension
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      let validationResult;
      
      switch (ext) {
        case 'json':
          validationResult = await JsonParser.parseFile(filePath);
          if (!validationResult.error) {
            // Additional JSON validation
            const schemaResult = JsonParser.validateAgainstSchema(validationResult.content, null);
            
            return JSON.stringify({
              valid: true,
              format: 'json',
              ...schemaResult,
              meta: validationResult.meta
            });
          }
          break;

        case 'csv':
          const csvResult = await CsvParser.parseFile(filePath);
          
          if (csvResult.error) {
            return JSON.stringify({ 
              valid: false,
              format: 'csv',
              error: csvResult.error 
            });
          }

          // Check CSV structure consistency
          const structValidation = CsvParser.validateStructure(csvResult.rows);
          
          return JSON.stringify({
            valid: true,
            format: 'csv',
            ...structValidation,
            rowCount: csvResult.rows.length,
            headerCount: csvResult.headers?.length || 0
          });

        default:
          const content = await readFile(filePath);
          
          if (content.error) {
            return JSON.stringify({ 
              valid: false,
              format: 'unknown',
              error: content.error 
            });
          }

          // Basic text validation - just check it's readable
          return JSON.stringify({
            valid: true,
            format: 'text/plain',
            contentType: 'text/plain; charset=utf-8',
            encoding: 'utf-8'
          });
      }

      if (validationResult?.error) {
        return JSON.stringify({ 
          valid: false,
          format: ext === 'json' ? 'json' : 'unknown',
          error: validationResult.error
        });
      }

      // Default success for unknown formats
      return JSON.stringify({
        valid: true,
        format: 'text/plain',
        message: `File is readable (${filePath})`
      });
      
    } catch (error) {
      return JSON.stringify({ 
        error: `Validation failed: ${error.message}`,
        valid: false
      });
    }
  };
}

/**
 * Execute mkdir command - create directories recursively
 */
export function cmdMkdir(args) {
  const dirPath = args.path || '';
  
  return async () => {
    if (!dirPath) {
      return JSON.stringify({ 
        error: 'Usage: mkdir <path>',
        fields: { path: 'required' }
      });
    }

    try {
      const result = await createDirectories(dirPath);
      
      return JSON.stringify(result);
      
    } catch (error) {
      return JSON.stringify({ 
        error: `Directory creation failed: ${error.message}`,
        suggestedAction: 'Check directory path and permissions'
      });
    }
  };
}

/**
 * Execute diff command - compare two files
 */
export function cmdDiff(args) {
  const file1 = args.path1 || '';
  const file2 = args.path2 || '';
  
  return async () => {
    if (!file1 || !file2) {
      return JSON.stringify({ 
        error: 'Usage: diff <path1> <path2>',
        fields: { path1: 'required', path2: 'required' }
      });
    }

    try {
      // Read both files
      const [read1, read2] = await Promise.all([
        readFile(file1),
        readFile(file2)
      ]);

      if (read1.error || read2.error) {
        return JSON.stringify({ 
          error: 'Failed to read one or both files',
          file1Error: read1?.error,
          file2Error: read2?.error
        });
      }

      // Simple diff for text comparison
      const lines1 = read1.content.split('\n');
      const lines2 = read2.content.split('\n');
      
      let identicalLines = 0;
      let totalLines = Math.max(lines1.length, lines2.length);
      
      for (let i = 0; i < totalLines && i < lines1.length && i < lines2.length; i++) {
        if (lines1[i] === lines2[i]) {
          identicalLines++;
        } else {
          break; // Only count from start
        }
      }

      return JSON.stringify({
        file1: file1,
        file2: file2,
        totalLines: totalLines,
        identicalPrefixLines: identicalLines,
        isIdentical: lines1.length === lines2.length && 
                      JSON.stringify(lines1) === JSON.stringify(lines2),
        lineCountDiff: lines1.length - lines2.length
      });

    } catch (error) {
      return JSON.stringify({ 
        error: `Diff failed: ${error.message}`,
        suggestedAction: 'Check if both files exist'
      });
    }
  };
}

/**
 * Execute help command
 */
export function cmdHelp(args) {
  const commands = [
    { name: 'read', desc: 'Read file content (supports streaming for large files)' },
    { name: 'edit', desc: 'Write/edit file with transaction support' },
    { name: 'search', desc: 'Search for pattern in file (streaming support)' },
    { name: 'validate', desc: 'Validate and parse file by detected format' },
    { name: 'mkdir', desc: 'Create directories recursively' },
    { name: 'diff', desc: 'Compare two files line-by-line' }
  ];

  return JSON.stringify({
    description: 'AI-File Editor - File operations for AI models',
    version: '1.0.0',
    commands: commands,
    usage: 'ai-file <command> [options]',
    examples: [
      'read package.json',
      'edit config.json --set key=value',
      "search log.txt \"error\"",
      "validate src/data.csv",
      'mkdir /path/to/new/dir'
    ]
  });
}

export default {
  cmdRead,
  cmdEdit,
  cmdSearch,
  cmdValidate,
  cmdMkdir,
  cmdDiff,
  cmdHelp
};
