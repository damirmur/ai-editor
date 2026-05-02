# Agent Quick Reference

## Architecture

**Mono-repo CLI tool (Node.js 24+)** for file operations via text interface  
**Zero dependencies** - uses only Node.js standard library  
**All output is JSON.stringify()'d** for AI model readability

## Critical Patterns

```bash
node src/cli/index.mjs <command>     # Main entry point
```

- All commands return **JSON objects** - parse results, don't treat as plain text
- Files >10MB use **automatic streaming** (chunked reading)
- `TransactionManager` ensures atomicity: write errors trigger auto rollback
- UTF-8 encoding for all text files

## Testing & Dev

```bash
# Run CLI tool
node src/cli/index.mjs <command> [options]

# Test data locations
src/test_data.json         # Sample JSON test file
src/test_rollback.json     # Rollback/transaction testing
```

No automated tests in package.json. Manual verification required.

## Code Conventions

- **`.mjs` extension** for all ES modules
- **English comments**: Clear, AI-friendly (explain intent, not implementation)
- **Russian CLI messages**: User-facing output only
- JSON output always - never plain text responses

## Project Structure

```
src/
├── core/                    # Core engine
│   ├── fileOperations.mjs    # Stream-based read/write
│   └── transactionManager.mjs # Atomic operations
├── parsers/                 # Format-specific parsers
│   ├── jsonParser.mjs        # JSON validation & analysis
│   └── csvParser.mjs         # CSV header detection
└── cli/                     # CLI interface
    ├── commands.mjs          # Command definitions
    └── index.mjs             # Entry point
```

## Commands

- `read <path>` - Read file (auto-detect format)
- `edit <path> "<content>"` - Write with rollback support
- `search <path> <query>` - Pattern search (streaming for large files)
- `validate <path>` - Format validation & structure analysis
- `mkdir <path>` - Recursive directory creation
- `diff <path1> <path2>` - Compare two files
