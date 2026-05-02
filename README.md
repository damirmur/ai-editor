# AI-File Editor

CLI file editor optimized for AI models working with Node.js v24+

## Features

### Core Capabilities
- **Streaming read** for large files (>10MB) with minimal memory usage
- **Atomic writes** with automatic rollback on failure
- **Directory creation** with recursive path support (mkdir -p equivalent)
- **No external dependencies** - uses only Node.js standard library

### Format Support
- **JSON**: Syntax validation, type conversion, circular reference detection, structure analysis
- **CSV**: Header analysis, delimiter detection, key-value conversion
- **Text/Log files**: Streaming search and read without full load into memory

## Installation

```bash
# Requires Node.js 24+
node --version # should show v24.x or higher
```

## Usage

### Basic Commands

```bash
# Read file (auto-parses JSON/CSV based on content)
node src/cli/index.mjs read <path>

# Edit/write file (with automatic rollback on failure)
node src/cli/index.mjs edit <path> "<new_content>"

# Search for pattern in file (streaming support for large files)
node src/cli/index.mjs search <path> <query>

# Validate and parse file by detected format
node src/cli/index.mjs validate <path>

# Create directories recursively
node src/cli/index.mjs mkdir <path>

# Compare two files
node src/cli/index.mjs diff <path1> <path2>
```

### Programmatic Usage (Node.js)

```javascript
import { cmdRead, cmdEdit, cmdSearch } from './src/cli/commands.mjs';

// Read a file - output is always JSON.stringify'd for AI models
const readResult = await cmdRead({ path: 'package.json' })();
console.log(JSON.parse(readResult));

// Write with transaction support (auto-rollback on error)
await cmdEdit({ path: 'config.json', content: '{"key": "value"}' })();

// Search for errors in large log files efficiently
const searchResult = await cmdSearch({ 
  path: '/var/log/app.log', 
  query: 'ERROR' 
})();
```

## Project Structure

```
ai-file/
├── src/
│   ├── core/                    # Core engine
│   │   ├── fileOperations.mjs    # Stream-based read/write operations
│   │   └── transactionManager.mjs # Atomic operations with rollback
│   ├── parsers/                 # Format-specific parsers
│   │   ├── jsonParser.mjs        # JSON with schema validation
│   │   └── csvParser.mjs         # CSV with header analysis
│   └── cli/                     # CLI interface
│       ├── commands.mjs          # Command definitions (read, edit, search, etc.)
│       └── index.mjs             # Entry point for CLI
├── configs/                     # Configuration templates
├── tests/                       # Test files
└── package.json
```

## Performance Targets

| File Size | Open Time | Memory Usage | Method          |
|-----------|-----------|--------------|-----------------|
| 1KB JSON  | <5ms      | ~2MB         | Full load       |
| 100KB TS  | <50ms     | ~5MB         | Full load       |
| 1MB CSV   | <200ms    | ~10MB        | Streaming read  |
| 10MB+ log | <1s       | ~20MB        | Chunked streaming |

## Technical Details

### File Operations
- **Streaming**: Files >10MB automatically use chunked reading (default: 1MB chunks)
- **Transactions**: Automatic backup before writes, rollback on failure
- **Atomicity**: Write operations include parent directory creation

### JSON Parser Features
- Syntax validation with error position detection
- Recursive structure analysis with depth limiting (max 1000 levels)
- Type conversion: strings → numbers/booleans where appropriate
- Circular reference protection via WeakSet tracking

### CSV Parser Features  
- Delimiter auto-detection from file content
- Header row extraction for key-value conversion
- Quoted field handling and escape processing
- Structure consistency validation

### Transaction Manager
- Backup storage using in-memory Map (fileId → content)
- Automatic cleanup after successful commits
- Manual rollback capability when needed
- Atomic write support with error recovery

## CLI Output Format

All CLI commands output **JSON.stringify()'d** results for machine readability by AI models:

```json
{
  "content": {"name": "test", "value": 42},
  "meta": {
    "type": "object",
    "depth": 1,
    "properties": 2,
    "arrayLength": 0,
    "hasCircularReferences": false
  }
}
```

## Error Handling

All errors return structured JSON responses:

```json
{
  "error": "File not found: /path/to/file.json",
  "suggestedAction": "Use 'mkdir' to create directory first"
}
```

## Development Status

### ✅ Completed (Phase 1 - MVP)
- [x] Core file operations with streaming support
- [x] Transaction manager with automatic rollback
- [x] JSON parser with validation and structure analysis
- [x] CSV parser with header detection
- [x] CLI commands: read, edit, search, validate, mkdir, diff
- [x] UTF-8 encoding support for all text files

### 📋 Future Phases

**Phase 2 - Enhanced Analysis:**
- TypeScript AST parsing (for code and tsconfig)
- Two-way structural diff engine
- Multi-file transaction support
- YAML parser implementation

**Phase 3 - AI Optimizations:**
- Advanced pattern matching with type awareness
- Context-aware autocomplete suggestions
- Built-in formatter for all supported formats

## License

MIT
