import { Token, TokenType } from './types.js';

interface TokenizerOptions {
  allowTrailingCommas?: boolean;
  allowUnquotedKeys?: boolean;
  allowSingleQuotes?: boolean;
  llmMode?: boolean;
}

interface TokenizerState {
  buffer: string;
  position: number;
  inString: boolean;
  stringQuote: '"' | "'" | null;
  escapeNext: boolean;
  currentToken: string;
}

const WHITESPACE = /\s/;
const NUMBER_START = /[-0-9]/;
const NUMBER_CHAR = /[-+0-9.eE]/;
const UNQUOTED_KEY_CHAR = /[a-zA-Z0-9_$]/;

export class StreamingTokenizer {
  private options: TokenizerOptions;
  private state: TokenizerState;
  private tokens: Token[];
  private expectingKey: boolean;

  constructor(options: TokenizerOptions = {}) {
    this.options = {
      allowTrailingCommas: options.llmMode ?? options.allowTrailingCommas ?? false,
      allowUnquotedKeys: options.llmMode ?? options.allowUnquotedKeys ?? false,
      allowSingleQuotes: options.llmMode ?? options.allowSingleQuotes ?? false,
      llmMode: options.llmMode ?? false,
    };
    this.state = this.createInitialState();
    this.tokens = [];
    this.expectingKey = false;
  }

  private createInitialState(): TokenizerState {
    return {
      buffer: '',
      position: 0,
      inString: false,
      stringQuote: null,
      escapeNext: false,
      currentToken: '',
    };
  }

  reset(): void {
    this.state = this.createInitialState();
    this.tokens = [];
    this.expectingKey = false;
  }

  setExpectingKey(expecting: boolean): void {
    this.expectingKey = expecting;
  }

  feed(chunk: string): Token[] {
    this.state.buffer += chunk;
    this.tokens = [];

    while (this.state.position < this.state.buffer.length) {
      const processed = this.processNextToken();
      if (!processed) {
        // Need more data or hit partial token
        break;
      }
    }

    // Trim processed data from buffer, keeping any partial data
    if (this.state.position > 0) {
      this.state.buffer = this.state.buffer.slice(this.state.position);
      this.state.position = 0;
    }

    return this.tokens;
  }

  /**
   * Get any partial token from remaining buffer
   */
  getPartialToken(): Token | null {
    const remaining = this.state.buffer.trim();
    if (!remaining) return null;

    // Check for partial string
    const startsWithQuote = remaining.startsWith('"') || (this.options.allowSingleQuotes && remaining.startsWith("'"));
    if (this.state.inString || startsWithQuote) {
      // Strip the opening quote from the content
      const content = startsWithQuote ? remaining.slice(1) : remaining;

      return {
        type: this.expectingKey ? TokenType.PartialKey : TokenType.PartialString,
        value: this.unescapeString(content),
        raw: remaining,
        position: this.state.position,
        isPartial: true,
      };
    }

    // Check for partial number
    if (NUMBER_START.test(remaining[0] ?? '')) {
      return {
        type: TokenType.PartialNumber,
        value: remaining,
        raw: remaining,
        position: this.state.position,
        isPartial: true,
      };
    }

    // Check for partial keyword (true, false, null)
    if (/^(t(r(u(e)?)?)?|f(a(l(s(e)?)?)?)?|n(u(l(l)?)?)?)$/i.test(remaining)) {
      return {
        type: TokenType.PartialString, // Will be resolved to boolean/null when complete
        value: remaining,
        raw: remaining,
        position: this.state.position,
        isPartial: true,
      };
    }

    // Check for partial unquoted key in LLM mode
    if (this.options.allowUnquotedKeys && this.expectingKey && UNQUOTED_KEY_CHAR.test(remaining[0] ?? '')) {
      return {
        type: TokenType.PartialKey,
        value: remaining,
        raw: remaining,
        position: this.state.position,
        isPartial: true,
      };
    }

    return null;
  }

  private processNextToken(): boolean {
    this.skipWhitespace();

    if (this.state.position >= this.state.buffer.length) {
      return false;
    }

    const char = this.state.buffer[this.state.position];
    if (char === undefined) return false;
    const startPos = this.state.position;

    // Structural characters
    switch (char) {
      case '{':
        this.state.position++;
        this.pushToken(TokenType.ObjectStart, null, char, startPos);
        this.expectingKey = true;
        return true;

      case '}':
        this.state.position++;
        this.pushToken(TokenType.ObjectEnd, null, char, startPos);
        this.expectingKey = false;
        return true;

      case '[':
        this.state.position++;
        this.pushToken(TokenType.ArrayStart, null, char, startPos);
        this.expectingKey = false;
        return true;

      case ']':
        this.state.position++;
        this.pushToken(TokenType.ArrayEnd, null, char, startPos);
        this.expectingKey = false;
        return true;

      case ':':
        this.state.position++;
        this.pushToken(TokenType.Colon, null, char, startPos);
        this.expectingKey = false;
        return true;

      case ',':
        this.state.position++;
        this.pushToken(TokenType.Comma, null, char, startPos);
        // After comma in object, expect key; after comma in array, expect value
        // This is managed by the parser
        return true;

      case '"':
      case "'":
        if (char === "'" && !this.options.allowSingleQuotes) {
          this.pushErrorToken(`Unexpected character: ${char}`, startPos);
          return true;
        }
        return this.processString(char);

      default:
        // Check for number
        if (NUMBER_START.test(char)) {
          return this.processNumber();
        }

        // Check for keywords (true, false, null)
        if (char === 't' || char === 'f' || char === 'n') {
          return this.processKeyword();
        }

        // Check for unquoted key in LLM mode
        if (this.options.allowUnquotedKeys && this.expectingKey && UNQUOTED_KEY_CHAR.test(char)) {
          return this.processUnquotedKey();
        }

        // Unknown character
        if (this.options.llmMode) {
          // In LLM mode, skip unknown characters
          this.state.position++;
          return true;
        }

        this.pushErrorToken(`Unexpected character: ${char}`, startPos);
        return true;
    }
  }

  private processString(quote: '"' | "'"): boolean {
    const startPos = this.state.position;
    this.state.position++; // Skip opening quote

    let value = '';
    let raw = quote;
    let escaped = false;

    while (this.state.position < this.state.buffer.length) {
      const char = this.state.buffer[this.state.position];
      if (char === undefined) break;
      raw += char;

      if (escaped) {
        value += this.getEscapedChar(char);
        escaped = false;
        this.state.position++;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        this.state.position++;
        continue;
      }

      if (char === quote) {
        this.state.position++;
        const tokenType = this.expectingKey ? TokenType.Key : TokenType.String;
        this.pushToken(tokenType, value, raw, startPos);
        if (tokenType === TokenType.Key) {
          this.expectingKey = false;
        }
        return true;
      }

      value += char;
      this.state.position++;
    }

    // Incomplete string - need more data
    this.state.position = startPos;
    this.state.inString = true;
    this.state.stringQuote = quote;
    return false;
  }

  private processNumber(): boolean {
    const startPos = this.state.position;
    let raw = '';

    while (this.state.position < this.state.buffer.length) {
      const char = this.state.buffer[this.state.position];
      if (char === undefined) break;

      if (!NUMBER_CHAR.test(char)) {
        break;
      }
      raw += char;
      this.state.position++;
    }

    // If we're at end of buffer, the number might be incomplete
    // Wait for more data unless we see a terminating character
    if (this.state.position >= this.state.buffer.length) {
      // Reset and wait for more data
      this.state.position = startPos;
      return false;
    }

    // Check if we have a complete number
    // A number is incomplete if it ends with 'e', 'E', '.', '-', or '+'
    const lastChar = raw[raw.length - 1];
    if (lastChar !== undefined && /[eE.\-+]/.test(lastChar)) {
      // Need more data
      this.state.position = startPos;
      return false;
    }

    const value = parseFloat(raw);
    if (isNaN(value)) {
      this.pushErrorToken(`Invalid number: ${raw}`, startPos);
      return true;
    }

    this.pushToken(TokenType.Number, value, raw, startPos);
    return true;
  }

  private processKeyword(): boolean {
    const startPos = this.state.position;
    const keywords: Record<string, { type: TokenType; value: boolean | null }> = {
      true: { type: TokenType.Boolean, value: true },
      false: { type: TokenType.Boolean, value: false },
      null: { type: TokenType.Null, value: null },
    };

    for (const [keyword, info] of Object.entries(keywords)) {
      if (this.state.buffer.slice(this.state.position).startsWith(keyword)) {
        // Check that keyword is complete (followed by non-word char or end of buffer)
        const nextCharPos = this.state.position + keyword.length;
        if (nextCharPos < this.state.buffer.length) {
          const nextChar = this.state.buffer[nextCharPos];
          if (nextChar !== undefined && /[a-zA-Z0-9_]/.test(nextChar)) {
            continue;
          }
        }
        // At end of buffer with exact keyword match is also valid

        this.state.position += keyword.length;
        this.pushToken(info.type, info.value, keyword, startPos);
        return true;
      }
    }

    // Check if it's a partial keyword (only if we're at end of buffer)
    if (this.state.position + 4 >= this.state.buffer.length) {  // max keyword length is 5 (false)
      for (const keyword of Object.keys(keywords)) {
        const remaining = this.state.buffer.slice(this.state.position);
        if (keyword.startsWith(remaining) && remaining.length < keyword.length) {
          // It's a partial keyword, need more data
          return false;
        }
      }
    }

    // Not a valid keyword - in LLM mode, might be an unquoted key
    if (this.options.allowUnquotedKeys && this.expectingKey) {
      return this.processUnquotedKey();
    }

    this.pushErrorToken(`Invalid keyword at position ${startPos}`, startPos);
    return true;
  }

  private processUnquotedKey(): boolean {
    const startPos = this.state.position;
    let key = '';

    while (this.state.position < this.state.buffer.length) {
      const char = this.state.buffer[this.state.position];
      if (char === undefined) break;

      if (!UNQUOTED_KEY_CHAR.test(char)) {
        break;
      }
      key += char;
      this.state.position++;
    }

    if (key.length > 0) {
      // Check if we have a terminating character or end of buffer
      const nextChar = this.state.buffer[this.state.position];
      // If next char is colon or whitespace, key is complete
      if (nextChar === ':' || nextChar === undefined || WHITESPACE.test(nextChar)) {
        this.pushToken(TokenType.Key, key, key, startPos);
        this.expectingKey = false;
        return true;
      }
      // If we're at end of buffer and no terminator, it might be incomplete
      if (this.state.position >= this.state.buffer.length) {
        this.state.position = startPos;
        return false;
      }
      // Otherwise it's a complete key
      this.pushToken(TokenType.Key, key, key, startPos);
      this.expectingKey = false;
      return true;
    }

    return false;
  }

  private skipWhitespace(): void {
    while (this.state.position < this.state.buffer.length) {
      const char = this.state.buffer[this.state.position];
      if (char === undefined || !WHITESPACE.test(char)) {
        break;
      }
      this.state.position++;
    }
  }

  private pushToken(type: TokenType, value: unknown, raw: string, position: number): void {
    this.tokens.push({
      type,
      value,
      raw,
      position,
      isPartial: false,
    });
  }

  private pushErrorToken(message: string, position: number): void {
    this.tokens.push({
      type: TokenType.Error,
      value: message,
      raw: this.state.buffer[position] ?? '',
      position,
      isPartial: false,
    });
    this.state.position++;
  }

  private getEscapedChar(char: string): string {
    switch (char) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case '\\': return '\\';
      case '/': return '/';
      case '"': return '"';
      case "'": return "'";
      default:
        // Handle unicode escapes
        if (char === 'u') {
          // This is simplified; full implementation would look ahead
          return char;
        }
        return char;
    }
  }

  private unescapeString(str: string): string {
    let result = '';
    let i = 0;
    while (i < str.length) {
      const char = str[i];
      if (char === '\\' && i + 1 < str.length) {
        const nextChar = str[i + 1];
        if (nextChar !== undefined) {
          result += this.getEscapedChar(nextChar);
          i += 2;
          continue;
        }
      }
      result += char ?? '';
      i++;
    }
    return result;
  }
}
