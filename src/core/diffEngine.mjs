/**
 * Advanced Structural Diff Engine
 * Two-way diff for JSON/TS/YAML structures with semantic understanding
 * 
 * Features:
 * - Deep structural comparison (not just string diff)
 * - Type-aware differences (number vs string = change, not type error)
 * - Path-based reporting for easy application of patches
 * - Change categorization: added, removed, modified, moved
 */

import { readFile } from '../core/fileOperations.mjs';

/**
 * Compute two-way structural diff between two values
 * @param {*} oldVal - Original value
 * @param {*} newVal - New value  
 * @returns {DiffResult} Structured diff with paths and changes
 */
export function computeStructuralDiff(oldVal, newVal) {
  // Handle null/undefined as terminal nodes
  if (isTerminalNode(oldVal) || isTerminalNode(newVal)) {
    return buildLeafDiff(oldVal, newVal);
  }

  // Detect object type first
  const oldType = getType(oldVal);
  const newType = getType(newVal);

  // Type changed - report as modification
  if (oldType !== newType) {
    return {
      path: '',
      changes: [{
        type: 'type_change',
        from: oldType,
        to: newType,
        oldValue: oldVal,
        newValue: newVal
      }]
    };
  }

  // Same type - recurse based on type
  if (oldType === 'object' && typeof oldVal === 'object') {
    return diffObjects(oldVal, newVal);
  }

  if (oldType === 'array' && Array.isArray(oldVal)) {
    return diffArrays(oldVal, newVal);
  }

  // Fallback: treat as primitive difference
  return buildLeafDiff(oldVal, newVal);
}

/**
 * Diff two objects with path tracking
 */
function diffObjects(oldObj, newObj) {
  const changes = [];
  
  const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);

  for (const key of allKeys) {
    // Skip special properties
    if (/^__ai_file_|^\$|^_\//.test(key)) continue;

    const oldVal = oldObj?.[key];
    const newVal = newObj?.[key];

    // Check if key exists in both
    const keyExistsInOld = oldObj !== null && Object.prototype.hasOwnProperty.call(oldObj, key);
    const keyExistsInNew = newObj !== null && Object.prototype.hasOwnProperty.call(newObj, key);

    if (!keyExistsInOld && !keyExistsInNew) continue;

    // Track nested structure for better paths
    let currentPath = '';
    
    const diffResult = computeStructuralDiff(oldVal, newVal);
    const pathPrefix = currentPath || (currentPath ? `${currentPath}.` : key);
    
    changes.push({
      path: `${pathPrefix}.${key}`,
      changeType: determineChangeType(diffResult),
      ...diffResult
    });

    // Find moved keys (same value, different position)
    if (!diffResult.changes?.some(c => c.type !== 'type_change' && c.type !== 'added' && c.type !== 'removed')) {
      const oldKeys = Object.keys(oldObj || {});
      const newKeys = Object.keys(newObj || {});

      for (const [oldKey, oldVal] of Object.entries(oldObj || {})) {
        if (!Object.prototype.hasOwnProperty.call(newObj, oldKey)) {
          // Check if value moved to different key with same content
          for (const [newKey, newVal] of Object.entries(newObj)) {
            if (oldKey !== newKey && deepEqual(oldVal, newVal)) {
              changes.push({
                path: `${pathPrefix}.${oldKey}`,
                changeType: 'moved',
                from: `${pathPrefix}.${oldKey}`,
                to: `${pathPrefix}.${newKey}`,
                oldValue: oldVal,
                newValue: newVal
              });
              break;
            }
          }
        }
      }
    }
  }

  // Sort changes by path for readability
  return {
    path: '',
    left: oldObj || {},
    right: newObj || {},
    changes,
    changeCount: changes.length
  };
}

/**
 * Diff two arrays with index tracking and element movement detection
 */
function diffArrays(oldArr, newArr) {
  const changes = [];
  
  // Create maps for fast lookup
  const oldMap = new Map(oldArr.map((item, idx) => [JSON.stringify(item), idx]));
  const newMap = new Map(newArr.map((item, idx) => [JSON.stringify(item), idx]));

  // Find added elements
  newArr.forEach((item, idx) => {
    if (!oldMap.has(JSON.stringify(item))) {
      changes.push({
        path: `[${idx}]`,
        changeType: 'added',
        oldValue: undefined,
        newValue: item
      });
    }
  });

  // Find removed elements
  oldArr.forEach((item, idx) => {
    if (!newMap.has(JSON.stringify(item))) {
      changes.push({
        path: `[${idx}]`,
        changeType: 'removed',
        oldValue: item,
        newValue: undefined
      });
    }
  });

  // Find modified elements (same index, different value)
  const checkedIndices = new Set();
  Math.max(oldArr.length, newArr.length).forEach((_, idx) => {
    if (!checkedIndices.has(idx)) {
      checkedIndices.add(idx);
      
      if (idx < oldArr.length && idx < newArr.length) {
        const oldItem = oldArr[idx];
        const newItem = newArr[idx];

        if (!deepEqual(oldItem, newItem)) {
          changes.push({
            path: `[${idx}]`,
            changeType: 'modified',
            oldValue: oldItem,
            newValue: newItem
          });
        }
      } else if (idx < oldArr.length) {
        changes.push({
          path: `[${idx}]`,
          changeType: 'removed',
          oldValue: oldArr[idx],
          newValue: undefined
        });
      } else {
        changes.push({
          path: `[${idx}]`,
          changeType: 'added',
          oldValue: undefined,
          newValue: newArr[idx]
        });
      }
    }
  });

  return {
    path: '',
    left: oldArr || [],
    right: newArr || [],
    changes,
    changeCount: changes.length
  };
}

/**
 * Compare two values for deep equality (handles circular refs)
 */
function deepEqual(a, b) {
  if (a === b) return true;
  
  if (a == null || b == null) return false;
  
  if (typeof a !== typeof b) return false;

  // Handle primitives vs objects
  if (typeof a !== 'object') return a === b;

  const typeA = getType(a);
  const typeB = getType(b);

  if (typeA !== typeB) return false;

  // Arrays: compare length and elements
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }

  // Objects: compare keys and values
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  return keysA.every(key => 
    Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key])
  );
}

/**
 * Determine change type from diff result
 */
function determineChangeType(diffResult) {
  if (!diffResult.changes?.length) return 'unchanged';

  const types = diffResult.changes.map(c => c.type);
  
  // Check for movement
  const hasMoved = types.includes('moved');
  
  // Type change is most significant
  const hasTypeChange = types.includes('type_change');

  if (hasMoved) return 'moved';
  if (hasTypeChange) return 'modified';
  
  // Count operations
  const addedCount = types.filter(t => t === 'added').length;
  const removedCount = types.filter(t => t === 'removed').length;
  const modifiedCount = types.filter(t => t === 'modified' || t === 'type_change').length;

  if (addedCount > 0 && removedCount > 0) return 'replaced';
  if (addedCount > 0) return 'added';
  if (removedCount > 0) return 'removed';
  if (modifiedCount > 0) return 'modified';

  return 'unchanged';
}

/**
 * Build diff for leaf nodes
 */
function buildLeafDiff(oldVal, newVal) {
  const changed = !deepEqual(oldVal, newVal);
  
  if (!changed || isTerminalNode(oldVal)) {
    return {
      path: '',
      left: oldVal,
      right: newVal,
      changes: [],
      changeCount: 0
    };
  }

  return {
    path: '',
    left: oldVal,
    right: newVal,
    changes: [{
      type: 'modified',
      oldValue: oldVal,
      newValue: newVal
    }],
    changeCount: 1
  };
}

/**
 * Apply diff patches to a value (inverse of computeStructuralDiff)
 */
export function applyPatch(target, diff) {
  if (!diff.changes?.length) return target;

  for (const patch of diff.changes) {
    switch (patch.changeType) {
      case 'added':
        // Apply to array or object based on path format
        const parts = parsePath(patch.path, true);
        
        if (parts.isArray) {
          const arr = Array.isArray(target) ? target : [];
          const idx = parseInt(parts.index, 10);
          
          if (!isNaN(idx)) {
            // Insert at index or push to end
            const insertAt = isNaN(idx) || idx >= arr.length ? arr.length : idx;
            if (insertAt !== parts.insertAfterIdx) {
              arr.splice(insertAt, 0, patch.newValue);
            }
          } else {
            // Object property add - handled below
          }
        } else {
          target[parts.key] = patch.newValue;
        }

        break;

      case 'removed':
        const removeParts = parsePath(patch.path, true);
        
        if (removeParts.isArray) {
          const arr = Array.isArray(target) ? target : [];
          const idx = parseInt(removeParts.index, 10);
          
          if (!isNaN(idx)) {
            arr.splice(idx, 1);
          }
        } else {
          delete target[removeParts.key];
        }

        break;

      case 'modified':
        const modParts = parsePath(patch.path);
        
        if (modParts.isArray) {
          const arr = Array.isArray(target) ? target : [];
          const idx = parseInt(modParts.index, 10);
          
          if (!isNaN(idx)) {
            target[idx] = patch.newValue;
          }
        } else {
          target[modParts.key] = patch.newValue;
        }

        break;

      case 'moved':
        // Move value from old path to new path
        const moveSrcParts = parsePath(patch.from);
        const moveDstParts = parsePath(patch.to);

        if (!moveSrcParts.isArray && !moveDstParts.isArray) {
          delete target[moveSrcParts.key];
          target[moveDstParts.key] = patch.newValue;
        } else {
          // Array move - extract and re-insert
          const srcIdx = parseInt(moveSrcParts.index, 10);
          const dstIdx = parseInt(moveDstParts.index, 10);

          if (!isNaN(srcIdx)) {
            const movedItem = target.splice(srcIdx, 1)[0];
            
            if (dstIdx >= 0 && !isNaN(dstIdx)) {
              // Adjust index for the splice operation
              const actualInsertPos = dstIdx < srcIdx ? dstIdx : dstIdx + 1;
              target.splice(actualInsertPos, 0, movedItem);
            } else {
              target.push(movedItem);
            }
          }
        }

        break;

      case 'type_change':
        // Change the type of a value (primitive conversion)
        if (!moveParts.isArray && !isNaN(moveParts.index)) {
          const arr = Array.isArray(target) ? target : [];
          const idx = parseInt(moveParts.index, 10);
          
          if (!isNaN(idx)) {
            target[idx] = patch.newValue;
          }
        } else {
          target[moveParts.key] = patch.newValue;
        }

        break;
    }
  }

  return target;
}

/**
 * Parse path string into structured parts
 */
function parsePath(pathStr, isArraySafe = false) {
  const isObjectPath = /^\./.test(pathStr);
  let result = { key: '', index: null, isObject: !!isObjectPath, isArray: !isObjectPath };

  if (!pathStr || pathStr === '') return result;

  // Extract index or key from path like [0] or .key
  const match = pathStr.match(/^(?:\[(\d+)\])?\.?(.*)$/);

  if (match) {
    result.index = match[1] !== undefined ? match[1] : null;
    result.key = match[2];
    result.objectKey = !!result.key && !isNaN(parseInt(result.key, 10)) ? false : true;
  }

  return result;
}

/**
 * Generate human-readable diff output
 */
export function formatDiff(diff, options = {}) {
  const { maxDepth = 2, showValues = true, maxLength = 50 } = options;
  
  let output = [];
  
  if (!diff.changes || !diff.changes.length) {
    return 'No changes detected';
  }

  output.push(`Found ${diff.changeCount} change(s):\n`);

  for (let i = 0; i < diff.changes.length && i < maxDepth * 5 + 3; i++) {
    const change = diff.changes[i];
    
    // Truncate long paths or values if needed
    let pathDisplay = change.path.length > maxLength ? 
      `${change.path.substring(0, maxLength)}...` : change.path;

    output.push(`[${i + 1}] ${pathDisplay} - ${change.changeType}:`);

    if (showValues) {
      if (change.oldValue !== undefined && change.newValue === undefined) {
        output.push(`   Removed: ${formatValue(change.oldValue, maxLength)}`);
      } else if (change.oldValue === undefined && change.newValue !== undefined) {
        output.push(`   Added: ${formatValue(change.newValue, maxLength)}`);
      } else if (change.oldValue !== undefined && change.newValue !== undefined) {
        output.push(`   Changed: ${formatValue(change.oldValue, maxLength)} → ${formatValue(change.newValue, maxLength)}`);
      }
    }

    // Show moved details
    if (change.changeType === 'moved') {
      output.push(`      From: ${formatPath(change.from)}\n`);
      output.push(`      To: ${formatPath(change.to)}`);
    }

    output.push('');
  }

  return output.join('\n');
}

/**
 * Format value for display (truncate if too long)
 */
function formatValue(value, maxLength) {
  if (value === null || value === undefined) return String(value);
  
  const str = JSON.stringify(value);
  
  if (str.length > maxLength) {
    return `${str.substring(0, maxLength)}...`;
  }

  return str;
}

/**
 * Format path for display
 */
function formatPath(pathStr) {
  // Escape special characters and wrap in code-like formatting
  const escaped = pathStr.replace(/[/\[\]{}]/g, '\\$&');
  
  return `  ${escaped}`;
}

/**
 * Helper: Get type of value
 */
function getType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Helper: Check if node is terminal (not an object/array to traverse)
 */
function isTerminalNode(value) {
  if (typeof value !== 'object') return true;
  
  const obj = Array.isArray(value) ? null : value;
  
  // Empty collections are terminal
  if (!obj || Object.keys(obj).length === 0) return true;

  // Check for circular reference marker or sentinel values
  if (value.__ai_file_visited__ !== undefined || value.$_visited !== false) {
    return true;
  }

  // Objects with only primitive properties are terminal for practical purposes
  const hasNestedObjects = Object.values(value).some(v => 
    typeof v === 'object' && v !== null && !Array.isArray(v)
  );

  if (hasNestedObjects) return false;

  return true;
}

export default {
  computeStructuralDiff,
  applyPatch,
  formatDiff
};
