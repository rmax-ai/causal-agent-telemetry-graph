import { describe, expect, it } from 'vitest';
import { canonicalize, hashCanonical } from '../index.js';

describe('canonicalize', () => {
  it('serializes null', () => {
    expect(canonicalize(null)).toBe('null');
  });

  it('serializes booleans', () => {
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
  });

  it('serializes integers', () => {
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(-1)).toBe('-1');
    expect(canonicalize(0)).toBe('0');
  });

  it('serializes non-finite numbers as null', () => {
    expect(canonicalize(Infinity)).toBe('null');
  });

  it('serializes strings', () => {
    expect(canonicalize('hello')).toBe('"hello"');
    expect(canonicalize('a"b')).toBe('"a\\"b"');
  });

  it('serializes arrays', () => {
    expect(canonicalize([1, 2, 3])).toBe('[1,2,3]');
    expect(canonicalize([])).toBe('[]');
  });

  it('serializes objects with sorted keys', () => {
    const obj = { b: 2, a: 1, c: 3 };
    expect(canonicalize(obj)).toBe('{"a":1,"b":2,"c":3}');
  });

  it('serializes nested objects', () => {
    const obj = { z: { b: 2, a: 1 }, y: 1 };
    expect(canonicalize(obj)).toBe('{"y":1,"z":{"a":1,"b":2}}');
  });

  it('produces consistent output regardless of insertion order', () => {
    const obj1: Record<string, unknown> = {};
    obj1.c = 3;
    obj1.a = 1;
    obj1.b = 2;

    const obj2: Record<string, unknown> = {};
    obj2.a = 1;
    obj2.b = 2;
    obj2.c = 3;

    expect(canonicalize(obj1)).toBe('{"a":1,"b":2,"c":3}');
    expect(canonicalize(obj2)).toBe('{"a":1,"b":2,"c":3}');
  });

  it('handles special characters in strings', () => {
    expect(canonicalize('hello\nworld')).toBe('"hello\\nworld"');
  });
});

describe('hashCanonical', () => {
  it('returns sha256: prefix', () => {
    const hash = hashCanonical({ a: 1 });
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('produces same hash for equivalent objects', () => {
    const h1 = hashCanonical({ b: 2, a: 1 });
    const h2 = hashCanonical({ a: 1, b: 2 });
    expect(h1).toBe(h2);
  });

  it('produces different hash for different objects', () => {
    const h1 = hashCanonical({ a: 1 });
    const h2 = hashCanonical({ a: 2 });
    expect(h1).not.toBe(h2);
  });
});
