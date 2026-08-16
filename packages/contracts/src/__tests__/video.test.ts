import { describe, expect, it } from 'vitest';
import {
  resolveVideoDuration,
  resolveVideoDurationFromInput,
  validateVideoNumFrames,
  validateVideoFrameRate,
  validateVideoFrames,
  VIDEO_NUM_FRAMES_MAX,
  VIDEO_FRAME_RATE_MIN,
  VIDEO_FRAME_RATE_MAX,
} from '../video.js';

describe('resolveVideoDuration', () => {
  it('calculates duration from numFrames / frameRate', () => {
    expect(resolveVideoDuration({ numFrames: 97, frameRate: 24 })).toBeCloseTo(4.0417, 3);
    expect(resolveVideoDuration({ numFrames: 121, frameRate: 24 })).toBeCloseTo(5.0417, 3);
    expect(resolveVideoDuration({ numFrames: 193, frameRate: 24 })).toBeCloseTo(8.0417, 3);
    expect(resolveVideoDuration({ numFrames: 241, frameRate: 24 })).toBeCloseTo(10.0417, 3);
    expect(resolveVideoDuration({ numFrames: 441, frameRate: 24 })).toBeCloseTo(18.375, 3);
  });

  it('returns null for missing or invalid params', () => {
    expect(resolveVideoDuration({})).toBeNull();
    expect(resolveVideoDuration({ numFrames: 0, frameRate: 24 })).toBeNull();
    expect(resolveVideoDuration({ numFrames: 121, frameRate: 0 })).toBeNull();
    expect(resolveVideoDuration({ numFrames: 'abc', frameRate: 24 })).toBeNull();
    expect(resolveVideoDuration({ numFrames: undefined, frameRate: undefined })).toBeNull();
  });
});

describe('resolveVideoDurationFromInput', () => {
  it('derives from numFrames + frameRate', () => {
    expect(resolveVideoDurationFromInput({ numFrames: 241, frameRate: 24 })).toBeCloseTo(10.0417, 3);
  });

  it('falls back to explicit duration field', () => {
    expect(resolveVideoDurationFromInput({ duration: 8 })).toBe(8);
  });

  it('prefers numFrames/frameRate over duration', () => {
    expect(resolveVideoDurationFromInput({ numFrames: 121, frameRate: 24, duration: 99 })).toBeCloseTo(5.0417, 3);
  });

  it('returns null when neither source is available', () => {
    expect(resolveVideoDurationFromInput({})).toBeNull();
  });
});

describe('validateVideoNumFrames', () => {
  it('accepts valid 8n+1 values', () => {
    expect(validateVideoNumFrames(97)).toBe(true);
    expect(validateVideoNumFrames(121)).toBe(true);
    expect(validateVideoNumFrames(193)).toBe(true);
    expect(validateVideoNumFrames(241)).toBe(true);
    expect(validateVideoNumFrames(441)).toBe(true);
    expect(validateVideoNumFrames(1)).toBe(true); // 8*0+1
  });

  it('rejects values violating 8n+1 rule', () => {
    expect(validateVideoNumFrames(96)).not.toBe(true);
    expect(validateVideoNumFrames(120)).not.toBe(true);
    expect(validateVideoNumFrames(194)).not.toBe(true);
    expect(validateVideoNumFrames(442)).not.toBe(true);
  });

  it('rejects values > 441', () => {
    const result = validateVideoNumFrames(449); // 8*56+1 but > 441
    expect(result).not.toBe(true);
  });

  it('rejects non-positive values', () => {
    expect(validateVideoNumFrames(0)).not.toBe(true);
    expect(validateVideoNumFrames(-1)).not.toBe(true);
    expect(validateVideoNumFrames(NaN)).not.toBe(true);
  });
});

describe('validateVideoFrameRate', () => {
  it('accepts valid range 1-60', () => {
    expect(validateVideoFrameRate(1)).toBe(true);
    expect(validateVideoFrameRate(24)).toBe(true);
    expect(validateVideoFrameRate(30)).toBe(true);
    expect(validateVideoFrameRate(60)).toBe(true);
  });

  it('rejects out-of-range values', () => {
    expect(validateVideoFrameRate(0)).not.toBe(true);
    expect(validateVideoFrameRate(61)).not.toBe(true);
    expect(validateVideoFrameRate(NaN)).not.toBe(true);
  });
});

describe('validateVideoFrames (combined)', () => {
  it('returns null for valid combinations', () => {
    expect(validateVideoFrames(97, 24)).toBeNull();
    expect(validateVideoFrames(241, 24)).toBeNull();
    expect(validateVideoFrames(441, 30)).toBeNull();
  });

  it('returns error message for invalid numFrames', () => {
    const err = validateVideoFrames(96, 24);
    expect(typeof err).toBe('string');
  });

  it('returns error message for invalid frameRate', () => {
    const err = validateVideoFrames(97, 0);
    expect(typeof err).toBe('string');
  });
});
