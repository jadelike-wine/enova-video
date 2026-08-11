import { describe, expect, it } from 'vitest';
import { compareVersions, normalizeVersion } from './semver.js';

describe('semver', () => {
  it('compares three-segment versions', () => {
    expect(compareVersions('1.2.0', '1.2.1')).toBe(-1);
    expect(compareVersions('1.2.1', '1.2.0')).toBe(1);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('supports four-segment versions, missing treated as 0', () => {
    expect(compareVersions('1.2.0', '1.2.0.1')).toBe(-1);
    expect(compareVersions('1.2.0.1', '1.2.0')).toBe(1);
    expect(compareVersions('0.1.161', '0.1.160.1')).toBe(1);
  });

  it('handles v prefix', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('v1.2.0', '1.2.1')).toBe(-1);
  });

  it('normalizeVersion strips v prefix', () => {
    expect(normalizeVersion('v1.2.0')).toBe('1.2.0');
    expect(normalizeVersion('1.2.0')).toBe('1.2.0');
  });
});