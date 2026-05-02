#!/usr/bin/env node

/**
 * AI-File Editor - Main CLI Entry Point
 * 
 * Usage: node index.mjs <command> [options]
 * 
 * Available commands:
 *   read    - Read file content
 *   edit    - Edit/write file
 *   search  - Search for pattern in file
 *   validate - Validate and parse file format
 *   mkdir   - Create directories
 *   diff    - Compare two files
 *   help    - Show this help message
 */

import { createInterface } from 'readline';
import commands, { cmdHelp } from './commands.mjs';
import fs from 'fs';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    return commands.cmdHelp({})();
  }

  const [command, ...options] = args;
  const parsedOptions = {};

  // Parse options
  for (let i = 0; i < options.length; i++) {
    if (options[i].startsWith('--')) {
      const key = options[i].slice(2);
      
      // Check for value in next option or remaining args
      let value = null;
      
      if (i + 1 < options.length && !options[i + 1].startsWith('--') && options[i + 1] !== 'true' && options[i + 1] !== 'false') {
        value = options[++i];
      } else if (options.includes('true')) {
        value = true;
      } else if (options.includes('false')) {
        value = false;
      }

      parsedOptions[key] = value === null ? '' : value;
    } else if (!parsedOptions.path && !parsedOptions.query) {
      // Positional arguments for commands that don't use -- flags
      if (!parsedOptions.path) {
        parsedOptions.path = options[i];
      } else if (!parsedOptions.query) {
        parsedOptions.query = options[i];
      }
    } else if (!parsedOptions.path1 && !parsedOptions.path2) {
      // For diff command which takes two paths
      if (!parsedOptions.path1) {
        parsedOptions.path1 = options[i];
      } else if (!parsedOptions.path2) {
        parsedOptions.path2 = options[i];
      }
    }
  }

  return parseCommand(command, parsedOptions);
}

/**
 * Parse and execute command
 */
function parseCommand(command, options) {
  const cmdHandlers = [
    ['read', commands.cmdRead],
    ['edit', commands.cmdEdit],
    ['search', commands.cmdSearch],
    ['validate', commands.cmdValidate],
    ['mkdir', commands.cmdMkdir],
    ['diff', commands.cmdDiff]
  ];

  // Find matching command handler
  // Simplified - just find by command name directly
  const selectedHandler = cmdHandlers.find(([cmdName]) => cmdName.toLowerCase() === command.toLowerCase());
  
  if (!selectedHandler) {
    return JSON.stringify({
      error: `Unknown command: ${command}`,
      availableCommands: cmdHandlers.map(([cmd]) => cmd[0].name),
      usage: 'node index.mjs <command> [options]'
    });
  }

  const selectedCmd = selectedHandler;
  
  if (!selectedCmd) {
    return JSON.stringify({
      error: `Unknown command: ${command}`,
      availableCommands: cmdHandlers.map(([cmd]) => cmd[0].name),
      usage: 'node index.mjs <command> [options]'
    });
  }

  // Execute the selected command
  const result = selectedCmd[1](options);
  
  return typeof result.then === 'function' 
    ? result.then(r => JSON.stringify(r)) 
    : JSON.stringify(result());
}

/**
 * Handle error and output JSON
 */
function handleError(error) {
  console.error(JSON.stringify({
    error: error.message || 'Unknown error occurred',
    stack: error.stack,
    timestamp: new Date().toISOString()
  }));
  
  process.exit(1);
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Parse and execute command
    const result = parseArgs();
    
    if (typeof result === 'string') {
      console.log(result);
    } else {
      console.log(JSON.stringify(result));
    }

  } catch (error) {
    handleError(error);
  }
}

// Default export for CLI usage
const helpCommand = async () => {
  return await commands.cmdHelp({})();
};

export default helpCommand;
