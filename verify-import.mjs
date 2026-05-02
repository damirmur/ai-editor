import fs from 'fs';
const content = await fs.promises.readFile('D:\\.lmstudio\\projects\\ai-editor\\src\\cli\\commands.mjs', 'utf8');
console.log('File loaded successfully, size:', content.length);

// Write a minimal test
await fs.promises.writeFile(
  'D:\\.lmstudio\\projects\\ai-editor\\test-import.mjs',
  `import commands from './src/cli/commands.mjs'; console.log('Commands imported:', Object.keys(commands));`
);
console.log('Test file written');