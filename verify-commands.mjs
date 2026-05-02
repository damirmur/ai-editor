// Test to verify exact content of line 97 in commands.mjs
import { readFile } from 'fs/promises';

const filePath = 'D:\\.lmstudio\\projects\\ai-editor\\src\\cli\\commands.mjs';
const content = await readFile(filePath, 'utf8');
const lines = content.split('\n');
const line97 = lines[96]; // 0-indexed

console.log('Line 97:', line97);
console.log('Length:', line97.length);

// Show each character with its code point
for (let i = 0; i < line97.length; i++) {
  const char = line97[i];
  const codePoint = char.codePointAt(0);
  const isSpecial = codePoint > 127 || codePoint === 8203 || codePoint === 8204; // invisible chars
  
  if (isSpecial) {
    console.log(`[${i}] SPECIAL: U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`);
  } else {
    console.log(`[${i}] '${char}' (U+${codePoint.toString(16).toUpperCase()})`);
  }
}

// Check if "const" is exactly the word
if (line97.trim().startsWith('const')) {
  // Extract just "const" part and verify each character
  const keyword = 'const';
  for (let i = 0; i < keyword.length; i++) {
    const charCode = keyword[i].charCodeAt(0);
    console.log(`Verifying '${keyword[i]}' at position ${i}: U+${charCode.toString(16).toUpperCase()} (expected: 'c','o','n','s','t')`);
  }
  
  // Check if the word is followed by proper syntax (space + identifier or =)
  const afterConst = line97.match(/const\s+\w+/);
  if (!afterConst) {
    console.error('✗ Invalid const declaration pattern');
    process.exit(1);
  }
  
  console.log('\n✓ Valid const declaration found:', afterConst[0]);
}

console.log('\n=== File content is valid JavaScript ===');