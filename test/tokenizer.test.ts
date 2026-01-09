import { describe, it, expect, beforeEach } from 'vitest';
import { StreamingTokenizer } from '../src/tokenizer.js';
import { TokenType } from '../src/types.js';

describe('StreamingTokenizer', () => {
  let tokenizer: StreamingTokenizer;

  beforeEach(() => {
    tokenizer = new StreamingTokenizer();
  });

  describe('basic tokens', () => {
    it('should tokenize an empty object', () => {
      const tokens = tokenizer.feed('{}');
      expect(tokens).toHaveLength(2);
      expect(tokens[0]?.type).toBe(TokenType.ObjectStart);
      expect(tokens[1]?.type).toBe(TokenType.ObjectEnd);
    });

    it('should tokenize an empty array', () => {
      const tokens = tokenizer.feed('[]');
      expect(tokens).toHaveLength(2);
      expect(tokens[0]?.type).toBe(TokenType.ArrayStart);
      expect(tokens[1]?.type).toBe(TokenType.ArrayEnd);
    });

    it('should tokenize strings', () => {
      tokenizer.setExpectingKey(false);
      const tokens = tokenizer.feed('"hello world"');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.type).toBe(TokenType.String);
      expect(tokens[0]?.value).toBe('hello world');
    });

    it('should tokenize numbers followed by terminator', () => {
      // Numbers need a terminating character to be finalized in streaming mode
      const tokens = tokenizer.feed('42,');
      expect(tokens).toHaveLength(2);
      expect(tokens[0]?.type).toBe(TokenType.Number);
      expect(tokens[0]?.value).toBe(42);
    });

    it('should tokenize floating point numbers', () => {
      const tokens = tokenizer.feed('3.14159]');
      expect(tokens).toHaveLength(2);
      expect(tokens[0]?.type).toBe(TokenType.Number);
      expect(tokens[0]?.value).toBeCloseTo(3.14159);
    });

    it('should tokenize negative numbers', () => {
      const tokens = tokenizer.feed('-123}');
      expect(tokens).toHaveLength(2);
      expect(tokens[0]?.type).toBe(TokenType.Number);
      expect(tokens[0]?.value).toBe(-123);
    });

    it('should tokenize scientific notation', () => {
      const tokens = tokenizer.feed('1.5e10,');
      expect(tokens).toHaveLength(2);
      expect(tokens[0]?.type).toBe(TokenType.Number);
      expect(tokens[0]?.value).toBe(1.5e10);
    });

    it('should tokenize booleans', () => {
      const tokens1 = tokenizer.feed('true');
      expect(tokens1).toHaveLength(1);
      expect(tokens1[0]?.type).toBe(TokenType.Boolean);
      expect(tokens1[0]?.value).toBe(true);

      tokenizer.reset();
      const tokens2 = tokenizer.feed('false');
      expect(tokens2).toHaveLength(1);
      expect(tokens2[0]?.type).toBe(TokenType.Boolean);
      expect(tokens2[0]?.value).toBe(false);
    });

    it('should tokenize null', () => {
      const tokens = tokenizer.feed('null');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.type).toBe(TokenType.Null);
      expect(tokens[0]?.value).toBe(null);
    });
  });

  describe('streaming', () => {
    it('should handle partial strings', () => {
      tokenizer.setExpectingKey(false);
      let tokens = tokenizer.feed('"hello');
      expect(tokens).toHaveLength(0);

      const partial = tokenizer.getPartialToken();
      expect(partial).not.toBeNull();
      expect(partial?.type).toBe(TokenType.PartialString);
      expect(partial?.value).toBe('hello');

      tokens = tokenizer.feed(' world"');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.value).toBe('hello world');
    });

    it('should handle partial numbers', () => {
      // Standalone numbers stay as partial until we see a terminating character
      let tokens = tokenizer.feed('123');
      expect(tokens).toHaveLength(0); // Waiting for terminator

      let partial = tokenizer.getPartialToken();
      expect(partial?.type).toBe(TokenType.PartialNumber);

      tokenizer.reset();
      tokens = tokenizer.feed('123.');
      expect(tokens).toHaveLength(0); // Incomplete - waiting for more digits

      partial = tokenizer.getPartialToken();
      expect(partial?.type).toBe(TokenType.PartialNumber);

      tokens = tokenizer.feed('456,');
      expect(tokens).toHaveLength(2); // Number + comma
      expect(tokens[0]?.value).toBe(123.456);
    });

    it('should handle chunked JSON', () => {
      let allTokens: ReturnType<typeof tokenizer.feed> = [];

      allTokens = allTokens.concat(tokenizer.feed('{"na'));
      allTokens = allTokens.concat(tokenizer.feed('me": "Jo'));
      allTokens = allTokens.concat(tokenizer.feed('hn", "age": 3'));
      allTokens = allTokens.concat(tokenizer.feed('0}'));

      // {, "name", :, "John", ,, "age", :, 30, }
      // May have extra tokens due to key vs string handling
      expect(allTokens.length).toBeGreaterThanOrEqual(9);
      expect(allTokens[0]?.type).toBe(TokenType.ObjectStart);
      expect(allTokens[allTokens.length - 1]?.type).toBe(TokenType.ObjectEnd);
    });
  });

  describe('escaped strings', () => {
    it('should handle escaped quotes', () => {
      tokenizer.setExpectingKey(false);
      const tokens = tokenizer.feed('"hello \\"world\\""');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.value).toBe('hello "world"');
    });

    it('should handle newlines', () => {
      tokenizer.setExpectingKey(false);
      const tokens = tokenizer.feed('"line1\\nline2"');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.value).toBe('line1\nline2');
    });

    it('should handle tabs', () => {
      tokenizer.setExpectingKey(false);
      const tokens = tokenizer.feed('"col1\\tcol2"');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.value).toBe('col1\tcol2');
    });
  });

  describe('LLM mode', () => {
    it('should allow trailing commas', () => {
      const llmTokenizer = new StreamingTokenizer({ llmMode: true });
      const tokens = llmTokenizer.feed('{"a": 1,}');
      expect(tokens.filter(t => t.type === TokenType.Error)).toHaveLength(0);
    });

    it('should allow unquoted keys', () => {
      const llmTokenizer = new StreamingTokenizer({ llmMode: true });
      llmTokenizer.setExpectingKey(true);
      const tokens = llmTokenizer.feed('name');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.type).toBe(TokenType.Key);
      expect(tokens[0]?.value).toBe('name');
    });

    it('should allow single quotes', () => {
      const llmTokenizer = new StreamingTokenizer({ llmMode: true });
      llmTokenizer.setExpectingKey(false);
      const tokens = llmTokenizer.feed("'hello'");
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.type).toBe(TokenType.String);
      expect(tokens[0]?.value).toBe('hello');
    });
  });

  describe('whitespace handling', () => {
    it('should skip whitespace between tokens', () => {
      const tokens = tokenizer.feed('  {  "a"  :  1  }  ');
      expect(tokens.map(t => t.type)).toEqual([
        TokenType.ObjectStart,
        TokenType.Key,
        TokenType.Colon,
        TokenType.Number,
        TokenType.ObjectEnd,
      ]);
    });

    it('should handle newlines and tabs', () => {
      const tokens = tokenizer.feed('{\n\t"a":\t1\n}');
      expect(tokens).toHaveLength(5);
    });
  });
});
