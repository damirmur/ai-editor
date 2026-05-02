// Test importing a module that uses const
import { test } from './test-module.mjs';

console.log('Test2.mjs loaded');
const result = test();
console.log('Result:', result);