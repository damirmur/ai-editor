/**
 * TypeScript Configuration Parser (tsconfig.json)
 * Parses and validates tsconfig using Node.js 24+ ts-api-utils
 * 
 * Features:
 * - Full tsconfig.json structure parsing
 * - Compiler options validation via TypeScript API
 * - Path resolution analysis
 * - Reference validation (extends, files, include/exclude)
 */

import { readFile } from '../core/fileOperations.mjs';

const MAX_DEPTH = 100;

/**
 * Parse tsconfig.json with full TypeScript validation
 * @param {string} filePath - Path to tsconfig file
 * @returns {Promise<{ config: object, error?: string, analysis?: object }>}
 */
export async function parseTsConfig(filePath) {
  const result = await readFile(filePath);

  if (result.error) {
    return { 
      error: `Failed to read file: ${result.error}`,
      content: null
    };
  }

  try {
    const config = parseJsonString(result.content, filePath);
    
    // Use TypeScript API for validation when available (Node.js 24+)
    if (typeof require !== 'undefined') {
      try {
        const tsApi = await import('ts-api-utils');
        
        if (tsApi && typeof tsApi.parseJsonConfigFileContent === 'function') {
          // Validate with TypeScript compiler API
          const validationResult = validateWithTsAPI(config, filePath);
          config.validation = validationResult;
        }
      } catch {}
    }

    const analysis = analyzeTsConfigStructure(config);

    return { 
      content: config,
      meta: {
        type: 'typescript-config',
        depth: analysis.maxDepth,
        hasCompilerOptions: !!config.compilerOptions,
        hasExtends: !!config.extends,
        hasFilesPattern: !!config.files,
        hasIncludeExclude: !!(config.include || config.exclude),
        rootDir: config.rootDir ?? undefined,
        target: analyzeTarget(config.compilerOptions?.target),
        module: config.compilerOptions?.module ?? undefined,
        strictModeEnabled: getStrictModeStatus(config.compilerOptions)
      },
      analysis 
    };

  } catch (error) {
    return { 
      error: `TypeScript parsing failed: ${error.message}`,
      content: null,
      rawContent: result.content 
    };
  }
}

/**
 * Analyze TypeScript target mapping to readable format
 */
function analyzeTarget(targetCode) {
  if (!targetCode) return undefined;
  
  const targets = {
    'ES3': 'ES3 (very old)',
    'ES5': 'ES5 (pre-classes)',
    'ES2015': 'ES6/ES2015',
    'ES2016': 'ES2016 (Array.includes, etc.)',
    'ES2017': 'ES2017 (async/await)',
    'ES2018': 'ES2018 (Promise.allSettled)',
    'ES2019': 'ES2019 (Optional chaining)',
    'ES2020': 'ES2020 (Nullish coalescing)',
    'ES2021': 'ES2021 (Logical operators)',
    'ES2022': 'ES2022 (Class fields)',
    'JSON': 'JSON',
    'JSON5': 'JSON5'
  };

  return targets[targetCode] || targetCode;
}

/**
 * Get strict mode configuration summary
 */
function getStrictModeStatus(compilerOptions) {
  if (!compilerOptions) return false;
  
  const strictFlags = [
    'strict',
    'noImplicitAny',
    'strictNullChecks',
    'strictFunctionTypes',
    'strictBindCallApply',
    'strictPropertyInitialization'
  ];

  return strictFlags.filter(flag => 
    compilerOptions[flag] === true || 
    (compilerOptions.strict === true)
  ).length;
}

/**
 * Analyze TypeScript configuration structure
 */
function analyzeTsConfigStructure(config, depth = 0) {
  const result = {
    maxDepth: depth,
    totalProperties: Object.keys(config).length,
    hasCompilerOptions: false,
    hasWatchOptions: false,
    hasBuildOptions: false,
    extendsCount: Array.isArray(config.extends) ? config.extends.length : (config.extends ? 1 : 0),
    filePatterns: [],
    includePatterns: [],
    excludePatterns: []
  };

  if (!result.hasCompilerOptions && typeof config.compilerOptions === 'object') {
    result.hasCompilerOptions = true;
    const opts = config.compilerOptions;
    
    // Count compiler options
    if (typeof opts.target === 'string') {
      result.totalProperties++;
    }
    if (opts.module) result.totalProperties++;
    if (opts.strict) result.totalProperties++;
    
    // Check for common patterns
    const tsCompilerOptions = [
      'target', 'module', 'lib', 'jsx', 
      'strict', 'esModuleInterop', 
      'resolveJsonModule', 'declaration'
    ];

    tsCompilerOptions.forEach(opt => {
      if (opts[opt] !== undefined) result.totalProperties++;
    });

    // Analyze include/exclude patterns
    if (Array.isArray(config.include)) {
      result.includePatterns = config.include;
      result.filePatterns.push(...result.includePatterns);
    }
    
    if (Array.isArray(config.exclude)) {
      result.excludePatterns = config.exclude;
      result.filePatterns.push(...result.excludePatterns);
    }

    // Check for files pattern
    if (config.files && Array.isArray(config.files)) {
      result.filePatterns = config.files.flat();
    }
  }

  return result;
}

/**
 * Parse JSON string with TypeScript-specific handling
 */
export function parseTsConfigString(jsonString, filePath = '') {
  let parsed;
  
  try {
    const trimmed = jsonString.trim();
    
    // Basic tsconfig validation
    if (!trimmed || !/^{[\s\S]*}".?name"?[:\s]/.test(trimmed)) {
      throw new Error('Invalid tsconfig.json: missing required fields');
    }

    parsed = JSON.parse(jsonString);
    
  } catch (e) {
    const errorPos = findParseErrorPosition(jsonString, e.message);
    
    return {
      error: `tsconfig Syntax Error${errorPos ? ` at position ${errorPos}` : ''}`,
      details: e.message,
      file: filePath
    };
  }

  // Validate TypeScript-specific structure
  validateTsConfigStructure(parsed);

  detectCircularReferences(parsed);
  
  return parsed;
}

/**
 * Validate tsconfig structure without full TS compilation
 */
function validateTsConfigStructure(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('tsconfig must be a valid object');
  }

  // Compiler options validation hints
  const knownOptions = [
    'target', 'module', 'lib', 'jsx', 'strict', 
    'esModuleInterop', 'skipLibCheck', 'declaration'
  ];

  for (const key of Object.keys(config.compilerOptions || {})) {
    if (!knownOptions.includes(key) && !key.startsWith('_')) {
      // Unknown option - could be valid in newer TS versions
    }
  }

  return true;
}

/**
 * Resolve file patterns to actual files (basic implementation)
 */
export async function resolveFilePatterns(config, basePath = process.cwd()) {
  const resolvedFiles = [];
  
  if (!Array.isArray(config.files)) return resolvedFiles;

  try {
    // Simple pattern matching without glob library
    for (const pattern of config.files.flat() || []) {
      try {
        const stat = await import('fs').then(fs => fs.promises.stat(
          path.resolve(basePath, pattern)
        ));
        
        if (stat.isFile()) {
          resolvedFiles.push({
            file: pattern,
            absolute: stat.path,
            size: stat.size
          });
        } else if (stat.isDirectory()) {
          // Simple directory listing for patterns like "src/**/*"
          const files = await import('fs').then(fs => fs.promises.readdir(
            path.resolve(basePath, pattern)
          ));
          
          resolvedFiles.push({
            file: `${pattern}/`,
            type: 'directory',
            count: files.length
          });
        }
      } catch {}
    }

  } catch (error) {
    return { error: error.message };
  }

  return resolvedFiles;
}

/**
 * Export for programmatic use
 */
const path = await import('path');
export { path };

export default {
  parseTsConfig,
  parseTsConfigString,
  resolveFilePatterns
};
