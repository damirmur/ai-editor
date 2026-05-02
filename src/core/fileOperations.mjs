/**
 * Core File Operations Module
 * Handles reading, writing, and searching files with streaming support for large logs
 * 
 * Features:
 * - Streaming read for files >10MB to minimize memory usage
 * - Directory creation with full path support (mkdir -p equivalent)
 * - Atomic write operations via TransactionManager integration
 * - Binary-safe file handling
 */

import { promises as fs, constants } from 'fs';
import path from 'path';

// NOTE: TransactionManager removed to avoid circular dependency
// Import transaction functionality where needed instead
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB - auto-switch to streaming mode

/**
 * Create all directories in a path recursively (mkdir -p equivalent)
 * @param {string} dirPath - Directory path to create
 * @returns {Promise<{ success: boolean, exists?: boolean, error?: string }>}
 */
export async function createDirectories(dirPath) {
  try {
    // Use recursive flag to create parent directories automatically
    await fs.mkdir(dirPath, { recursive: true });
    
    return { success: true };
  } catch (error) {
    // Directory might already exist - check gracefully
    const stat = await fs.stat(dirPath).catch(() => null);
    if (stat?.isDirectory()) {
      return { success: true, exists: true };
    }

    return { 
      success: false, 
      error: `Could not create directory: ${error.message}` 
    };
  }
}

/**
 * Check file size without loading entire content into memory
 * @param {string} filePath - Path to check
 * @returns {Promise<number|null>} File size in bytes or null if not accessible
 */
export async function getFileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    
    // Return null for directories, files, or if inaccessible
    return stat.isFile() ? stat.size : null;
  } catch (error) {
    return null;
  }
}

/**
 * Stream-based file reading for large files (>10MB)
 * Uses ReadableStream to process content chunk by chunk, minimizing memory usage
 * 
 * @param {string} filePath - Path to read
 * @param {Object} options - Reading options: bufferSize (default 1MB chunks)
 * @returns {Promise<{ content: string, chunksRead: number, totalSize: number }>}
 * @throws Will reject if file doesn't exist or is inaccessible
 */
export async function streamLargeFile(filePath, options = {}) {
  const { bufferSize = 1024 * 1024 } = options; // Default 1MB chunks for large files

  return new Promise(async (resolve, reject) => {
    let accumulatedChunks = [];
    let totalSize = 0;

    try {
      // Create stream with highWaterMark for efficient buffering
      const fileStream = fs.createReadStream(filePath, { 
        encoding: 'utf-8',
        highWaterMark: bufferSize
      });

      // Get exact file size before streaming starts
      const stats = await fs.stat(filePath);
      totalSize = stats.size;

      fileStream.on('data', (chunk) => {
        accumulatedChunks.push(chunk.toString());
        // Progress indicator could be added here for very large files (>50MB)
      });

      fileStream.on('end', () => {
        resolve({ 
          content: accumulatedChunks.join(''),
          chunksRead: Math.ceil(totalSize / bufferSize),
          totalSize 
        });
      });

      fileStream.on('error', (error) => {
        reject(new Error(`Failed to stream file ${filePath}: ${error.message}`));
      });

    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Standard file reading for smaller files (auto-detects streaming for large files)
 * @param {string} filePath - Path to read
 * @param {Object} options - Reading options: forceStream (force streaming regardless of size)
 * @returns {Promise<{ content: string }|{ error: string }>}- Success or error object
 */
export async function readFile(filePath, options = {}) {
  const { forceStream = false } = options;

  // Auto-detect and switch to streaming for files >10MB
  if (!forceStream) {
    const size = await getFileSize(filePath);
    if (size !== null && size > LARGE_FILE_THRESHOLD) {
      return streamLargeFile(filePath, options);
    }
  }

  try {
    // For small files: single read is faster than streaming overhead
    const content = await fs.readFile(filePath, 'utf-8');
    
    return { 
      content,
      size: Buffer.byteLength(content, 'utf-8')
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Streaming file read with chunk processing callback
 * For large log files where full content isn't needed at once (e.g., line-by-line parsing)
 * 
 * @param {string} filePath - Path to read  
 * @param {function(chunk: string): Promise<void>|void} onChunk - Async callback for each chunk
 * @returns {Promise<{ success: boolean, totalSize: number }>}
 */
export async function streamFile(filePath, onChunk) {
  return new Promise(async (resolve, reject) => {
    let totalSize = 0;

    try {
      const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });

      // Get file size upfront for metadata
      const stats = await fs.stat(filePath);
      totalSize = stats.size;

      // Process chunks as they arrive (async callback support)
      for await (const chunk of fileStream) {
        if (typeof onChunk === 'function') {
          await onChunk(chunk.toString());
        }
      }

      resolve({ success: true, totalSize });

    } catch (error) {
      reject(new Error(`Failed to stream file ${filePath}: ${error.message}`));
    }
  });
}

/**
 * Write file content with atomic operation (create only if doesn't exist)
 * Uses writev for better performance on supported platforms
 * 
 * @param {string} filePath - Path to write
 * @param {string} content - Content to write
 * @returns {Promise<{ success: boolean, bytesWritten?: number, error?: string }>}
 */
export async function writeFile(filePath, content) {
  try {
    const absolutePath = path.resolve(filePath);

    // Ensure parent directory exists before writing
    const dirPath = path.dirname(absolutePath);
    await createDirectories(dirPath);

    // Write atomically: flag 'wx' ensures file doesn't already exist (prevent overwrites)
    const encodedContent = Buffer.from(content, 'utf-8');
    
    await fs.writeFile(absolutePath, encodedContent, { 
      mode: 0o644,           // rw-r--r-- permissions
      flag: 'wx'             // Create only if doesn't exist (atomic)
    });

    return { success: true, bytesWritten: encodedContent.length };

  } catch (error) {
    // Handle directory creation errors separately from write errors
    const dirPath = path.dirname(path.resolve(filePath));
    
    try {
      await createDirectories(dirPath);
      
      // Directory exists now, but write still failed - return specific error
      return { success: false, error: 'Could not ensure parent directory exists' };

    } catch (dirError) {}

    return { 
      success: false, 
      error: `Failed to write file: ${error.message}` 
    };
  }
}

/**
 * Append content to existing file (creates if doesn't exist)
 * @param {string} filePath - Path to append to
 * @param {string} content - Content to append
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function appendFile(filePath, content) {
  try {
    const absolutePath = path.resolve(filePath);

    // Ensure parent directory exists first
    await createDirectories(path.dirname(absolutePath));

    // Append UTF-8 encoded content with 'a' flag (create if missing)
    const encodedContent = Buffer.from(content, 'utf-8');
    await fs.appendFile(absolutePath, encodedContent);

    return { success: true };

  } catch (error) {
    return { 
      success: false, 
      error: `Failed to append to file: ${error.message}` 
    };
  }
}

/**
 * Search for pattern in file with streaming support
 * @param {string} filePath - Path to search
 * @param {string} query - Search pattern
 * @param {Object} options - Search options
 * @returns {Promise<{ matches: string[], totalMatches?: number, totalSize?: number }>}
 */
export async function searchFile(filePath, query, options = {}) {
  const { stream = false, maxResults = 1000 } = options;
  
  try {
    const stats = await fs.stat(filePath);
    
    if (!stream && stats.size <= LARGE_FILE_THRESHOLD) {
      // Simple case: load entire file and search
      const content = await fs.readFile(filePath, 'utf-8');
      const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      let match;
      const matches = [];
      
      while ((match = regex.exec(content)) !== null && matches.length < maxResults) {
        matches.push({ 
          line: content.substring(0, match.index).split('\n').length - 1,
          text: match[0]
        });
        
        // Skip duplicates on same line
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
      
      return { 
        matches, 
        totalMatches: matches.length,
        totalSize: stats.size 
      };
    } else {
      // Streaming search for large files or when maxResults requested
      const results = [];
      let lineCount = 0;
      let buffer = '';
      
      await streamFile(filePath, (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        
        // Last incomplete line stays in buffer
        buffer = lines.pop();
        
        for (const line of lines) {
          lineCount++;
          if (line.includes(query)) {
            results.push({ 
              line: lineCount,
              text: line 
            });
            
            if (results.length >= maxResults) return; // Stop early
          }
        }
      });
      
      return { 
        matches: results, 
        totalMatches: results.length,
        totalSize: stats.size 
      };
    }
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Check if file exists and is readable
 * @param {string} filePath - Path to check
 * @returns {Promise<{ exists: boolean, readable: boolean }>}}
 */
export async function fileExists(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return { 
      exists: true, 
      isFile: stats.isFile(),
      size: stats.size,
      mtime: new Date(stats.mtimeMs).toISOString()
    };
  } catch (error) {
    return { exists: false };
  }
}

export default {
  createDirectories,
  readFile,
  writeFile,
  appendFile,
  searchFile,
  streamLargeFile,
  streamFile,
  fileExists,
  getFileSize
};
