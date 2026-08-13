/**
 * GenerationsService 行为测试：cancel 路径动态 queue options。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerationsService } from './generations.service.js';
import type { Queue } from 'bullmq';
import type { GenerationJobPayload } from '@enova/contracts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: async () => [],
          orderBy: () => ({ limit: async () => [] }),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: async () => [],
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: async () => [],
        onConflictDoNothing: vi.fn(() => ({
          returning: async () => [],
        })),
      })),
    })),
    transaction: async (cb: (tx: any) => Promise<any>) => cb({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: async () => [],
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: async () => [],
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: async () => [],
          onConflictDoNothing: vi.fn(() => ({
            returning: async () => [],
          })),
        })),
      })),
    }),
  };
}

function createMockQueue() {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  } as unknown as Queue<GenerationJobPayload>;
}

function createMockSettings(overrides: Record<string, any> = {}) {
  return {
    getNumber: vi.fn(async (key: string) => {
      if (key === 'queue.jobAttempts') return overrides.jobAttempts ?? 5;
      if (key === 'queue.jobBackoffMs') return overrides.jobBackoffMs ?? 5000;
      return null;
    }),
    getString: vi.fn(async () => null),
    getRaw: vi.fn(async () => null),
    getBoolean: vi.fn(async () => null),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GenerationsService cancel path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cancel uses dynamic queue options', () => {
    it('adds cancel job with dynamic attempts and backoff', async () => {
      const db = createMockDb();
      const queue = createMockQueue();
      const settings = createMockSettings({ jobAttempts: 7, jobBackoffMs: 1234 });

      // Mock wallet, pricing, entitlement
      const wallet = {} as any;
      const pricing = {} as any;
      const entitlement = {} as any;

      const service = new GenerationsService(db as any, wallet, pricing, queue as any, entitlement, settings as any);

      // Mock findByIdAndWorkspace to return a RUNNING job
      const mockJob = {
        id: 'job-1',
        workspaceId: 'ws-1',
        userId: 'u-1',
        type: 'IMAGE',
        status: 'RUNNING',
        provider: 'agnes',
        model: 'agn-dream',
        inputJson: { prompt: 'test' },
        reservedCredits: 10,
        estimatedCredits: 10,
        actualCredits: 0,
        estimatedCostMicrousd: 500,
        reportedCostMicrousd: 0,
        finalCostMicrousd: 0,
        costStatus: 'ESTIMATED',
        attemptCount: 1,
        createdAt: new Date(),
        completedAt: null,
      };

      // Override the private findByIdAndWorkspace
      (service as any).findByIdAndWorkspace = vi.fn().mockResolvedValue(mockJob);

      await service.cancel('ws-1', 'job-1');

      expect(queue.add).toHaveBeenCalledWith(
        'generation.cancel',
        expect.any(Object),
        expect.objectContaining({
          jobId: 'job-1:cancel',
          attempts: 7,
          backoff: { type: 'exponential', delay: 1234 },
        }),
      );
    });

    it('uses updated queue options after settings change', async () => {
      const db = createMockDb();
      const queue = createMockQueue();
      let currentAttempts = 5;
      let currentBackoff = 5000;

      const settings = {
        getNumber: vi.fn(async (key: string) => {
          if (key === 'queue.jobAttempts') return currentAttempts;
          if (key === 'queue.jobBackoffMs') return currentBackoff;
          return null;
        }),
      };

      const wallet = {} as any;
      const pricing = {} as any;
      const entitlement = {} as any;

      const service = new GenerationsService(db as any, wallet, pricing, queue as any, entitlement, settings as any);

      const mockJob = {
        id: 'job-1', workspaceId: 'ws-1', userId: 'u-1',
        type: 'IMAGE', status: 'RUNNING', provider: 'agnes', model: 'agn-dream',
        inputJson: { prompt: 'test' }, reservedCredits: 10,
        estimatedCredits: 10, actualCredits: 0,
        estimatedCostMicrousd: 500, reportedCostMicrousd: 0, finalCostMicrousd: 0,
        costStatus: 'ESTIMATED', attemptCount: 1, createdAt: new Date(), completedAt: null,
      };
      (service as any).findByIdAndWorkspace = vi.fn().mockResolvedValue(mockJob);

      // First cancel
      await service.cancel('ws-1', 'job-1');
      expect(queue.add).toHaveBeenCalledWith(
        expect.any(String), expect.any(Object),
        expect.objectContaining({ attempts: 5, backoff: { type: 'exponential', delay: 5000 } }),
      );

      // Change settings
      currentAttempts = 9;
      currentBackoff = 4321;
      vi.clearAllMocks();

      await service.cancel('ws-1', 'job-1');
      expect(queue.add).toHaveBeenCalledWith(
        expect.any(String), expect.any(Object),
        expect.objectContaining({ attempts: 9, backoff: { type: 'exponential', delay: 4321 } }),
      );
    });
  });
});