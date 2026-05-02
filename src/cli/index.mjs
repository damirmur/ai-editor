// src/cli/index.mjs - CLI entry point with JSON input support
import commands, { cmdRead, cmdEdit, cmdSearch, cmdValidate, cmdMkdir, cmdDiff, cmdHelp, cmdTsconfig, cmdYaml } from './commands.mjs';

async function parseArgs() {
  const args = process.argv.slice(2);
  
  let commandSpec = null;
  
// Check if first arg is JSON or a command name
  if (args.length === 0) {
    return await cmdHelp({});
  } else if (!args[0].startsWith('{')) {
    // First arg is not JSON - it's a command name: node index.mjs <cmd> [params...]
    const cmdName = args[0];
    
if (cmdName === 'help') {
      const helpInfo = await cmdHelp({});
      console.log(typeof helpInfo === 'string' ? helpInfo : JSON.stringify(helpInfo, null, 2));
      process.exit(0);
    }
    
    let paramsObj = {};
    
    // Parse remaining args - could be JSON or key=value pairs
    const paramStr = args.slice(1).join(' ');
    
    if (paramStr.startsWith('{')) {
      try {
        paramsObj = JSON.parse(paramStr);
      } catch (e) {
        return { success: false, error: `Invalid JSON parameters: ${e.message}` };
      }
    } else if (paramStr.includes('=')) {
      // Parse key=value pairs separated by &
      const kvPairs = paramStr.split('&').filter(Boolean);
      for (const pair of kvPairs) {
        const [key, ...valParts] = pair.split('=');
        paramsObj[key.trim()] = valParts.join('=').replace(/\\n/g, '\n').trim();
      }
    }
    
    // Execute the command
    return await executeCommand(cmdName, paramsObj);
  } else {
    // First arg looks like JSON - try to parse it as full spec: {"name":"cmd","params":{...}}
    let parsed;
    try {
      parsed = JSON.parse(args[0]);
    } catch (e) {
      return { success: false, error: `Invalid JSON input: ${e.message}` };
    }
    
    const [command, ...params] = parsed.name ? [parsed.name] : [];
    
    if (!command || !commands[command]) {
      return { 
        success: false,
        error: `Unknown or invalid command: ${command}`,
        details: ['Use "help" to see available commands']
      };
    }
    
    const paramsObj = Array.isArray(params) && params.length > 0 ? params[0] : {};
    
    return await executeCommand(command, paramsObj);
  }
}

async function executeCommand(command, options) {
const commandMap = {
    read: cmdRead,
    edit: cmdEdit,
    search: cmdSearch,
    validate: cmdValidate,
    mkdir: cmdMkdir,
    diff: cmdDiff,
    help: cmdHelp,
    tsconfig: cmdTsconfig,
    yaml: cmdYaml
  };
  
  const handler = commandMap[command];
  
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
      return { success: false, error: result.error || 'Command execution failed' };
    }
    
    return { success: true, data: result.data || {} };
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
    } else if (result.success) {
      console.log(JSON.stringify(result.data, null, 2));
    } else {
      console.error({ success: false, error: result.error });
      process.exit(1);
    }
  } catch (error) {
    console.error({ 
      success: false, 
      error: error.message || 'Unknown error',
      stack: error.stack
    });
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
