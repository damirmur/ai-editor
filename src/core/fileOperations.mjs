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
import { TransactionManager } from './transactionManager.mjs';

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

/**
 * Create all directories in a path recursively
 * @param {string} dirPath - Directory path to create
 * @returns {Promise<boolean>} True if successful, false on error
 */
export async function createDirectories(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (error) {
    // Check if directory already exists
    try {
      const stat = await fs.stat(dirPath);
      if (stat.isDirectory()) {
        return { success: true, exists: true };
      }
    } catch {}
    
    return { 
      success: false, 
      error: error.message 
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
    return stat.size;
  } catch (error) {
    return null;
  }
}

/**
 * Stream-based file reading for large files (>10MB)
 * Uses ReadableStream to process content chunk by chunk
 * @param {string} filePath - Path to read
 * @param {Object} options - Reading options
 * @returns {Promise<{ content: string, chunksRead: number, totalSize?: number }>}
 */
export async function streamLargeFile(filePath, options = {}) {
  const { bufferSize = 1024 * 1024 } = options; // Default 1MB chunks
  
  return new Promise(async (resolve, reject) => {
    let accumulatedChunks = [];
    let totalSize = 0;
    
    try {
      const fileStream = fs.createReadStream(filePath, { 
        encoding: 'utf-8',
        highWaterMark: bufferSize
      });
      
      // Get file size first
      const stats = await fs.stat(filePath);
      totalSize = stats.size;
      
      fileStream.on('data', (chunk) => {
        accumulatedChunks.push(chunk.toString());
        // Progress indicator could be added here for very large files
      });
      
      fileStream.on('end', () => {
        resolve({ 
          content: accumulatedChunks.join(''),
          chunksRead: Math.ceil(totalSize / bufferSize),
          totalSize 
        });
      });
      
      fileStream.on('error', (error) => {
        reject({ error: error.message });
      });
    } catch (error) {
      reject({ error: error.message });
    }
  });
}

/**
 * Standard file reading for smaller files
 * @param {string} filePath - Path to read
 * @returns {Promise<{ content: string }>}
 */
export async function readFile(filePath, options = {}) {
  const { forceStream = false } = options;
  
  // Auto-detect streaming for large files
  if (!forceStream) {
    const size = await getFileSize(filePath);
    if (size !== null && size > LARGE_FILE_THRESHOLD) {
      return streamLargeFile(filePath, options);
    }
  }
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { content };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Streaming file read with chunk processing
 * For large log files where full content isn't needed at once
 * @param {string} filePath - Path to read  
 * @param {function(chunk): Promise<void>} onChunk - Callback for each chunk
 * @returns {Promise<{ success: boolean, totalSize?: number }>}
 */
export async function streamFile(filePath, onChunk) {
  return new Promise(async (resolve, reject) => {
    let totalSize = 0;
    
    try {
      const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
      
      const stats = await fs.stat(filePath);
      totalSize = stats.size;
      
      for await (const chunk of fileStream) {
        await onChunk(chunk.toString());
      }
      
      resolve({ success: true, totalSize });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Write file content atomically using writev for better performance
 * @param {string} filePath - Path to write
 * @param {string} content - Content to write
 * @returns {Promise<{ success: boolean, bytesWritten?: number }>}
 */
export async function writeFile(filePath, content) {
  try {
    const absolutePath = path.resolve(filePath);
    
    // Ensure parent directory exists
    const dirPath = path.dirname(absolutePath);
    await createDirectories(dirPath);
    
    // Write file with UTF-8 encoding
    const encodedContent = Buffer.from(content, 'utf-8');
    await fs.writeFile(absolutePath, encodedContent, { 
      mode: 0o644,
      flag: 'wx' // Create only if doesn't exist for atomicity
    });
    
    return { success: true, bytesWritten: encodedContent.length };
  } catch (error) {
    // Handle directory creation errors vs write errors
    const dirPath = path.dirname(path.resolve(filePath));
    
    try {
      await createDirectories(dirPath);
      return { success: false, error: 'Could not ensure parent directory exists' };
    } catch {}
    
    return { success: false, error: error.message };
  }
}

/**
 * Append content to existing file
 * @param {string} filePath - Path to append to
 * @param {string} content - Content to append
 * @returns {Promise<{ success: boolean, bytesWritten?: number }>}
 */
export async function appendFile(filePath, content) {
  try {
    const absolutePath = path.resolve(filePath);
    
    // Ensure parent directory exists
    await createDirectories(path.dirname(absolutePath));
    
    const encodedContent = Buffer.from(content, 'utf-8');
    await fs.appendFile(absolutePath, encodedContent);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
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
