/**
 * Nomin Code: Production-Grade JSON Repair Engine
 * Designed for ~20B open-weights models (Qwen2.5-Coder 14B/32B, DeepSeek-V3/R1, Llama-3.1 8B/70B)
 * which frequently emit JSON with unescaped control characters, trailing commas,
 * Python literals, or truncated brackets upon hitting max_token boundaries.
 * 
 * Zero external dependencies.
 */

export class JsonRepair {
  /**
   * Attempts to parse JSON directly, falling back to multi-stage lexer & regex repair.
   */
  public static parse<T = any>(raw: string, fallback?: T): T {
    if (!raw || typeof raw !== 'string') {
      return (fallback !== undefined ? fallback : {}) as T;
    }

    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return (fallback !== undefined ? fallback : {}) as T;
    }

    // Fast path: standard compliant JSON
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // Proceed to repair pipeline
    }

    try {
      const repaired = JsonRepair.repair(trimmed);
      return JSON.parse(repaired) as T;
    } catch {
      if (fallback !== undefined) {
        return fallback;
      }
      // Last-ditch: regex property extractor
      const extracted = JsonRepair.regexExtract(trimmed);
      if (Object.keys(extracted).length > 0) {
        return extracted as unknown as T;
      }
      throw new SyntaxError(`Failed to parse repaired JSON from LLM: ${trimmed.slice(0, 100)}...`);
    }
  }

  /**
   * Transforms a malformed or truncated JSON string into valid JSON.
   */
  public static repair(raw: string): string {
    if (!raw) return '{}';
    let text = raw.trim();

    // 1. Strip Markdown code block wrappers: ```json ... ``` or ``` ... ```
    text = text.replace(/^```(?:json|javascript|ts|js)?\s*\n?/i, '');
    text = text.replace(/\n?\s*```\s*$/i, '');
    text = text.trim();

    // Fast check again
    try {
      JSON.parse(text);
      return text;
    } catch {
      // Continue
    }

    // 2. Extract JSON boundary if model generated conversational fluff around JSON
    text = JsonRepair.extractJsonEnvelope(text);

    // 3. Normalise Python & JavaScript literals outside of string literals
    text = JsonRepair.normalizeLiterals(text);

    // 4. Lexer-based pass:
    // - Escape unescaped control characters (ASCII 0x00-0x1F, newlines, tabs) inside string literals
    // - Convert single-quoted strings to double-quoted strings
    // - Close unclosed strings
    // - Balance unbalanced braces and brackets
    text = JsonRepair.lexerRepair(text);

    // 5. Remove trailing commas before closing braces/brackets: `, }` -> `}` and `, ]` -> `]`
    text = text.replace(/,\s*([}\]])/g, '$1');

    // 6. Fix unquoted keys: `{ key: "value" }` or `{ foo_bar: 123 }` -> `{ "key": "value" }`
    text = text.replace(/([{,]\s*)([a-zA-Z0-9_$-]+)\s*:/g, '$1"$2":');

    // 7. Ensure brackets are properly balanced after regex transformations
    text = JsonRepair.balanceBrackets(text);

    return text;
  }

  /**
   * If an LLM emits text like "Sure, here is the tool call: {\"file\": \"foo.ts\"} Hope that helps!",
   * extracts the candidate JSON substring from the first '{' or '[' to the last '}' or ']'.
   */
  private static extractJsonEnvelope(input: string): string {
    const firstBrace = input.indexOf('{');
    const firstBracket = input.indexOf('[');

    let startIdx = -1;
    if (firstBrace !== -1 && firstBracket !== -1) {
      startIdx = Math.min(firstBrace, firstBracket);
    } else if (firstBrace !== -1) {
      startIdx = firstBrace;
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
    }

    if (startIdx === -1) {
      return input;
    }

    const lastBrace = input.lastIndexOf('}');
    const lastBracket = input.lastIndexOf(']');
    const endIdx = Math.max(lastBrace, lastBracket);

    // If the JSON was truncated, endIdx may be -1 or earlier than startIdx
    if (endIdx > startIdx) {
      return input.slice(startIdx, endIdx + 1);
    }

    // Truncated: take from startIdx to end of text
    return input.slice(startIdx);
  }

  /**
   * Replaces Python literals (True, False, None) and unquoted NaN/Infinity
   * when they occur outside string literals.
   */
  private static normalizeLiterals(input: string): string {
    let result = '';
    let inString = false;
    let quoteChar = '';
    let escape = false;

    let i = 0;
    while (i < input.length) {
      const char = input[i];

      if (escape) {
        result += char;
        escape = false;
        i++;
        continue;
      }

      if (char === '\\') {
        result += char;
        escape = true;
        i++;
        continue;
      }

      if ((char === '"' || char === "'") && !inString) {
        inString = true;
        quoteChar = char;
        result += char;
        i++;
        continue;
      }

      if (char === quoteChar && inString) {
        inString = false;
        quoteChar = '';
        result += char;
        i++;
        continue;
      }

      if (!inString) {
        // Check for Python / JS keywords
        const remainder = input.slice(i);
        if (/^True\b/.test(remainder)) {
          result += 'true';
          i += 4;
          continue;
        }
        if (/^False\b/.test(remainder)) {
          result += 'false';
          i += 5;
          continue;
        }
        if (/^None\b/.test(remainder)) {
          result += 'null';
          i += 4;
          continue;
        }
        if (/^undefined\b/.test(remainder)) {
          result += 'null';
          i += 9;
          continue;
        }
      }

      result += char;
      i++;
    }

    return result;
  }

  /**
   * Stateful lexer pass that safely escapes unescaped control chars (raw newlines, carriage returns, tabs)
   * inside strings, and normalises single-quoted strings into double-quoted strings.
   */
  private static lexerRepair(input: string): string {
    let result = '';
    let inString = false;
    let quoteChar = '';
    let escape = false;

    let i = 0;
    while (i < input.length) {
      const char = input[i];

      if (escape) {
        result += char;
        escape = false;
        i++;
        continue;
      }

      if (char === '\\') {
        result += char;
        escape = true;
        i++;
        continue;
      }

      // Entering or leaving a string
      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        quoteChar = char;
        // Always standardise on double quotes
        result += '"';
        i++;
        continue;
      }

      if (inString && char === quoteChar) {
        inString = false;
        quoteChar = '';
        result += '"';
        i++;
        continue;
      }

      if (inString) {
        // If single quotes were used for string literal, internal unescaped double quotes should be escaped
        if (quoteChar === "'" && char === '"') {
          result += '\\"';
          i++;
          continue;
        }

        // Escape raw control characters inside string literal
        if (char === '\n') {
          result += '\\n';
          i++;
          continue;
        }
        if (char === '\r') {
          result += '\\r';
          i++;
          continue;
        }
        if (char === '\t') {
          result += '\\t';
          i++;
          continue;
        }
        if (char.charCodeAt(0) < 32) {
          // Other ASCII control characters
          const hex = char.charCodeAt(0).toString(16).padStart(4, '0');
          result += `\\u${hex}`;
          i++;
          continue;
        }
      }

      result += char;
      i++;
    }

    // If string was truncated mid-sentence by token limit, close it
    if (inString) {
      result += '"';
    }

    return result;
  }

  /**
   * Balances unclosed brackets '[' and braces '{' when an LLM stream terminates abruptly.
   */
  public static balanceBrackets(str: string): string {
    const stack: string[] = [];
    let inString = false;
    let escape = false;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{' || char === '[') {
          stack.push(char);
        } else if (char === '}') {
          if (stack.length > 0 && stack[stack.length - 1] === '{') {
            stack.pop();
          }
        } else if (char === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === '[') {
            stack.pop();
          }
        }
      }
    }

    let balanced = str;
    if (inString) {
      balanced += '"';
    }

    // Close remaining open structures in LIFO order
    while (stack.length > 0) {
      const open = stack.pop();
      if (open === '{') balanced += '}';
      else if (open === '[') balanced += ']';
    }

    return balanced;
  }

  /**
   * Resilient fallback property extractor using regular expressions.
   * Useful if JSON structure is hopelessly corrupted but key-value pairs are identifiable.
   */
  public static regexExtract(str: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const propRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*("(?:[^"\\]*(?:\\.[^"\\]*)*)"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\[[^\]]*\]|\{[^}]*\})/g;

    let match: RegExpExecArray | null;
    while ((match = propRegex.exec(str)) !== null) {
      const key = match[1];
      const rawVal = match[2];

      try {
        result[key] = JSON.parse(rawVal);
      } catch {
        // Strip quotes if string
        if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
          result[key] = rawVal.slice(1, -1);
        } else {
          result[key] = rawVal;
        }
      }
    }

    return result;
  }
}

export const safeJsonParse = JsonRepair.parse;
export const repairJson = JsonRepair.repair;
