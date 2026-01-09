import { describe, it, expect } from 'vitest';
import { SchemaValidator } from '../src/validator.js';
import { JSONSchema } from '../src/types.js';

describe('SchemaValidator', () => {
  describe('type validation', () => {
    it('should validate string type', () => {
      const schema: JSONSchema = { type: 'string' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate('hello')).toHaveLength(0);
      expect(validator.validate(123).length).toBeGreaterThan(0);
    });

    it('should validate number type', () => {
      const schema: JSONSchema = { type: 'number' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(42)).toHaveLength(0);
      expect(validator.validate(3.14)).toHaveLength(0);
      expect(validator.validate('42').length).toBeGreaterThan(0);
    });

    it('should validate integer type', () => {
      const schema: JSONSchema = { type: 'integer' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(42)).toHaveLength(0);
      expect(validator.validate(3.14).length).toBeGreaterThan(0);
    });

    it('should validate boolean type', () => {
      const schema: JSONSchema = { type: 'boolean' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(true)).toHaveLength(0);
      expect(validator.validate(false)).toHaveLength(0);
      expect(validator.validate('true').length).toBeGreaterThan(0);
    });

    it('should validate null type', () => {
      const schema: JSONSchema = { type: 'null' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(null)).toHaveLength(0);
      // undefined is not a JSON type, but our validator recognizes it as different from null
      expect(validator.validate(undefined).some(e => e.keyword === 'type')).toBe(true);
    });

    it('should validate array type', () => {
      const schema: JSONSchema = { type: 'array' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate([])).toHaveLength(0);
      expect(validator.validate([1, 2, 3])).toHaveLength(0);
      expect(validator.validate({}).length).toBeGreaterThan(0);
    });

    it('should validate object type', () => {
      const schema: JSONSchema = { type: 'object' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate({})).toHaveLength(0);
      expect(validator.validate({ a: 1 })).toHaveLength(0);
      expect(validator.validate([]).length).toBeGreaterThan(0);
    });

    it('should validate union types', () => {
      const schema: JSONSchema = { type: ['string', 'number'] };
      const validator = new SchemaValidator(schema);

      expect(validator.validate('hello')).toHaveLength(0);
      expect(validator.validate(42)).toHaveLength(0);
      expect(validator.validate(true).length).toBeGreaterThan(0);
    });
  });

  describe('string validation', () => {
    it('should validate minLength', () => {
      const schema: JSONSchema = { type: 'string', minLength: 5 };
      const validator = new SchemaValidator(schema);

      expect(validator.validate('hello')).toHaveLength(0);
      expect(validator.validate('hi').length).toBeGreaterThan(0);
    });

    it('should validate maxLength', () => {
      const schema: JSONSchema = { type: 'string', maxLength: 5 };
      const validator = new SchemaValidator(schema);

      expect(validator.validate('hello')).toHaveLength(0);
      expect(validator.validate('hello world').length).toBeGreaterThan(0);
    });

    it('should validate pattern', () => {
      const schema: JSONSchema = { type: 'string', pattern: '^[a-z]+$' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate('hello')).toHaveLength(0);
      expect(validator.validate('Hello').length).toBeGreaterThan(0);
    });

    it('should validate email format', () => {
      const schema: JSONSchema = { type: 'string', format: 'email' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate('test@example.com')).toHaveLength(0);
      expect(validator.validate('invalid').length).toBeGreaterThan(0);
    });

    it('should validate date format', () => {
      const schema: JSONSchema = { type: 'string', format: 'date' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate('2024-01-15')).toHaveLength(0);
      expect(validator.validate('not a date').length).toBeGreaterThan(0);
    });

    it('should validate uuid format', () => {
      const schema: JSONSchema = { type: 'string', format: 'uuid' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate('550e8400-e29b-41d4-a716-446655440000')).toHaveLength(0);
      expect(validator.validate('not-a-uuid').length).toBeGreaterThan(0);
    });
  });

  describe('number validation', () => {
    it('should validate minimum', () => {
      const schema: JSONSchema = { type: 'number', minimum: 0 };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(0)).toHaveLength(0);
      expect(validator.validate(10)).toHaveLength(0);
      expect(validator.validate(-1).length).toBeGreaterThan(0);
    });

    it('should validate maximum', () => {
      const schema: JSONSchema = { type: 'number', maximum: 100 };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(100)).toHaveLength(0);
      expect(validator.validate(50)).toHaveLength(0);
      expect(validator.validate(101).length).toBeGreaterThan(0);
    });

    it('should validate exclusiveMinimum', () => {
      const schema: JSONSchema = { type: 'number', exclusiveMinimum: 0 };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(1)).toHaveLength(0);
      expect(validator.validate(0).length).toBeGreaterThan(0);
    });

    it('should validate exclusiveMaximum', () => {
      const schema: JSONSchema = { type: 'number', exclusiveMaximum: 100 };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(99)).toHaveLength(0);
      expect(validator.validate(100).length).toBeGreaterThan(0);
    });

    it('should validate multipleOf', () => {
      const schema: JSONSchema = { type: 'number', multipleOf: 5 };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(10)).toHaveLength(0);
      expect(validator.validate(25)).toHaveLength(0);
      expect(validator.validate(7).length).toBeGreaterThan(0);
    });
  });

  describe('array validation', () => {
    it('should validate minItems', () => {
      const schema: JSONSchema = { type: 'array', minItems: 2 };
      const validator = new SchemaValidator(schema);

      expect(validator.validate([1, 2])).toHaveLength(0);
      expect(validator.validate([1]).length).toBeGreaterThan(0);
    });

    it('should validate maxItems', () => {
      const schema: JSONSchema = { type: 'array', maxItems: 3 };
      const validator = new SchemaValidator(schema);

      expect(validator.validate([1, 2, 3])).toHaveLength(0);
      expect(validator.validate([1, 2, 3, 4]).length).toBeGreaterThan(0);
    });

    it('should validate uniqueItems', () => {
      const schema: JSONSchema = { type: 'array', uniqueItems: true };
      const validator = new SchemaValidator(schema);

      expect(validator.validate([1, 2, 3])).toHaveLength(0);
      expect(validator.validate([1, 1, 2]).length).toBeGreaterThan(0);
    });

    it('should validate items schema', () => {
      const schema: JSONSchema = { type: 'array', items: { type: 'number' } };
      const validator = new SchemaValidator(schema);

      expect(validator.validate([1, 2, 3])).toHaveLength(0);
      expect(validator.validate([1, 'two', 3]).length).toBeGreaterThan(0);
    });

    it('should validate tuple schema', () => {
      const schema: JSONSchema = {
        type: 'array',
        items: [{ type: 'string' }, { type: 'number' }],
        additionalItems: false,
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(['hello', 42])).toHaveLength(0);
      expect(validator.validate(['hello', 42, 'extra']).length).toBeGreaterThan(0);
    });

    it('should validate contains', () => {
      const schema: JSONSchema = {
        type: 'array',
        contains: { type: 'number', minimum: 10 },
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate([1, 2, 15])).toHaveLength(0);
      expect(validator.validate([1, 2, 3]).length).toBeGreaterThan(0);
    });
  });

  describe('object validation', () => {
    it('should validate required properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        required: ['name', 'age'],
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate({ name: 'John', age: 30 })).toHaveLength(0);
      expect(validator.validate({ name: 'John' }).length).toBeGreaterThan(0);
    });

    it('should validate properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate({ name: 'John', age: 30 })).toHaveLength(0);
      expect(validator.validate({ name: 'John', age: 'thirty' }).length).toBeGreaterThan(0);
    });

    it('should validate additionalProperties: false', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate({ name: 'John' })).toHaveLength(0);
      expect(validator.validate({ name: 'John', extra: 'field' }).length).toBeGreaterThan(0);
    });

    it('should validate additionalProperties schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: { type: 'number' },
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate({ name: 'John', extra: 42 })).toHaveLength(0);
      expect(validator.validate({ name: 'John', extra: 'string' }).length).toBeGreaterThan(0);
    });

    it('should validate patternProperties', () => {
      const schema: JSONSchema = {
        type: 'object',
        patternProperties: {
          '^S_': { type: 'string' },
          '^N_': { type: 'number' },
        },
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate({ S_name: 'John', N_age: 30 })).toHaveLength(0);
      expect(validator.validate({ S_name: 123 }).length).toBeGreaterThan(0);
    });

    it('should validate minProperties', () => {
      const schema: JSONSchema = { type: 'object', minProperties: 2 };
      const validator = new SchemaValidator(schema);

      expect(validator.validate({ a: 1, b: 2 })).toHaveLength(0);
      expect(validator.validate({ a: 1 }).length).toBeGreaterThan(0);
    });

    it('should validate maxProperties', () => {
      const schema: JSONSchema = { type: 'object', maxProperties: 2 };
      const validator = new SchemaValidator(schema);

      expect(validator.validate({ a: 1, b: 2 })).toHaveLength(0);
      expect(validator.validate({ a: 1, b: 2, c: 3 }).length).toBeGreaterThan(0);
    });
  });

  describe('const and enum', () => {
    it('should validate const', () => {
      const schema: JSONSchema = { const: 'specific value' };
      const validator = new SchemaValidator(schema);

      expect(validator.validate('specific value')).toHaveLength(0);
      expect(validator.validate('other value').length).toBeGreaterThan(0);
    });

    it('should validate enum', () => {
      const schema: JSONSchema = { enum: ['red', 'green', 'blue'] };
      const validator = new SchemaValidator(schema);

      expect(validator.validate('red')).toHaveLength(0);
      expect(validator.validate('yellow').length).toBeGreaterThan(0);
    });
  });

  describe('combining schemas', () => {
    it('should validate allOf', () => {
      const schema: JSONSchema = {
        allOf: [
          { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          { type: 'object', properties: { age: { type: 'number' } }, required: ['age'] },
        ],
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate({ name: 'John', age: 30 })).toHaveLength(0);
      expect(validator.validate({ name: 'John' }).length).toBeGreaterThan(0);
    });

    it('should validate anyOf', () => {
      const schema: JSONSchema = {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
        ],
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate('hello')).toHaveLength(0);
      expect(validator.validate(42)).toHaveLength(0);
      expect(validator.validate(true).length).toBeGreaterThan(0);
    });

    it('should validate oneOf', () => {
      const schema: JSONSchema = {
        oneOf: [
          { type: 'number', multipleOf: 5 },
          { type: 'number', multipleOf: 3 },
        ],
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(10)).toHaveLength(0); // divisible by 5 only
      expect(validator.validate(9)).toHaveLength(0);  // divisible by 3 only
      expect(validator.validate(15).length).toBeGreaterThan(0); // divisible by both
    });

    it('should validate not', () => {
      const schema: JSONSchema = {
        not: { type: 'string' },
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate(42)).toHaveLength(0);
      expect(validator.validate('hello').length).toBeGreaterThan(0);
    });
  });

  describe('conditional', () => {
    it('should validate if/then/else', () => {
      const schema: JSONSchema = {
        type: 'object',
        if: {
          properties: { type: { const: 'business' } },
        },
        then: {
          required: ['taxId'],
        },
        else: {
          required: ['ssn'],
        },
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate({ type: 'business', taxId: '123' })).toHaveLength(0);
      expect(validator.validate({ type: 'personal', ssn: '456' })).toHaveLength(0);
      expect(validator.validate({ type: 'business' }).length).toBeGreaterThan(0);
    });
  });

  describe('$ref resolution', () => {
    it('should resolve $defs references', () => {
      const schema: JSONSchema = {
        $defs: {
          address: {
            type: 'object',
            properties: {
              city: { type: 'string' },
            },
            required: ['city'],
          },
        },
        type: 'object',
        properties: {
          home: { $ref: '#/$defs/address' },
        },
      };
      const validator = new SchemaValidator(schema);

      expect(validator.validate({ home: { city: 'NYC' } })).toHaveLength(0);
      expect(validator.validate({ home: {} }).length).toBeGreaterThan(0);
    });
  });

  describe('getSchemaAtPath', () => {
    it('should get schema at nested path', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1 },
            },
          },
        },
      };
      const validator = new SchemaValidator(schema);

      const nameSchema = validator.getSchemaAtPath(['user', 'name']);
      expect(nameSchema?.type).toBe('string');
      expect(nameSchema?.minLength).toBe(1);
    });

    it('should get schema for array items', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'number' },
          },
        },
      };
      const validator = new SchemaValidator(schema);

      const itemSchema = validator.getSchemaAtPath(['items', '0']);
      expect(itemSchema?.type).toBe('number');
    });
  });

  describe('canBeType', () => {
    it('should check if type is allowed', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };
      const validator = new SchemaValidator(schema);

      expect(validator.canBeType('string', ['name'])).toBe(true);
      expect(validator.canBeType('number', ['name'])).toBe(false);
    });
  });
});
