import { JSONSchema, ValidationError, JSONSchemaType } from './types.js';

export interface ValidatorOptions {
  /** Allow early rejection on type mismatch */
  earlyReject?: boolean;
  /** Collect all errors or stop at first */
  allErrors?: boolean;
}

export interface ValidationContext {
  path: string[];
  schema: JSONSchema;
  root: JSONSchema;
  definitions: Record<string, JSONSchema>;
}

export class SchemaValidator {
  private options: ValidatorOptions;
  private definitions: Record<string, JSONSchema>;

  constructor(private schema: JSONSchema, options: ValidatorOptions = {}) {
    this.options = {
      earlyReject: options.earlyReject ?? true,
      allErrors: options.allErrors ?? false,
    };
    this.definitions = {
      ...schema.$defs,
      ...schema.definitions,
    };
  }

  /**
   * Validate a complete value against the schema
   */
  validate(value: unknown, path: string[] = []): ValidationError[] {
    // Get the schema at the specified path
    const schemaAtPath = path.length > 0 ? this.getSchemaAtPath(path) : this.schema;
    if (!schemaAtPath) {
      // No schema for this path, allow any value
      return [];
    }

    const ctx: ValidationContext = {
      path,
      schema: schemaAtPath,
      root: this.schema,
      definitions: this.definitions,
    };
    return this.validateValue(value, ctx);
  }

  /**
   * Validate a partial value - used during streaming
   * Returns errors only for fields that are complete
   */
  validatePartial(
    value: unknown,
    completedPaths: Set<string>,
    path: string[] = []
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const pathStr = path.join('.');

    // Only validate if this path is complete
    if (completedPaths.has(pathStr) || pathStr === '') {
      const ctx: ValidationContext = {
        path,
        schema: this.schema,
        root: this.schema,
        definitions: this.definitions,
      };
      errors.push(...this.validateValue(value, ctx));
    }

    return errors;
  }

  /**
   * Check if a type is valid for the schema before receiving full value
   * Used for early rejection
   */
  canBeType(type: JSONSchemaType, path: string[] = []): boolean {
    const subSchema = this.getSchemaAtPath(path);
    if (!subSchema) return true; // No schema constraint

    // Resolve $ref if needed
    const resolved = this.resolveRef(subSchema);

    if (resolved.type === undefined) {
      // No type constraint, check for other indicators
      if (resolved.properties !== undefined || resolved.required !== undefined) {
        return type === 'object';
      }
      if (resolved.items !== undefined) {
        return type === 'array';
      }
      return true;
    }

    if (Array.isArray(resolved.type)) {
      return resolved.type.includes(type);
    }

    // Special case: integer is a subset of number
    if (resolved.type === 'integer' && type === 'number') {
      return true;
    }

    return resolved.type === type;
  }

  /**
   * Get the schema for a specific path
   */
  getSchemaAtPath(path: string[]): JSONSchema | undefined {
    let current = this.schema;

    for (const segment of path) {
      current = this.resolveRef(current);

      if (current.properties?.[segment]) {
        current = current.properties[segment];
      } else if (current.additionalProperties && typeof current.additionalProperties === 'object') {
        current = current.additionalProperties;
      } else if (current.items) {
        // Array item
        if (Array.isArray(current.items)) {
          const index = parseInt(segment, 10);
          if (!isNaN(index) && current.items[index]) {
            current = current.items[index];
          } else if (current.additionalItems && typeof current.additionalItems === 'object') {
            current = current.additionalItems;
          } else {
            return undefined;
          }
        } else {
          current = current.items;
        }
      } else {
        return undefined;
      }
    }

    return this.resolveRef(current);
  }

  /**
   * Get required fields for a path
   */
  getRequiredFields(path: string[] = []): string[] {
    const schema = this.getSchemaAtPath(path);
    if (!schema) return [];
    return schema.required ?? [];
  }

  /**
   * Check if a field is required
   */
  isRequired(fieldName: string, parentPath: string[] = []): boolean {
    const schema = this.getSchemaAtPath(parentPath);
    if (!schema) return false;
    return schema.required?.includes(fieldName) ?? false;
  }

  private validateValue(value: unknown, ctx: ValidationContext): ValidationError[] {
    const errors: ValidationError[] = [];
    const schema = this.resolveRef(ctx.schema);

    // Type validation
    if (schema.type !== undefined) {
      const typeErrors = this.validateType(value, schema.type, ctx);
      errors.push(...typeErrors);
      if (typeErrors.length > 0 && this.options.earlyReject) {
        return errors;
      }
    }

    // Const validation
    if (schema.const !== undefined) {
      if (!this.deepEqual(value, schema.const)) {
        errors.push(this.createError(ctx, 'const', `Value must be ${JSON.stringify(schema.const)}`));
      }
    }

    // Enum validation
    if (schema.enum !== undefined) {
      if (!schema.enum.some(e => this.deepEqual(value, e))) {
        errors.push(this.createError(ctx, 'enum', `Value must be one of: ${schema.enum.map(e => JSON.stringify(e)).join(', ')}`));
      }
    }

    // Type-specific validation
    if (typeof value === 'string') {
      errors.push(...this.validateString(value, schema, ctx));
    } else if (typeof value === 'number') {
      errors.push(...this.validateNumber(value, schema, ctx));
    } else if (Array.isArray(value)) {
      errors.push(...this.validateArray(value, schema, ctx));
    } else if (value !== null && typeof value === 'object') {
      errors.push(...this.validateObject(value as Record<string, unknown>, schema, ctx));
    }

    // Combining schemas
    if (schema.allOf) {
      for (const subSchema of schema.allOf) {
        const subCtx: ValidationContext = { ...ctx, schema: subSchema };
        errors.push(...this.validateValue(value, subCtx));
      }
    }

    if (schema.anyOf) {
      const anyValid = schema.anyOf.some(subSchema => {
        const subCtx: ValidationContext = { ...ctx, schema: subSchema };
        return this.validateValue(value, subCtx).length === 0;
      });
      if (!anyValid) {
        errors.push(this.createError(ctx, 'anyOf', 'Value must match at least one schema in anyOf'));
      }
    }

    if (schema.oneOf) {
      const validCount = schema.oneOf.filter(subSchema => {
        const subCtx: ValidationContext = { ...ctx, schema: subSchema };
        return this.validateValue(value, subCtx).length === 0;
      }).length;
      if (validCount !== 1) {
        errors.push(this.createError(ctx, 'oneOf', `Value must match exactly one schema in oneOf (matched ${validCount})`));
      }
    }

    if (schema.not) {
      const subCtx: ValidationContext = { ...ctx, schema: schema.not };
      if (this.validateValue(value, subCtx).length === 0) {
        errors.push(this.createError(ctx, 'not', 'Value must not match schema in not'));
      }
    }

    // Conditional
    if (schema.if) {
      const ifCtx: ValidationContext = { ...ctx, schema: schema.if };
      const ifValid = this.validateValue(value, ifCtx).length === 0;

      if (ifValid && schema.then) {
        const thenCtx: ValidationContext = { ...ctx, schema: schema.then };
        errors.push(...this.validateValue(value, thenCtx));
      } else if (!ifValid && schema.else) {
        const elseCtx: ValidationContext = { ...ctx, schema: schema.else };
        errors.push(...this.validateValue(value, elseCtx));
      }
    }

    return errors;
  }

  private validateType(value: unknown, type: JSONSchemaType | JSONSchemaType[], ctx: ValidationContext): ValidationError[] {
    const types = Array.isArray(type) ? type : [type];
    const actualType = this.getJSONType(value);

    for (const t of types) {
      if (t === actualType) return [];
      // integer is a subset of number
      if (t === 'integer' && actualType === 'number' && Number.isInteger(value)) {
        return [];
      }
    }

    return [this.createError(ctx, 'type', `Expected ${types.join(' or ')}, got ${actualType}`, value)];
  }

  private validateString(value: string, schema: JSONSchema, ctx: ValidationContext): ValidationError[] {
    const errors: ValidationError[] = [];

    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(this.createError(ctx, 'minLength', `String must be at least ${schema.minLength} characters`, value));
    }

    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(this.createError(ctx, 'maxLength', `String must be at most ${schema.maxLength} characters`, value));
    }

    if (schema.pattern !== undefined) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        errors.push(this.createError(ctx, 'pattern', `String must match pattern: ${schema.pattern}`, value));
      }
    }

    if (schema.format !== undefined) {
      const formatError = this.validateFormat(value, schema.format);
      if (formatError) {
        errors.push(this.createError(ctx, 'format', formatError, value));
      }
    }

    return errors;
  }

  private validateNumber(value: number, schema: JSONSchema, ctx: ValidationContext): ValidationError[] {
    const errors: ValidationError[] = [];

    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(this.createError(ctx, 'minimum', `Value must be >= ${schema.minimum}`, value));
    }

    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(this.createError(ctx, 'maximum', `Value must be <= ${schema.maximum}`, value));
    }

    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(this.createError(ctx, 'exclusiveMinimum', `Value must be > ${schema.exclusiveMinimum}`, value));
    }

    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      errors.push(this.createError(ctx, 'exclusiveMaximum', `Value must be < ${schema.exclusiveMaximum}`, value));
    }

    if (schema.multipleOf !== undefined && value % schema.multipleOf !== 0) {
      errors.push(this.createError(ctx, 'multipleOf', `Value must be a multiple of ${schema.multipleOf}`, value));
    }

    return errors;
  }

  private validateArray(value: unknown[], schema: JSONSchema, ctx: ValidationContext): ValidationError[] {
    const errors: ValidationError[] = [];

    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(this.createError(ctx, 'minItems', `Array must have at least ${schema.minItems} items`, value));
    }

    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(this.createError(ctx, 'maxItems', `Array must have at most ${schema.maxItems} items`, value));
    }

    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) {
      errors.push(this.createError(ctx, 'uniqueItems', 'Array items must be unique', value));
    }

    // Validate items
    if (schema.items) {
      if (Array.isArray(schema.items)) {
        // Tuple validation
        for (let i = 0; i < value.length; i++) {
          const itemSchema = schema.items[i] ?? (typeof schema.additionalItems === 'object' ? schema.additionalItems : undefined);
          if (itemSchema) {
            const itemCtx: ValidationContext = {
              ...ctx,
              path: [...ctx.path, String(i)],
              schema: itemSchema,
            };
            errors.push(...this.validateValue(value[i], itemCtx));
          } else if (schema.additionalItems === false && i >= schema.items.length) {
            errors.push(this.createError(ctx, 'additionalItems', `No additional items allowed at index ${i}`, value[i]));
          }
        }
      } else {
        // All items same schema
        for (let i = 0; i < value.length; i++) {
          const itemCtx: ValidationContext = {
            ...ctx,
            path: [...ctx.path, String(i)],
            schema: schema.items,
          };
          errors.push(...this.validateValue(value[i], itemCtx));
        }
      }
    }

    // Contains validation
    if (schema.contains) {
      const containsValid = value.some(item => {
        const itemCtx: ValidationContext = { ...ctx, schema: schema.contains! };
        return this.validateValue(item, itemCtx).length === 0;
      });
      if (!containsValid) {
        errors.push(this.createError(ctx, 'contains', 'Array must contain at least one matching item'));
      }
    }

    return errors;
  }

  private validateObject(value: Record<string, unknown>, schema: JSONSchema, ctx: ValidationContext): ValidationError[] {
    const errors: ValidationError[] = [];
    const keys = Object.keys(value);

    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      errors.push(this.createError(ctx, 'minProperties', `Object must have at least ${schema.minProperties} properties`));
    }

    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
      errors.push(this.createError(ctx, 'maxProperties', `Object must have at most ${schema.maxProperties} properties`));
    }

    // Required fields
    if (schema.required) {
      for (const required of schema.required) {
        if (!(required in value)) {
          errors.push(this.createError(ctx, 'required', `Missing required property: ${required}`));
        }
      }
    }

    // Validate properties
    const validatedKeys = new Set<string>();

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          validatedKeys.add(key);
          const propCtx: ValidationContext = {
            ...ctx,
            path: [...ctx.path, key],
            schema: propSchema,
          };
          errors.push(...this.validateValue(value[key], propCtx));
        }
      }
    }

    // Pattern properties
    if (schema.patternProperties) {
      for (const [pattern, patternSchema] of Object.entries(schema.patternProperties)) {
        const regex = new RegExp(pattern);
        for (const key of keys) {
          if (regex.test(key)) {
            validatedKeys.add(key);
            const propCtx: ValidationContext = {
              ...ctx,
              path: [...ctx.path, key],
              schema: patternSchema,
            };
            errors.push(...this.validateValue(value[key], propCtx));
          }
        }
      }
    }

    // Additional properties
    const additionalKeys = keys.filter(k => !validatedKeys.has(k));
    if (additionalKeys.length > 0) {
      if (schema.additionalProperties === false) {
        for (const key of additionalKeys) {
          errors.push(this.createError(ctx, 'additionalProperties', `Additional property not allowed: ${key}`));
        }
      } else if (typeof schema.additionalProperties === 'object') {
        for (const key of additionalKeys) {
          const propCtx: ValidationContext = {
            ...ctx,
            path: [...ctx.path, key],
            schema: schema.additionalProperties,
          };
          errors.push(...this.validateValue(value[key], propCtx));
        }
      }
    }

    // Property names
    if (schema.propertyNames) {
      for (const key of keys) {
        const nameCtx: ValidationContext = {
          ...ctx,
          schema: schema.propertyNames,
        };
        const nameErrors = this.validateValue(key, nameCtx);
        if (nameErrors.length > 0) {
          errors.push(this.createError(ctx, 'propertyNames', `Invalid property name: ${key}`));
        }
      }
    }

    return errors;
  }

  private validateFormat(value: string, format: string): string | null {
    const formats: Record<string, RegExp> = {
      'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
      date: /^\d{4}-\d{2}-\d{2}$/,
      time: /^\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      uri: /^[a-zA-Z][a-zA-Z0-9+.-]*:/,
      uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      ipv4: /^(\d{1,3}\.){3}\d{1,3}$/,
      ipv6: /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i,
    };

    const regex = formats[format];
    if (regex && !regex.test(value)) {
      return `Invalid ${format} format`;
    }

    return null;
  }

  private resolveRef(schema: JSONSchema): JSONSchema {
    if (!schema.$ref) return schema;

    const ref = schema.$ref;
    if (ref.startsWith('#/$defs/') || ref.startsWith('#/definitions/')) {
      const name = ref.split('/').pop();
      if (name && this.definitions[name]) {
        return this.resolveRef(this.definitions[name]);
      }
    }

    return schema;
  }

  private getJSONType(value: unknown): JSONSchemaType | 'undefined' {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'null';
  }

  private createError(ctx: ValidationContext, keyword: string, message: string, value?: unknown): ValidationError {
    return {
      path: ctx.path,
      message,
      keyword,
      schema: ctx.schema,
      value,
    };
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => this.deepEqual(v, b[i]));
    }
    if (typeof a === 'object' && typeof b === 'object') {
      const aKeys = Object.keys(a as object);
      const bKeys = Object.keys(b as object);
      if (aKeys.length !== bKeys.length) return false;
      return aKeys.every(k => this.deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
    }
    return false;
  }
}
