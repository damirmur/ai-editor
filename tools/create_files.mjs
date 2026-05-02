const fs = require('fs');
const path = require('path');

const projectDir = 'D:.lmstudio\\mcp-servers\\ai-file';
const srcDir = path.join(projectDir, 'src', 'core');

// FileOperations content without BOM
const fileOperationsCode = `const fs = require("fs");
const path = require("path");

export class FileOperations {
  static async readFile(filePath) {
    return fs.promises.readFile(filePath);
  }

  static async writeFile(filePath, data) {
    await fs.promises.writeFile(filePath, data);
  }

  static async appendFile(filePath, data) {
    await fs.promises.appendFile(filePath, data);
  }
}`;

fs.writeFileSync(
  path.join(srcDir, 'fileOperations.ts'),
  fileOperationsCode,
  'utf8'
);

console.log('Created src/core/fileOperations.ts');
