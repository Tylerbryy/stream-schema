# stream-schema

Streaming JSON parser with incremental schema validation. Perfect for parsing LLM outputs token by token.

**[Live Demo](https://v0-llm-output-parser.vercel.app/)**

## The Problem

When working with LLM outputs, you often receive JSON token by token:

```
{"na
me": "Jo
hn", "age": 3
0}
```

Current solutions require you to either:
- Wait for the complete JSON before parsing (bad UX - no incremental updates)
- Use regex hacks (fragile and error-prone)

## The Solution

`stream-schema` parses JSON incrementally as it streams, validates against a JSON Schema, and emits partial results you can use to update your UI in real-time.

## Installation

```bash
# Recommended
bun add stream-schema

# Or with pnpm
pnpm add stream-schema

# Or with npm
npm install stream-schema
```

## Quick Start

```typescript
import { createStreamParser } from 'stream-schema';

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
  },
  required: ['name'],
} as const;

const parser = createStreamParser(schema);

// Simulate streaming chunks from an LLM
for await (const chunk of llmStream) {
  const result = parser.feed(chunk);

  if (result.partial) {
    // Update UI with partial data
    renderPartialUI(result.data);
  }

  if (result.complete) {
    // Final result is fully typed!
    return result.data;
  }
}
```

## Features

- **Incremental Parsing**: Parse JSON as it streams without waiting for completion
- **Schema Validation**: Validate against JSON Schema draft-07 incrementally
- **TypeScript Support**: Full type inference from your schema
- **LLM Error Recovery**: Handle common LLM mistakes (trailing commas, unquoted keys)
- **Event Callbacks**: React to field completions and validation errors in real-time
- **Memory Efficient**: Stream large JSON without memory blowup

## API

### `createStreamParser(schema?, options?)`

Create a new streaming JSON parser.

```typescript
import { createStreamParser, JSONSchema } from 'stream-schema';

const schema: JSONSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    items: {
      type: 'array',
      items: { type: 'number' }
    }
  }
};

const parser = createStreamParser(schema, {
  events: {
    onPartialObject: (data, path) => {
      console.log('Partial update:', data);
    },
    onCompleteField: (field, value, path) => {
      console.log(`Field ${field} completed:`, value);
    },
    onValidationError: (error) => {
      console.log('Validation error:', error);
    },
    onComplete: (data) => {
      console.log('Parsing complete:', data);
    },
    onError: (error) => {
      console.error('Parse error:', error);
    }
  }
});
```

### `createLLMParser(schema?, options?)`

Create a parser optimized for LLM output with automatic error recovery.

```typescript
import { createLLMParser } from 'stream-schema';

const parser = createLLMParser(schema);

// Handles common LLM mistakes:
parser.feed('{"name": "John",}');           // Trailing comma
parser.feed('{name: "John"}');              // Unquoted keys
parser.feed("{'name': 'John'}");            // Single quotes
```

### `parser.feed(chunk)`

Feed a chunk of JSON data to the parser. Returns a `ParseResult`:

```typescript
interface ParseResult<T> {
  complete: boolean;           // Is parsing complete?
  valid: boolean;              // Is current state valid?
  data: Partial<T> | T;        // Current partial or complete data
  completedFields: string[];   // Fields fully parsed
  pendingFields: string[];     // Fields being parsed
  errors: ValidationError[];   // Validation errors
  depth: number;               // Current nesting depth
  bytesProcessed: number;      // Total bytes processed
}
```

### `parser.getResult()`

Get the final parsed result. Throws if parsing is incomplete.

```typescript
parser.feed('{"name": "John"}');
const result = parser.getResult(); // { name: "John" }
```

### `parser.reset()`

Reset the parser state for reuse.

```typescript
parser.reset();
parser.feed('{"age": 30}');
```

### `parser.isComplete()`

Check if parsing is complete.

### `parser.getState()`

Get the current parser state (for debugging).

## Options

```typescript
interface ParserOptions {
  schema?: JSONSchema;           // JSON Schema for validation
  llmMode?: boolean;             // Enable LLM error recovery
  allowTrailingCommas?: boolean; // Allow trailing commas
  allowUnquotedKeys?: boolean;   // Allow unquoted object keys
  allowSingleQuotes?: boolean;   // Allow single-quoted strings
  maxDepth?: number;             // Max nesting depth (default: 100)
  events?: ParserEvents;         // Event callbacks
}
```

## Type Inference

`stream-schema` infers TypeScript types from your schema:

```typescript
const schema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
    tags: { type: 'array', items: { type: 'string' } }
  },
  required: ['name']
} as const;

const parser = createStreamParser(schema);
const result = parser.getResult();
// result is typed as: { name: string; age?: number; tags?: string[] }
```

## Advanced Usage

### Manual Tokenization

For fine-grained control, use the tokenizer directly:

```typescript
import { StreamingTokenizer, TokenType } from 'stream-schema';

const tokenizer = new StreamingTokenizer();
const tokens = tokenizer.feed('{"name": "John"}');

for (const token of tokens) {
  console.log(token.type, token.value);
}

// Get partial tokens (incomplete strings, numbers)
const partial = tokenizer.getPartialToken();
```

### Schema Validation Only

Use the validator standalone:

```typescript
import { SchemaValidator } from 'stream-schema';

const validator = new SchemaValidator({
  type: 'object',
  properties: {
    email: { type: 'string', format: 'email' }
  }
});

const errors = validator.validate({ email: 'invalid' });
// [{ path: ['email'], message: 'Invalid email format', ... }]
```

## Supported JSON Schema Features

- Basic types: `string`, `number`, `integer`, `boolean`, `null`, `array`, `object`
- `enum` and `const`
- String validation: `minLength`, `maxLength`, `pattern`, `format`
- Number validation: `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`
- Array validation: `items`, `minItems`, `maxItems`, `uniqueItems`, `contains`
- Object validation: `properties`, `required`, `additionalProperties`, `patternProperties`, `minProperties`, `maxProperties`
- Combining schemas: `allOf`, `anyOf`, `oneOf`, `not`
- Conditional: `if`/`then`/`else`
- References: `$ref`, `$defs`, `definitions`
- Formats: `email`, `date`, `date-time`, `time`, `uri`, `uuid`, `ipv4`, `ipv6`

## Performance

Benchmarks show that `stream-schema`:
- Provides first partial result almost immediately
- Handles 10MB+ JSON files with reasonable memory usage
- Is suitable for real-time streaming scenarios

## Author

**Tyler Gibbs**

## License

MIT
