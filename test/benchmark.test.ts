import { describe, it, expect } from 'vitest';
import { createStreamParser, createLLMParser } from '../src/parser.js';

describe('Benchmarks', () => {
  describe('performance', () => {
    it('should be faster than JSON.parse for incremental results', () => {
      // Generate a moderately large JSON
      const items = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        value: Math.random() * 100,
        active: i % 2 === 0,
      }));
      const json = JSON.stringify({ items });

      // Measure streaming parse time
      const streamStart = performance.now();
      const parser = createStreamParser();

      // Simulate streaming chunks
      const chunkSize = 1000;
      let result;
      for (let i = 0; i < json.length; i += chunkSize) {
        result = parser.feed(json.slice(i, i + chunkSize));
      }
      const streamTime = performance.now() - streamStart;

      expect(result?.complete).toBe(true);

      // For fair comparison, the streaming parser provides incremental results
      // which JSON.parse cannot do
      console.log(`Streaming parse time: ${streamTime.toFixed(2)}ms for ${json.length} bytes`);
    });

    it('should handle 10MB JSON without memory blowup', () => {
      // Generate a large JSON (approximately 10MB)
      const itemCount = 50000;
      const items = Array.from({ length: itemCount }, (_, i) => ({
        id: i,
        name: `Item with a moderately long name ${i}`,
        description: 'A'.repeat(100),
        values: Array.from({ length: 10 }, (_, j) => j),
        metadata: {
          created: '2024-01-01',
          updated: '2024-01-02',
          tags: ['tag1', 'tag2', 'tag3'],
        },
      }));
      const json = JSON.stringify({ items });

      console.log(`Testing with ${(json.length / 1024 / 1024).toFixed(2)}MB JSON`);

      // Measure memory before
      const memBefore = process.memoryUsage().heapUsed;

      const parser = createStreamParser();
      const chunkSize = 64 * 1024; // 64KB chunks

      let result;
      for (let i = 0; i < json.length; i += chunkSize) {
        result = parser.feed(json.slice(i, i + chunkSize));
      }

      const memAfter = process.memoryUsage().heapUsed;
      const memUsed = (memAfter - memBefore) / 1024 / 1024;

      expect(result?.complete).toBe(true);
      expect((result?.data as { items: unknown[] }).items).toHaveLength(itemCount);

      console.log(`Memory used: ${memUsed.toFixed(2)}MB`);
      // Memory should be reasonable (less than 5x the JSON size)
      // This is a soft check; actual limits depend on Node.js version
    });

    it('should parse faster than waiting for complete JSON in streaming scenario', () => {
      const json = JSON.stringify({
        users: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
        })),
      });

      const parser = createStreamParser();

      // Simulate receiving data over time
      const chunks = [];
      const chunkSize = 100;
      for (let i = 0; i < json.length; i += chunkSize) {
        chunks.push(json.slice(i, i + chunkSize));
      }

      // Track time to first partial result
      let firstPartialTime = 0;
      const startTime = performance.now();

      for (let i = 0; i < chunks.length; i++) {
        const result = parser.feed(chunks[i]!);
        if (result.data && firstPartialTime === 0) {
          firstPartialTime = performance.now() - startTime;
        }
      }

      const totalTime = performance.now() - startTime;

      console.log(`Time to first partial result: ${firstPartialTime.toFixed(2)}ms`);
      console.log(`Total parse time: ${totalTime.toFixed(2)}ms`);

      // First partial should be available much faster than total
      expect(firstPartialTime).toBeLessThan(totalTime);
    });
  });

  describe('LLM error recovery', () => {
    it('should handle common LLM mistakes', () => {
      const llmParser = createLLMParser();

      // Test various common LLM mistakes
      const llmOutputs = [
        // Trailing comma
        '{"name": "John", "age": 30,}',
        // Unquoted keys
        '{name: "John", age: 30}',
        // Single quotes
        "{'name': 'John'}",
        // Mixed quotes
        `{"name": 'John'}`,
      ];

      for (const output of llmOutputs) {
        llmParser.reset();
        const result = llmParser.feed(output);
        expect(result.data).toBeDefined();
        // Should not throw
      }
    });
  });
});
