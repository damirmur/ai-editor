/**
 * Unified Validation Engine for CLI Commands
 */

export function validateInput(inputData, schema) {
  const errors = [];
  const output = {};

  if (schema.required && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (!(field in inputData)) {
        errors.push(`Missing required field: ${field}`);
      } else {
        output[field] = inputData[field];
      }
    }
  }

  if (schema.optional && typeof schema.optional === 'object') {
    for (const [key, fieldSchema] of Object.entries(schema.optional)) {
      const value = inputData[key];

      if (value !== undefined) {
        output[key] = coerceType(value, fieldSchema);
      } else if (fieldSchema.default !== undefined) {
        output[key] = fieldSchema.default;
      }
    }
  }

  if (inputData.query && inputData.query.$async === true) {
    output.$async = true;
    delete output.query;
  }

  return { data: output, errors };
}

function coerceType(value, schema) {
  let coercedValue = value;

  if (schema.type === 'boolean') {
    if (typeof value === 'string') {
      coercedValue = value.toLowerCase() === 'true';
    } else {
      coercedValue = Boolean(value);
    }
  } else if (schema.type === 'number') {
    coercedValue = Number(value);
    if (Number.isNaN(coercedValue)) {
      throw new Error(`Invalid number value: ${value}`);
    }
  } else if (schema.type === 'string') {
    coercedValue = String(value);
  }

  return coercedValue;
}

export function validateCommandInput(commandName, inputData) {
  const commands = {
    read: {
      required: ['path'],
      optional: {
        streamLargeFiles: { type: 'boolean', default: false },
        maxFileSize: { type: 'number', default: 10485760 }
      }
    },
    edit: {
      required: ['path', 'content'],
      optional: {}
    },
    search: {
      required: ['path', 'query'],
      optional: {
        maxResults: { type: 'number', default: 100 }
      }
    },
    validate: {
      required: ['path'],
      optional: {}
    },
    tsconfig: {
      required: ['path'],
      optional: {
        analyzeExtends: { type: 'boolean', default: false }
      }
    },
    yaml: {
      required: ['path'],
      optional: {
        strictMode: { type: 'boolean', default: true }
      }
    },
    mkdir: {
      required: ['path'],
      optional: {}
    },
    diff: {
      required: ['leftPath', 'rightPath'],
      optional: {}
    }
  };

  const schema = commands[commandName];

  if (!schema) {
    return { success: false, error: `Unknown command: ${commandName}`, details: [] };
  }

  let validationResult;

  try {
    validationResult = validateInput(inputData, schema);
  } catch (error) {
    return { success: false, error: `Validation failed: ${error.message}`, details: [error.message] };
  }

  if (!validationResult.success && validationResult.errors.length > 0) {
    return {
      success: false,
      error: 'Invalid input parameters',
      details: validationResult.errors
    };
  }

  try {
    validateDataTypes(validationResult.data, schema.optional);
  } catch (error) {
    return {
      success: false,
      error: `Type validation failed: ${error.message}`,
      details: [error.message]
    };
  }

  validationResult.success = true;
  return validationResult;
}

function validateDataTypes(data, schemaFields) {
  if (!schemaFields || typeof data !== 'object') {
    return;
  }

  for (const [key, fieldSchema] of Object.entries(schemaFields)) {
    const value = data[key];

    if (value === undefined) continue;

    if (fieldSchema.type === 'number' && typeof value !== 'number') {
      throw new Error(`Field ${key} must be a number`);
    } else if (fieldSchema.type === 'boolean' && typeof value !== 'boolean') {
      throw new Error(`Field ${key} must be a boolean`);
    } else if (fieldSchema.type === 'string' && typeof value !== 'string') {
      throw new Error(`Field ${key} must be a string`);
    }
  }
}

export function buildCommandSchema(commandName) {
  const baseCommands = {
    read: {
      description: 'Read file content with optional streaming for large files',
      required: ['path'],
      optional: {
        streamLargeFiles: { type: 'boolean', default: false },
        maxFileSize: { type: 'number', default: 10485760 }
      }
    },
    edit: {
      description: 'Write content to file with transaction support',
      required: ['path', 'content'],
      optional: {}
    },
    search: {
      description: 'Search for pattern in file with streaming support',
      required: ['path', 'query'],
      optional: {
        maxResults: { type: 'number', default: 100 }
      }
    },
    validate: {
      description: 'Validate and parse file by detected format',
      required: ['path'],
      optional: {}
    },
    tsconfig: {
      description: 'Parse TypeScript configuration with AST analysis',
      required: ['path'],
      optional: {
        analyzeExtends: { type: 'boolean', default: false }
      }
    },
    yaml: {
      description: 'Parse YAML file with structure analysis',
      required: ['path'],
      optional: {}
    },
    mkdir: {
      description: 'Create directories recursively',
      required: ['path'],
      optional: {}
    },
    diff: {
      description: 'Compare two files (structural diff for JSON/TS, text diff otherwise)',
      required: ['leftPath', 'rightPath'],
      optional: {}
    }
  };

  const schema = baseCommands[commandName];

  if (!schema) {
    throw new Error(`No schema found for command: ${commandName}`);
  }

  return schema;
}

export function generateHelpJSON(commandName, includeExamples = true) {
  try {
    const schema = buildCommandSchema(commandName);

    let helpObject = {
      name: commandName,
      description: schema.description,
      requiredFields: schema.required || [],
      optionalFields: Object.keys(schema.optional || {}),
      typeInfo: {}
    };

    if (schema.optional) {
      for (const [key, field] of Object.entries(schema.optional)) {
        helpObject.typeInfo[key] = {
          type: field.type,
          default: field.default
        };
      }
    }

    if (includeExamples && schema.examples) {
      helpObject.examples = schema.examples;
    }

    return helpObject;
  } catch (error) {
    throw new Error(`Failed to generate help for command ${commandName}: ${error.message}`);
  }
}