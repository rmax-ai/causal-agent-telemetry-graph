/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) — deterministic JSON serialization
 * for CATG canonical events and evidence artifacts.
 */
import { createHash } from 'node:crypto';

/**
 * Serialize a value to canonical JSON per RFC 8785.
 * Objects: keys sorted lexicographically, no trailing commas.
 * Strings: escaped per JSON spec.
 * Numbers: no leading zeros, no trailing zeros after decimal.
 */
export function canonicalize(value: unknown): string {
  return serializeAny(value);
}

/**
 * Compute SHA-256 hash of a canonically-serialized value.
 * Returns the hex digest prefixed with "sha256:".
 */
export function hashCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalize(value)).digest('hex')}`;
}

function serializeAny(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return 'null'; // RFC 8785: non-finite numbers → null
    }
    // Serialize integers without decimal point, floats with
    return Number.isInteger(value) ? value.toString() : serializeFloat(value);
  }
  if (typeof value === 'string') {
    return serializeString(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serializeAny).join(',')}]`;
  }
  if (typeof value === 'object') {
    return serializeObject(value as Record<string, unknown>);
  }
  // undefined, function, symbol → not valid JSON
  throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}

function serializeString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\f/g, '\\f');
  // RFC 8785 §3.2.2: control characters U+0000–U+001F must be escaped as \uXXXX
  // biome-ignore lint/suspicious/noControlCharactersInRegex: RFC 8785 requires control character escaping
  const withControls = escaped.replace(/[\u0000-\u001f]/g, (ch) => {
    return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
  return `"${withControls}"`;
}

function serializeFloat(n: number): string {
  if (n === 0) {
    return 1 / n === -Infinity ? '-0' : '0';
  }
  // RFC 8785 §3.2.3: no leading "+" and no trailing zeros
  // Use toExponential to get a stable representation
  let str = n.toString();
  // If the number is very small or large, toExponential gives a canonical form
  if (Math.abs(n) >= 1e21 || (Math.abs(n) < 1e-6 && n !== 0)) {
    str = n.toExponential();
    // Remove leading "+" and trailing zeros
    const match = str.match(/^(-?\d)\.(\d+)e([+-]\d+)$/i);
    if (match) {
      const [, sign, mantissa, exp] = match;
      const trimmed = (mantissa ?? '').replace(/0+$/, '');
      const e = parseInt(exp ?? '0', 10).toString();
      str = `${sign}${trimmed ? `.${trimmed}` : ''}e${e}`;
    }
  }
  return str;
}

function serializeObject(obj: Record<string, unknown>): string {
  // Sort keys lexicographically (RFC 8785 §3.2.3)
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => {
    const serializedKey = serializeString(key);
    const value = obj[key];
    return `${serializedKey}:${serializeAny(value)}`;
  });
  return `{${pairs.join(',')}}`;
}
