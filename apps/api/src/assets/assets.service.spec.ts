import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetsService } from './assets.service.js';

function createDb(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };

  return {
    db: { select: vi.fn().mockReturnValue(chain) },
    chain,
  };
}

function sqlIncludesValue(value: unknown, expected: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => sqlIncludesValue(entry, expected));
  if (!value || typeof value !== 'object') return value === expected;

  const chunk = value as { value?: unknown; queryChunks?: unknown };
  return sqlIncludesValue(chunk.value, expected) || sqlIncludesValue(chunk.queryChunks, expected);
}

describe('AssetsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps asset metadata and joined generation fields without exposing storage details', async () => {
    const createdAt = new Date('2026-08-21T10:00:00.000Z');
    const { db } = createDb([
      {
        asset: {
          id: 'asset-1',
          type: 'IMAGE',
          mimeType: 'image/png',
          size: 1234,
          width: 1024,
          height: 768,
          duration: null,
          createdAt,
          storageProvider: 'aws_s3',
          bucket: 'private-bucket',
          objectKey: 'private/object-key',
        },
        generation: {
          id: 'generation-1',
          inputJson: { prompt: 'a quiet mountain lake' },
          outputJson: { url: 'https://cdn.example.test/image.png' },
        },
      },
      {
        asset: {
          id: 'asset-2',
          type: 'UPLOAD',
          mimeType: 'image/jpeg',
          size: 456,
          width: null,
          height: null,
          duration: null,
          createdAt,
          storageProvider: 'none',
          bucket: null,
          objectKey: 'uploads/private-key',
        },
        generation: null,
      },
    ]);
    const service = new AssetsService(db as any);

    await expect(service.list('workspace-1', {} as any)).resolves.toEqual([
      {
        id: 'asset-1',
        type: 'IMAGE',
        url: 'https://cdn.example.test/image.png',
        mimeType: 'image/png',
        size: 1234,
        width: 1024,
        height: 768,
        duration: null,
        createdAt: createdAt.toISOString(),
        generationId: 'generation-1',
        prompt: 'a quiet mountain lake',
      },
      {
        id: 'asset-2',
        type: 'UPLOAD',
        url: null,
        mimeType: 'image/jpeg',
        size: 456,
        width: null,
        height: null,
        duration: null,
        createdAt: createdAt.toISOString(),
        generationId: null,
        prompt: null,
      },
    ]);

    expect(JSON.stringify(await service.list('workspace-1', {} as any))).not.toContain('objectKey');
    expect(JSON.stringify(await service.list('workspace-1', {} as any))).not.toContain('private-bucket');
  });

  it('uses workspace isolation and applies type, date, sort, and limit filters', async () => {
    const { db, chain } = createDb([]);
    const service = new AssetsService(db as any);
    const dto = {
      type: 'VIDEO',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-21T23:59:59.999Z',
      sort: 'OLDEST',
      limit: 25,
    };

    await service.list('workspace-42', dto as any);

    expect(chain.from).toHaveBeenCalledTimes(1);
    expect(chain.leftJoin).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(sqlIncludesValue(chain.where.mock.calls[0]?.[0], 'workspace-42')).toBe(true);
    expect(chain.orderBy).toHaveBeenCalledTimes(1);
    expect(chain.limit).toHaveBeenCalledWith(25);
  });
});
