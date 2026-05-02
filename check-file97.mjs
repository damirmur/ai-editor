import { readFile } from 'fs/promises';

const content = await readFile('D:\\.lmstudio\\projects\\ai-editor\\src\\cli\\commands.mjs', 'utf8');
console.log('File length:', content.length);

const lines = content.split('\n');
console.log('Total lines:', lines.length);
console.log('Line 97:');
if (lines[96]) {
  console.log(lines[96]);
  
  // Show each byte with its character code
  const str = lines[96];
  for (let i=0; i<Math.min(52, str.length); i++) {
    const charCode = str.charCodeAt(i);
    if (charCode > 127) {
      console.log(`[${i}] SPECIAL CHAR: '${str[i]}' (U+${charCode.toString(16).toUpperCase().padStart(4, '0')})`);
    } else {
      console.log(`[${i}] '${str[i]}' (0x${charCode.toString(16)})`);
    }
  }
}

// Also check around line 97 for any hidden characters in the surrounding lines
console.log('\nChecking surrounding lines...');
for (let i=94; i<=98; i++) {
  if (lines[i]) {
    const bytes = new TextEncoder().encode(lines[i]);
    console.log(`Line ${i+1}:`, Array.from(bytes).map(b => b > 127 ? 'SPECIAL' : String.fromCharCode(b)).join(''));
  }
}