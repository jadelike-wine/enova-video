import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  DomainError,
  GENERATION_STATUSES,
  WALLET_LEDGER_TYPES,
} from '../index';

describe('contracts', () => {
  it('exposes stable enum values', () => {
    expect(GENERATION_STATUSES.SUCCEEDED).toBe('SUCCEEDED');
    expect(WALLET_LEDGER_TYPES.GENERATION_RESERVE).toBe('GENERATION_RESERVE');
  });

  it('DomainError produces uniform error body', () => {
    const err = new DomainError({
      code: ERROR_CODES.INSUFFICIENT_CREDITS,
      message: 'Insufficient credits',
      statusCode: 400,
      requestId: 'req-1',
    });
    expect(err.toBody()).toEqual({
      error: { code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits', requestId: 'req-1', details: undefined },
    });
  });
});