// src/cli/index.mjs - CLI entry point with JSON input support
import commands from './commands.mjs';

const { cmdRead, cmdEdit, cmdSearch, cmdValidate, cmdMkdir, cmdDiff, cmdHelp } = commands;

async function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    return await cmdHelp();
  }

  let commandSpec;

  try {
    commandSpec = JSON.parse(args[0]);
  } catch (e) {
    // Not valid JSON - treat as positional args: node index.mjs <cmd> [key=value...]
    const inputString = args.join(' ');
    const parts = inputString.trim().split(/\s+/);

    if (!parts.length) {
      throw new Error('No command provided');
    }

    const cmdName = parts[0];
    const paramStr = parts.slice(1).join(' ');

    let paramsObj = {};

    if (paramStr.startsWith('{')) {
      try {
        paramsObj = JSON.parse(paramStr);
      } catch (e) {
        throw new Error(`Invalid JSON parameters: ${e.message}`);
      }
    } else if (paramStr && paramStr.includes('=')) {
      // Parse key=value pairs
      const kvPairs = paramStr.split('&').filter(Boolean);
      for (const pair of kvPairs) {
        const [key, ...valParts] = pair.split('=');
        paramsObj[key.trim()] = valParts.join('=').replace(/\\n/g, '\n').trim();
      }
    }

    if (!cmdName || !commands[cmdName]) {
      return {
        success: false,
        error: `Unknown command: ${cmdName}`,
        details: ['Available commands: read, edit, search, validate, tsconfig, yaml, mkdir, diff, help']
      };
    }

    const cmdHelpInfo = await cmdHelp();
    
    return {
      success: false,
      error: `Unknown command: ${cmdName}`,
      details: ['Use "help" to see available commands'],
      helpText: typeof cmdHelpInfo === 'string' ? cmdHelpInfo : ''
    };
  }

  const [command, ...params] = commandSpec.name ? [commandSpec.name] : [];

  if (!command || !commands[command]) {
    return {
      success: false,
      error: `Unknown or invalid command: ${command}`,
      details: ['Use "help" to see available commands']
    };
  }

  const paramsObj = Array.isArray(params) && params.length > 0 ? params[0] : {};

  try {
    return await executeCommand(command, paramsObj).catch(e => {
      console.error('Error in executeCommand:', e.message);
      throw e;
    });
  } catch (err) {
    throw new Error(`Execution error: ${err.message}`);
  }
}

async function executeCommand(command, options) {
  const handler = commands[command];

  if (!handler || typeof handler !== 'function') {
    return {
      success: false,
      error: `Unknown command: ${command}`,
      details: ['Available commands: read, edit, search, validate, tsconfig, yaml, mkdir, diff, help']
    };
  }

  try {
    const result = await handler(options);

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Command execution failed'
      };
    }

    return {
      success: true,
      data: result.data || {}
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Unexpected error',
      stack: err.stack
    };
  }
}

async function main() {
  try {
    const result = await parseArgs();

    if (typeof result === 'string') {
      console.log(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    const errorResult = {
      success: false,
      error: error.message || 'Unknown error'
    };

    if (error.stack) {
      errorResult.stack = error.stack;
    }

    console.error(errorResult);
    process.exit(1);
  }
}

main();

process.on('exit', () => {});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  throw err;
});

export { main, parseArgs };