import { StreamingTokenizer } from './tokenizer.js';
import { SchemaValidator } from './validator.js';
import {
  JSONSchema,
  TokenType,
  Token,
  ParserState,
  StackFrame,
  ParseResult,
  ParserOptions,
  StreamParser,
  ValidationError,
  InferSchemaType,
} from './types.js';

export class StreamingJSONParser<T extends JSONSchema = JSONSchema> implements StreamParser<InferSchemaType<T>> {
  private tokenizer: StreamingTokenizer;
  private validator: SchemaValidator | null;
  private options: ParserOptions<T>;

  private state: ParserState;
  private stack: StackFrame[];
  private result: unknown;
  private errors: ValidationError[];
  private bytesProcessed: number;
  private completedPaths: Set<string>;
  private pendingPaths: Set<string>;

  constructor(options: ParserOptions<T> = {}) {
    this.options = {
      maxDepth: 100,
      llmMode: false,
      allowTrailingCommas: false,
      allowUnquotedKeys: false,
      allowSingleQuotes: false,
      ...options,
    };

    this.tokenizer = new StreamingTokenizer({
      llmMode: this.options.llmMode,
      allowTrailingCommas: this.options.allowTrailingCommas,
      allowUnquotedKeys: this.options.allowUnquotedKeys,
      allowSingleQuotes: this.options.allowSingleQuotes,
    });

    this.validator = this.options.schema ? new SchemaValidator(this.options.schema) : null;
    this.state = ParserState.Initial;
    this.stack = [];
    this.result = undefined;
    this.errors = [];
    this.bytesProcessed = 0;
    this.completedPaths = new Set();
    this.pendingPaths = new Set();
  }

  reset(): void {
    this.tokenizer.reset();
    this.state = ParserState.Initial;
    this.stack = [];
    this.result = undefined;
    this.errors = [];
    this.bytesProcessed = 0;
    this.completedPaths.clear();
    this.pendingPaths.clear();
  }

  getState(): ParserState {
    return this.state;
  }

  isComplete(): boolean {
    return this.state === ParserState.Complete;
  }

  getResult(): InferSchemaType<T> {
    if (!this.isComplete()) {
      throw new Error('Parsing is not complete');
    }
    return this.result as InferSchemaType<T>;
  }

  feed(chunk: string): ParseResult<InferSchemaType<T>> {
    this.bytesProcessed += chunk.length;

    // Update tokenizer's expectingKey state based on parser state
    this.tokenizer.setExpectingKey(
      this.state === ParserState.ExpectingKey ||
      (this.state === ParserState.Initial && this.stack.length === 0)
    );

    const tokens = this.tokenizer.feed(chunk);

    for (const token of tokens) {
      this.processToken(token);
    }

    // Handle partial tokens
    const partialToken = this.tokenizer.getPartialToken();
    if (partialToken) {
      this.handlePartialToken(partialToken);
    }

    return this.buildResult();
  }

  private processToken(token: Token): void {
    if (token.type === TokenType.Error) {
      this.handleError(token);
      return;
    }

    switch (this.state) {
      case ParserState.Initial:
        this.handleInitialState(token);
        break;

      case ParserState.InObject:
      case ParserState.ExpectingKey:
        this.handleObjectState(token);
        break;

      case ParserState.ExpectingColon:
        this.handleColonState(token);
        break;

      case ParserState.ExpectingValue:
        this.handleValueState(token);
        break;

      case ParserState.InArray:
        this.handleArrayState(token);
        break;

      case ParserState.ExpectingCommaOrEnd:
        this.handleCommaOrEndState(token);
        break;

      case ParserState.Complete:
        // Ignore tokens after completion
        break;

      case ParserState.Error:
        // In error state, try to recover in LLM mode
        if (this.options.llmMode) {
          this.tryRecover(token);
        }
        break;
    }
  }

  private handleInitialState(token: Token): void {
    switch (token.type) {
      case TokenType.ObjectStart:
        this.startObject();
        this.state = ParserState.ExpectingKey;
        break;

      case TokenType.ArrayStart:
        this.startArray();
        this.state = ParserState.InArray;
        break;

      case TokenType.String:
      case TokenType.Number:
      case TokenType.Boolean:
      case TokenType.Null:
        this.result = token.value;
        this.validateValue(this.result, []);
        this.state = ParserState.Complete;
        this.emitComplete();
        break;

      default:
        this.setError(`Unexpected token at start: ${token.type}`);
    }
  }

  private handleObjectState(token: Token): void {
    const frame = this.currentFrame();
    if (!frame || frame.type !== 'object') {
      this.setError('Invalid state: not in object');
      return;
    }

    switch (token.type) {
      case TokenType.Key:
      case TokenType.String:
        // Both Key and String tokens can be object keys
        // The tokenizer may return String when it doesn't know context
        frame.currentKey = token.value as string;
        this.pendingPaths.add(this.getCurrentPath().join('.'));
        this.state = ParserState.ExpectingColon;
        break;

      case TokenType.ObjectEnd:
        this.endObject();
        break;

      case TokenType.Comma:
        // After comma, expect next key
        this.state = ParserState.ExpectingKey;
        this.tokenizer.setExpectingKey(true);
        break;

      default:
        this.setError(`Expected key or }, got ${token.type}`);
    }
  }

  private handleColonState(token: Token): void {
    if (token.type === TokenType.Colon) {
      this.state = ParserState.ExpectingValue;
    } else if (this.options.llmMode) {
      // In LLM mode, try to be lenient
      this.state = ParserState.ExpectingValue;
      // Re-process this token as a value
      this.handleValueState(token);
    } else {
      this.setError(`Expected :, got ${token.type}`);
    }
  }

  private handleValueState(token: Token): void {
    const frame = this.currentFrame();

    switch (token.type) {
      case TokenType.ObjectStart:
        this.startObject();
        this.state = ParserState.ExpectingKey;
        break;

      case TokenType.ArrayStart:
        this.startArray();
        this.state = ParserState.InArray;
        break;

      case TokenType.String:
      case TokenType.Number:
      case TokenType.Boolean:
      case TokenType.Null:
        this.setValue(token.value);
        this.state = ParserState.ExpectingCommaOrEnd;
        break;

      case TokenType.ObjectEnd:
        // Handle empty value in LLM mode
        if (this.options.llmMode && frame) {
          if (frame.type === 'object') {
            this.endObject();
          }
        } else {
          this.setError(`Unexpected } when expecting value`);
        }
        break;

      case TokenType.ArrayEnd:
        // Handle empty value in LLM mode
        if (this.options.llmMode && frame) {
          if (frame.type === 'array') {
            this.endArray();
          }
        } else {
          this.setError(`Unexpected ] when expecting value`);
        }
        break;

      default:
        this.setError(`Unexpected token when expecting value: ${token.type}`);
    }
  }

  private handleArrayState(token: Token): void {
    const frame = this.currentFrame();
    if (!frame || frame.type !== 'array') {
      this.setError('Invalid state: not in array');
      return;
    }

    switch (token.type) {
      case TokenType.ObjectStart:
        this.startObject();
        this.state = ParserState.ExpectingKey;
        break;

      case TokenType.ArrayStart:
        this.startArray();
        this.state = ParserState.InArray;
        break;

      case TokenType.ArrayEnd:
        this.endArray();
        break;

      case TokenType.String:
      case TokenType.Number:
      case TokenType.Boolean:
      case TokenType.Null:
        this.pushArrayValue(token.value);
        this.state = ParserState.ExpectingCommaOrEnd;
        break;

      case TokenType.Comma:
        if (this.options.allowTrailingCommas || this.options.llmMode) {
          // Allow trailing comma or consecutive comma
        } else {
          this.setError(`Unexpected comma in array`);
        }
        break;

      default:
        this.setError(`Unexpected token in array: ${token.type}`);
    }
  }

  private handleCommaOrEndState(token: Token): void {
    const frame = this.currentFrame();
    if (!frame) {
      // Top-level value is complete
      this.state = ParserState.Complete;
      this.emitComplete();
      return;
    }

    switch (token.type) {
      case TokenType.Comma:
        if (frame.type === 'object') {
          this.state = ParserState.ExpectingKey;
          this.tokenizer.setExpectingKey(true);
        } else {
          this.state = ParserState.InArray;
        }
        break;

      case TokenType.ObjectEnd:
        if (frame.type === 'object') {
          this.endObject();
        } else {
          this.setError(`Unexpected } in array`);
        }
        break;

      case TokenType.ArrayEnd:
        if (frame.type === 'array') {
          this.endArray();
        } else {
          this.setError(`Unexpected ] in object`);
        }
        break;

      default:
        if (this.options.llmMode) {
          // Try to recover - might be missing comma
          if (frame.type === 'object') {
            this.state = ParserState.ExpectingKey;
            this.handleObjectState(token);
          } else {
            this.state = ParserState.InArray;
            this.handleArrayState(token);
          }
        } else {
          this.setError(`Expected , or end of container, got ${token.type}`);
        }
    }
  }

  private handlePartialToken(token: Token): void {
    // Update pending paths to show what's being parsed
    const path = this.getCurrentPath();

    if (token.type === TokenType.PartialString || token.type === TokenType.PartialNumber) {
      // If we have a current key in an object, the partial value belongs to that key
      const frame = this.currentFrame();
      if (frame?.type === 'object' && frame.currentKey) {
        const valuePath = [...path, frame.currentKey].join('.');
        this.pendingPaths.add(valuePath);
      } else if (frame?.type === 'array') {
        const valuePath = [...path, String(frame.arrayIndex)].join('.');
        this.pendingPaths.add(valuePath);
      }
    }
  }

  private handleError(token: Token): void {
    if (this.options.llmMode) {
      // In LLM mode, log error but try to continue
      this.errors.push({
        path: this.getCurrentPath(),
        message: String(token.value),
        keyword: 'syntax',
        schema: this.options.schema ?? {},
      });
    } else {
      this.setError(String(token.value));
    }
  }

  private tryRecover(token: Token): void {
    // Try to recover from error state
    // Look for structural tokens to sync back up
    switch (token.type) {
      case TokenType.ObjectStart:
        this.startObject();
        this.state = ParserState.ExpectingKey;
        break;
      case TokenType.ArrayStart:
        this.startArray();
        this.state = ParserState.InArray;
        break;
      case TokenType.ObjectEnd:
      case TokenType.ArrayEnd:
        if (this.stack.length > 0) {
          this.state = ParserState.ExpectingCommaOrEnd;
          this.processToken(token);
        }
        break;
    }
  }

  private startObject(): void {
    if (this.stack.length >= (this.options.maxDepth ?? 100)) {
      this.setError('Maximum depth exceeded');
      return;
    }

    const path = this.getCurrentPath();
    const schema = this.validator?.getSchemaAtPath(path);

    // Early type validation
    if (this.validator && !this.validator.canBeType('object', path)) {
      this.errors.push({
        path,
        message: 'Expected different type, got object',
        keyword: 'type',
        schema: schema ?? {},
      });
      this.options.events?.onValidationError?.(this.errors[this.errors.length - 1]!);
    }

    const frame: StackFrame = {
      type: 'object',
      data: {},
      schema,
      completedKeys: new Set(),
      arrayIndex: 0,
    };

    this.stack.push(frame);
    this.pendingPaths.add(path.join('.'));
  }

  private endObject(): void {
    const frame = this.stack.pop();
    if (!frame || frame.type !== 'object') {
      this.setError('Mismatched }');
      return;
    }

    const path = this.getCurrentPath();
    const pathStr = path.join('.');

    // Mark as complete
    this.completedPaths.add(pathStr);
    this.pendingPaths.delete(pathStr);

    // Validate complete object
    this.validateValue(frame.data, path);

    // Emit completion event
    this.options.events?.onPartialObject?.(frame.data as Partial<InferSchemaType<T>>, path);

    // Assign to parent or result
    this.assignValue(frame.data);

    // Update state
    if (this.stack.length === 0) {
      this.state = ParserState.Complete;
      this.emitComplete();
    } else {
      this.state = ParserState.ExpectingCommaOrEnd;
    }
  }

  private startArray(): void {
    if (this.stack.length >= (this.options.maxDepth ?? 100)) {
      this.setError('Maximum depth exceeded');
      return;
    }

    const path = this.getCurrentPath();
    const schema = this.validator?.getSchemaAtPath(path);

    // Early type validation
    if (this.validator && !this.validator.canBeType('array', path)) {
      this.errors.push({
        path,
        message: 'Expected different type, got array',
        keyword: 'type',
        schema: schema ?? {},
      });
      this.options.events?.onValidationError?.(this.errors[this.errors.length - 1]!);
    }

    const frame: StackFrame = {
      type: 'array',
      data: [],
      schema,
      completedKeys: new Set(),
      arrayIndex: 0,
    };

    this.stack.push(frame);
    this.pendingPaths.add(path.join('.'));
  }

  private endArray(): void {
    const frame = this.stack.pop();
    if (!frame || frame.type !== 'array') {
      this.setError('Mismatched ]');
      return;
    }

    const path = this.getCurrentPath();
    const pathStr = path.join('.');

    // Mark as complete
    this.completedPaths.add(pathStr);
    this.pendingPaths.delete(pathStr);

    // Validate complete array
    this.validateValue(frame.data, path);

    // Assign to parent or result
    this.assignValue(frame.data);

    // Update state
    if (this.stack.length === 0) {
      this.state = ParserState.Complete;
      this.emitComplete();
    } else {
      this.state = ParserState.ExpectingCommaOrEnd;
    }
  }

  private setValue(value: unknown): void {
    const frame = this.currentFrame();
    if (!frame) {
      this.result = value;
      this.validateValue(value, []);
      return;
    }

    if (frame.type === 'object') {
      if (!frame.currentKey) {
        this.setError('No current key for value');
        return;
      }

      const path = [...this.getCurrentPath(), frame.currentKey];
      const pathStr = path.join('.');

      (frame.data as Record<string, unknown>)[frame.currentKey] = value;
      frame.completedKeys.add(frame.currentKey);

      // Mark field as complete
      this.completedPaths.add(pathStr);
      this.pendingPaths.delete(pathStr);

      // Validate the value
      this.validateValue(value, path);

      // Emit field completion
      this.options.events?.onCompleteField?.(frame.currentKey, value, this.getCurrentPath());

      frame.currentKey = undefined;
    } else {
      this.pushArrayValue(value);
    }
  }

  private pushArrayValue(value: unknown): void {
    const frame = this.currentFrame();
    if (!frame || frame.type !== 'array') {
      this.setError('Not in array');
      return;
    }

    const path = [...this.getCurrentPath(), String(frame.arrayIndex)];
    const pathStr = path.join('.');

    (frame.data as unknown[]).push(value);

    // Mark as complete
    this.completedPaths.add(pathStr);
    this.pendingPaths.delete(pathStr);

    // Validate
    this.validateValue(value, path);

    frame.arrayIndex++;
  }

  private assignValue(value: unknown): void {
    const frame = this.currentFrame();
    if (!frame) {
      this.result = value;
      return;
    }

    if (frame.type === 'object') {
      if (!frame.currentKey) {
        this.setError('No current key for value');
        return;
      }
      (frame.data as Record<string, unknown>)[frame.currentKey] = value;
      frame.completedKeys.add(frame.currentKey);

      const path = [...this.getCurrentPath(), frame.currentKey];
      this.completedPaths.add(path.join('.'));

      this.options.events?.onCompleteField?.(frame.currentKey, value, this.getCurrentPath());
      frame.currentKey = undefined;
    } else {
      (frame.data as unknown[]).push(value);
      frame.arrayIndex++;
    }
  }

  private validateValue(value: unknown, path: string[]): void {
    if (!this.validator) return;

    const errors = this.validator.validate(value, path);
    for (const error of errors) {
      this.errors.push(error);
      this.options.events?.onValidationError?.(error);
    }
  }

  private currentFrame(): StackFrame | undefined {
    return this.stack[this.stack.length - 1];
  }

  private getCurrentPath(includeCurrentKey = false): string[] {
    const path: string[] = [];
    for (let i = 0; i < this.stack.length; i++) {
      const frame = this.stack[i];
      if (!frame) continue;

      const isLastFrame = i === this.stack.length - 1;

      if (frame.type === 'object' && frame.currentKey) {
        // Only include currentKey if it's not the last frame OR if explicitly requested
        if (!isLastFrame || includeCurrentKey) {
          path.push(frame.currentKey);
        }
      } else if (frame.type === 'array') {
        path.push(String(frame.arrayIndex));
      }
    }
    return path;
  }

  private setError(message: string): void {
    this.state = ParserState.Error;
    const error = new Error(message);
    this.options.events?.onError?.(error);

    if (!this.options.llmMode) {
      throw error;
    }
  }

  private emitComplete(): void {
    this.options.events?.onComplete?.(this.result as InferSchemaType<T>);
  }

  private buildResult(): ParseResult<InferSchemaType<T>> {
    const currentData = this.getCurrentData();

    return {
      complete: this.state === ParserState.Complete,
      valid: this.errors.length === 0,
      data: currentData as Partial<InferSchemaType<T>> | InferSchemaType<T>,
      completedFields: Array.from(this.completedPaths),
      pendingFields: Array.from(this.pendingPaths),
      errors: [...this.errors],
      depth: this.stack.length,
      bytesProcessed: this.bytesProcessed,
    };
  }

  private getCurrentData(): unknown {
    if (this.stack.length === 0) {
      return this.result;
    }

    // Build partial data from stack
    const rootFrame = this.stack[0];
    if (!rootFrame) return undefined;

    return rootFrame.data;
  }
}

/**
 * Create a new streaming JSON parser
 */
export function createStreamParser<T extends JSONSchema>(
  schema?: T,
  options?: Omit<ParserOptions<T>, 'schema'>
): StreamingJSONParser<T> {
  return new StreamingJSONParser<T>({
    ...options,
    schema,
  } as ParserOptions<T>);
}

/**
 * Create a parser optimized for LLM output
 */
export function createLLMParser<T extends JSONSchema>(
  schema?: T,
  options?: Omit<ParserOptions<T>, 'schema' | 'llmMode'>
): StreamingJSONParser<T> {
  return new StreamingJSONParser<T>({
    ...options,
    schema,
    llmMode: true,
  } as ParserOptions<T>);
}
