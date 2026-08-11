import { describe, expect, it } from 'vitest';
import { parseCookie } from './cookies.js';

describe('parseCookie', () => {
  it('returns undefined for empty header', () => {
    expect(parseCookie(undefined, 'enova_session')).toBeUndefined();
    expect(parseCookie('', 'enova_session')).toBeUndefined();
  });

  it('parses a single cookie', () => {
    expect(parseCookie('enova_session=abc123', 'enova_session')).toBe('abc123');
  });

  it('parses multiple cookies and finds the target', () => {
    const header = 'other=1; enova_session=xyz; theme=dark';
    expect(parseCookie(header, 'enova_session')).toBe('xyz');
  });

  it('returns undefined when key is absent', () => {
    expect(parseCookie('a=1; b=2', 'enova_session')).toBeUndefined();
  });

  it('decodes URL-encoded values', () => {
    expect(parseCookie('enova_session=hello%20world', 'enova_session')).toBe('hello world');
  });
});