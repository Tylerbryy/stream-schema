/**
 * JSON Schema Draft-07 type definitions
 */
export interface JSONSchema {
  // Core vocabulary
  $id?: string;
  $ref?: string;
  $schema?: string;
  $comment?: string;
  $defs?: Record<string, JSONSchema>;
  definitions?: Record<string, JSONSchema>;

  // Type keywords
  type?: JSONSchemaType | JSONSchemaType[];
  enum?: unknown[];
  const?: unknown;

  // Numeric validation
  multipleOf?: number;
  maximum?: number;
  exclusiveMaximum?: number;
  minimum?: number;
  exclusiveMinimum?: number;

  // String validation
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  format?: string;

  // Array validation
  items?: JSONSchema | JSONSchema[];
  additionalItems?: JSONSchema | boolean;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  contains?: JSONSchema;

  // Object validation
  maxProperties?: number;
  minProperties?: number;
  required?: string[];
  properties?: Record<string, JSONSchema>;
  patternProperties?: Record<string, JSONSchema>;
  additionalProperties?: JSONSchema | boolean;
  propertyNames?: JSONSchema;

  // Conditional
  if?: JSONSchema;
  then?: JSONSchema;
  else?: JSONSchema;

  // Combining schemas
  allOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  not?: JSONSchema;

  // Meta
  title?: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];

  // Format annotations
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
}

export type JSONSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

/**
 * Type inference from JSON Schema
 * This provides basic type inference for common schema patterns
 */
export type InferSchemaType<T extends JSONSchema> = T extends { const: infer C }
  ? C
  : T extends { enum: (infer E)[] }
    ? E
    : T extends { type: 'string' }
      ? string
      : T extends { type: 'number' }
        ? number
        : T extends { type: 'integer' }
          ? number
          : T extends { type: 'boolean' }
            ? boolean
            : T extends { type: 'null' }
              ? null
              : T extends { type: 'array'; items: infer I }
                ? I extends JSONSchema ? InferSchemaType<I>[] : unknown[]
                : T extends { type: 'array' }
                  ? unknown[]
                  : T extends { type: 'object'; properties: infer P }
                    ? P extends Record<string, JSONSchema>
                      ? InferObjectType<P, T extends { required: (infer R)[] } ? R & string : never>
                      : Record<string, unknown>
                    : T extends { type: 'object' }
                      ? Record<string, unknown>
                      : unknown;

type InferObjectType<
  P extends Record<string, JSONSchema>,
  R extends string
> = {
  [K in keyof P as K extends R ? K : never]: InferSchemaType<P[K]>;
} & {
  [K in keyof P as K extends R ? never : K]?: InferSchemaType<P[K]>;
};

/**
 * Token types for the streaming tokenizer
 */
export enum TokenType {
  ObjectStart = 'OBJECT_START',
  ObjectEnd = 'OBJECT_END',
  ArrayStart = 'ARRAY_START',
  ArrayEnd = 'ARRAY_END',
  String = 'STRING',
  Number = 'NUMBER',
  Boolean = 'BOOLEAN',
  Null = 'NULL',
  Colon = 'COLON',
  Comma = 'COMMA',
  Key = 'KEY',
  PartialString = 'PARTIAL_STRING',
  PartialNumber = 'PARTIAL_NUMBER',
  PartialKey = 'PARTIAL_KEY',
  Error = 'ERROR',
}

export interface Token {
  type: TokenType;
  value: unknown;
  raw: string;
  position: number;
  isPartial: boolean;
}

/**
 * Parser state tracking
 */
export enum ParserState {
  Initial = 'INITIAL',
  InObject = 'IN_OBJECT',
  InArray = 'IN_ARRAY',
  ExpectingKey = 'EXPECTING_KEY',
  ExpectingColon = 'EXPECTING_COLON',
  ExpectingValue = 'EXPECTING_VALUE',
  ExpectingCommaOrEnd = 'EXPECTING_COMMA_OR_END',
  Complete = 'COMPLETE',
  Error = 'ERROR',
}

export interface StackFrame {
  type: 'object' | 'array';
  data: Record<string, unknown> | unknown[];
  currentKey?: string;
  schema?: JSONSchema;
  completedKeys: Set<string>;
  arrayIndex: number;
}

/**
 * Validation result types
 */
export interface ValidationError {
  path: string[];
  message: string;
  keyword: string;
  schema: JSONSchema;
  value?: unknown;
}

export interface ParseResult<T = unknown> {
  /** Whether parsing is complete */
  complete: boolean;
  /** Whether the current state is valid (even if partial) */
  valid: boolean;
  /** Current partial or complete data */
  data: Partial<T> | T;
  /** Fields that have been fully parsed */
  completedFields: string[];
  /** Fields currently being parsed */
  pendingFields: string[];
  /** Validation errors encountered */
  errors: ValidationError[];
  /** Current parsing depth */
  depth: number;
  /** Number of bytes processed */
  bytesProcessed: number;
}

/**
 * Event types for the parser
 */
export interface ParserEvents<T = unknown> {
  onPartialObject?: (data: Partial<T>, path: string[]) => void;
  onCompleteField?: (field: string, value: unknown, path: string[]) => void;
  onValidationError?: (error: ValidationError) => void;
  onComplete?: (data: T) => void;
  onError?: (error: Error) => void;
}

/**
 * Parser options
 */
export interface ParserOptions<T extends JSONSchema = JSONSchema> {
  schema?: T;
  /** Enable LLM error recovery mode */
  llmMode?: boolean;
  /** Allow trailing commas */
  allowTrailingCommas?: boolean;
  /** Allow unquoted keys */
  allowUnquotedKeys?: boolean;
  /** Allow single quotes for strings */
  allowSingleQuotes?: boolean;
  /** Max nesting depth (default: 100) */
  maxDepth?: number;
  /** Event callbacks */
  events?: ParserEvents<InferSchemaType<T>>;
}

/**
 * Stream parser interface
 */
export interface StreamParser<T = unknown> {
  /** Feed a chunk of data to the parser */
  feed(chunk: string): ParseResult<T>;
  /** Reset the parser state */
  reset(): void;
  /** Get current state */
  getState(): ParserState;
  /** Check if parsing is complete */
  isComplete(): boolean;
  /** Get the final result (throws if incomplete) */
  getResult(): T;
}
