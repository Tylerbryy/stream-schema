import { describe, it, expect, beforeEach } from 'vitest';
import { StreamingJSONParser, createStreamParser, createLLMParser } from '../src/parser.js';
import { JSONSchema, ValidationError } from '../src/types.js';

describe('StreamingJSONParser', () => {
  describe('basic parsing', () => {
    it('should parse an empty object', () => {
      const parser = createStreamParser();
      const result = parser.feed('{}');
      expect(result.complete).toBe(true);
      expect(result.data).toEqual({});
    });

    it('should parse an empty array', () => {
      const parser = createStreamParser();
      const result = parser.feed('[]');
      expect(result.complete).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should parse simple object', () => {
      const parser = createStreamParser();
      const result = parser.feed('{"name": "John", "age": 30}');
      expect(result.complete).toBe(true);
      expect(result.data).toEqual({ name: 'John', age: 30 });
    });

    it('should parse nested objects', () => {
      const parser = createStreamParser();
      const result = parser.feed('{"user": {"name": "John", "address": {"city": "NYC"}}}');
      expect(result.complete).toBe(true);
      expect(result.data).toEqual({
        user: {
          name: 'John',
          address: { city: 'NYC' },
        },
      });
    });

    it('should parse arrays', () => {
      const parser = createStreamParser();
      const result = parser.feed('[1, 2, 3, 4, 5]');
      expect(result.complete).toBe(true);
      expect(result.data).toEqual([1, 2, 3, 4, 5]);
    });

    it('should parse arrays of objects', () => {
      const parser = createStreamParser();
      const result = parser.feed('[{"a": 1}, {"b": 2}]');
      expect(result.complete).toBe(true);
      expect(result.data).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('should parse all JSON types', () => {
      const parser = createStreamParser();
      const result = parser.feed('{"string": "hello", "number": 42, "float": 3.14, "bool": true, "nil": null}');
      expect(result.complete).toBe(true);
      expect(result.data).toEqual({
        string: 'hello',
        number: 42,
        float: 3.14,
        bool: true,
        nil: null,
      });
    });
  });

  describe('streaming parsing', () => {
    it('should handle chunked input', () => {
      const parser = createStreamParser();

      let result = parser.feed('{"na');
      expect(result.complete).toBe(false);

      result = parser.feed('me": "Jo');
      expect(result.complete).toBe(false);

      result = parser.feed('hn"}');
      expect(result.complete).toBe(true);
      expect(result.data).toEqual({ name: 'John' });
    });

    it('should track completed fields', () => {
      const parser = createStreamParser();

      parser.feed('{"name": "John",');
      const result = parser.feed(' "age": 30}');

      // The root object path is '', and fields are 'name' and 'age'
      expect(result.completedFields.some(f => f.includes('name'))).toBe(true);
      expect(result.completedFields.some(f => f.includes('age'))).toBe(true);
    });

    it('should track pending fields', () => {
      const parser = createStreamParser();
      const result = parser.feed('{"name": "Jo');

      expect(result.complete).toBe(false);
      expect(result.pendingFields.length).toBeGreaterThan(0);
    });

    it('should emit events on field completion', () => {
      const completedFields: Array<{ field: string; value: unknown }> = [];
      const parser = createStreamParser(undefined, {
        events: {
          onCompleteField: (field, value) => {
            completedFields.push({ field, value });
          },
        },
      });

      parser.feed('{"name": "John", "age": 30}');

      expect(completedFields).toHaveLength(2);
      expect(completedFields[0]).toEqual({ field: 'name', value: 'John' });
      expect(completedFields[1]).toEqual({ field: 'age', value: 30 });
    });

    it('should return partial data during streaming', () => {
      const parser = createStreamParser();

      let result = parser.feed('{"name": "John"');
      expect(result.data).toEqual({ name: 'John' });
      expect(result.complete).toBe(false);

      result = parser.feed(', "age": 30}');
      expect(result.data).toEqual({ name: 'John', age: 30 });
      expect(result.complete).toBe(true);
    });
  });

  describe('schema validation', () => {
    it('should validate against schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      } as const satisfies JSONSchema;

      const parser = createStreamParser(schema);
      const result = parser.feed('{"name": "John", "age": 30}');

      expect(result.complete).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect type errors', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      } as const satisfies JSONSchema;

      const errors: ValidationError[] = [];
      const parser = createStreamParser(schema, {
        events: {
          onValidationError: (error) => errors.push(error),
        },
      });

      parser.feed('{"name": "John", "age": "thirty"}');

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.keyword === 'type')).toBe(true);
    });

    it('should validate required fields', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      } as const satisfies JSONSchema;

      const parser = createStreamParser(schema);
      const result = parser.feed('{"name": "John"}');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.keyword === 'required')).toBe(true);
    });

    it('should validate string constraints', () => {
      const schema = {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          code: { type: 'string', minLength: 5, maxLength: 10 },
        },
      } as const satisfies JSONSchema;

      const parser = createStreamParser(schema);
      const result = parser.feed('{"email": "invalid", "code": "abc"}');

      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate number constraints', () => {
      const schema = {
        type: 'object',
        properties: {
          age: { type: 'number', minimum: 0, maximum: 120 },
        },
      } as const satisfies JSONSchema;

      const parser = createStreamParser(schema);
      const result = parser.feed('{"age": -5}');

      expect(result.errors.some(e => e.keyword === 'minimum')).toBe(true);
    });

    it('should validate array items', () => {
      const schema = {
        type: 'array',
        items: { type: 'number' },
      } as const satisfies JSONSchema;

      const parser = createStreamParser(schema);
      const result = parser.feed('[1, 2, "three"]');

      expect(result.errors.some(e => e.keyword === 'type')).toBe(true);
    });

    it('should validate enum values', () => {
      const schema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      } as const satisfies JSONSchema;

      const parser = createStreamParser(schema);
      const result = parser.feed('{"status": "invalid"}');

      expect(result.errors.some(e => e.keyword === 'enum')).toBe(true);
    });
  });

  describe('LLM mode', () => {
    it('should handle trailing commas', () => {
      const parser = createLLMParser();
      const result = parser.feed('{"name": "John", "age": 30,}');

      expect(result.complete).toBe(true);
      expect(result.data).toEqual({ name: 'John', age: 30 });
    });

    it('should handle unquoted keys', () => {
      const parser = createLLMParser();
      const result = parser.feed('{name: "John"}');

      expect(result.complete).toBe(true);
      expect(result.data).toEqual({ name: 'John' });
    });

    it('should handle single quotes', () => {
      const parser = createLLMParser();
      const result = parser.feed("{'name': 'John'}");

      expect(result.complete).toBe(true);
      expect(result.data).toEqual({ name: 'John' });
    });

    it('should recover from missing commas', () => {
      const parser = createLLMParser();
      const result = parser.feed('{"name": "John" "age": 30}');

      // In LLM mode, should attempt recovery
      expect(result.data).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle unicode strings', () => {
      const parser = createStreamParser();
      const result = parser.feed('{"emoji": "👋🌍", "chinese": "你好"}');

      expect(result.complete).toBe(true);
      expect(result.data).toEqual({ emoji: '👋🌍', chinese: '你好' });
    });

    it('should handle escaped characters', () => {
      const parser = createStreamParser();
      const result = parser.feed('{"text": "line1\\nline2\\ttab"}');

      expect(result.complete).toBe(true);
      expect((result.data as { text: string }).text).toBe('line1\nline2\ttab');
    });

    it('should handle empty strings', () => {
      const parser = createStreamParser();
      const result = parser.feed('{"empty": ""}');

      expect(result.complete).toBe(true);
      expect(result.data).toEqual({ empty: '' });
    });

    it('should handle deeply nested structures', () => {
      const parser = createStreamParser();
      const result = parser.feed('{"a": {"b": {"c": {"d": {"e": 1}}}}}');

      expect(result.complete).toBe(true);
      expect(result.depth).toBe(0);
    });

    it('should enforce max depth', () => {
      const parser = createStreamParser(undefined, { maxDepth: 2 });

      expect(() => {
        parser.feed('{"a": {"b": {"c": 1}}}');
      }).toThrow();
    });

    it('should handle very long strings', () => {
      const parser = createStreamParser();
      const longString = 'a'.repeat(10000);
      const result = parser.feed(`{"long": "${longString}"}`);

      expect(result.complete).toBe(true);
      expect((result.data as { long: string }).long).toHaveLength(10000);
    });
  });

  describe('error handling', () => {
    it('should throw on invalid JSON in strict mode', () => {
      const parser = createStreamParser();

      expect(() => {
        parser.feed('{invalid}');
      }).toThrow();
    });

    it('should not throw in LLM mode', () => {
      const parser = createLLMParser();

      expect(() => {
        parser.feed('{invalid');
      }).not.toThrow();
    });

    it('should track bytes processed', () => {
      const parser = createStreamParser();
      const input = '{"name": "John"}';
      const result = parser.feed(input);

      expect(result.bytesProcessed).toBe(input.length);
    });
  });

  describe('getResult', () => {
    it('should return typed result when complete', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      } as const satisfies JSONSchema;

      const parser = createStreamParser(schema);
      parser.feed('{"name": "John"}');

      const result = parser.getResult();
      expect(result).toEqual({ name: 'John' });
    });

    it('should throw when not complete', () => {
      const parser = createStreamParser();
      parser.feed('{"name":');

      expect(() => parser.getResult()).toThrow('Parsing is not complete');
    });
  });

  describe('reset', () => {
    it('should reset parser state', () => {
      const parser = createStreamParser();

      parser.feed('{"name": "John"}');
      expect(parser.isComplete()).toBe(true);

      parser.reset();
      expect(parser.isComplete()).toBe(false);

      const result = parser.feed('{"age": 30}');
      expect(result.complete).toBe(true);
      expect(result.data).toEqual({ age: 30 });
    });
  });
});
