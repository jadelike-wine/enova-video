import { describe, expect, it } from 'vitest';
import { GenerationsAdminService } from './generations.admin.service.js';

function tableKey(table: unknown): string {
  if (typeof table === 'string') return table;
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : String(table);
}

/**
 * Build a fluent DB mock for GenerationsAdminService.detail.
 *
 * The detail method issues these queries (in order):
 *  1. select().from(generationJobs).where().limit(1)            → job row
 *  2. Promise.all:
 *     a. select().from(priceQuotes).where().limit(1)
 *     b. select().from(creditReservations).where().limit(1)
 *     c. select().from(usageEvents).where().limit(1)
 *     d. select({...}).from(users).where().limit(1)
 *     e. select().from(assets).where().orderBy()
 *  3. select().from(generationAttempts).where().orderBy()
 *  4. select({...}).from(providerCredentials).innerJoin().where()   (credential batch)
 *  5. select().from(generationDispatchOutbox).where().orderBy()
 *  6. select().from(costEvents).where().orderBy()
 *  7. select().from(pricingVersions).where().limit(1)  (only if pricingVersionId exists)
 *
 * Each query chain is thenable (resolves to rows[]) and supports
 * from/where/limit/orderBy/innerJoin chaining.
 */
function createDb(handlers: Record<string, () => any>) {
  const calls: Record<string, number> = {};
  const result = (key: string) => {
    calls[key] = (calls[key] ?? 0) + 1;
    return handlers[key] ? handlers[key](calls[key]) : [];
  };

  // For select with explicit fields (like users/credentials), the table key is still based on the table.
  const mk = (table: unknown) => {
    const key = 'sel:' + tableKey(table);
    const chain: any = {
      then: (resolve: (v: any[]) => void) => {
        resolve(result(key));
      },
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      orderBy: () => chain,
      offset: () => chain,
      innerJoin: () => chain,
      for: () => chain,
      groupBy: () => chain,
    };
    return chain;
  };

  // select() can be called with no args (select all) or with an object (select specific fields).
  // In both cases, the next call is .from(table).
  return {
    select: () => ({ from: (t: unknown) => mk(t) }),
    transaction: async (fn: (tx: any) => Promise<any>) => fn({
      select: () => ({ from: (t: unknown) => mk(t) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([{ id: 'x' }]) }) }),
    }),
  };
}

const NOW = new Date('2026-08-26T10:00:00.000Z');

const baseJob = {
  id: 'job-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  type: 'IMAGE',
  status: 'SUCCEEDED',
  provider: 'agnes',
  model: 'agnes-image-2.1',
  title: 'test',
  titleGenerationStatus: 'SUCCEEDED',
  inputJson: { prompt: 'a cat' },
  outputJson: { url: 'https://cdn.example.test/image.png' },
  providerJobId: null,
  providerStartedAt: null,
  pollCount: 0,
  estimatedCredits: 10,
  reservedCredits: 10,
  actualCredits: 10,
  estimatedCostUsd: 0,
  actualCostUsd: 0,
  estimatedCostMicrousd: 500,
  reportedCostMicrousd: 0,
  finalCostMicrousd: 0,
  costStatus: 'ESTIMATED',
  pricingVersionId: null,
  priceQuoteId: null,
  attemptCount: 1,
  errorCode: null,
  errorMessage: null,
  createdAt: NOW,
  queuedAt: NOW,
  startedAt: NOW,
  completedAt: NOW,
  canceledAt: null,
};

describe('GenerationsAdminService.detail', () => {
  it('Case 1: returns user summary with email/id/role/status', async () => {
    const db = createDb({
      'sel:generation_jobs': () => [baseJob],
      'sel:users': () => [{ id: 'user-1', email: 'test@example.com', role: 'USER', status: 'ACTIVE' }],
      'sel:assets': () => [],
      'sel:price_quotes': () => [],
      'sel:credit_reservations': () => [],
      'sel:usage_events': () => [],
      'sel:generation_attempts': () => [],
      'sel:provider_credentials': () => [],
      'sel:generation_dispatch_outbox': () => [],
      'sel:cost_events': () => [],
    });
    const svc = new GenerationsAdminService(db as any, {} as any, {} as any);

    const detail = await svc.detail('job-1');

    expect(detail.user).not.toBeNull();
    expect(detail.user!.id).toBe('user-1');
    expect(detail.user!.email).toBe('test@example.com');
    expect(detail.user!.role).toBe('USER');
    expect(detail.user!.status).toBe('ACTIVE');
  });

  it('Case 2: returns attempt with credentialId and credential summary', async () => {
    const db = createDb({
      'sel:generation_jobs': () => [baseJob],
      'sel:users': () => [{ id: 'user-1', email: 'test@example.com', role: 'USER', status: 'ACTIVE' }],
      'sel:assets': () => [],
      'sel:price_quotes': () => [],
      'sel:credit_reservations': () => [],
      'sel:usage_events': () => [],
      'sel:generation_attempts': () => [
        {
          id: 'att-1',
          generationJobId: 'job-1',
          attemptNo: 1,
          provider: 'agnes',
          model: 'agnes-image-2.1',
          credentialId: 'cred-1',
          providerJobId: null,
          status: 'SUCCEEDED',
          startedAt: NOW,
          endedAt: NOW,
          errorCode: null,
          errorMessage: null,
          estimatedCostMicrousd: 500,
          reportedCostMicrousd: 0,
          metadata: null,
        },
      ],
      'sel:provider_credentials': () => [
        {
          id: 'cred-1',
          name: 'Agnes 主账号',
          status: 'ACTIVE',
          providerCode: 'agnes',
        },
      ],
      'sel:generation_dispatch_outbox': () => [],
      'sel:cost_events': () => [],
    });
    const svc = new GenerationsAdminService(db as any, {} as any, {} as any);

    const detail = await svc.detail('job-1');

    expect(detail.attempts).toHaveLength(1);
    const attempt = detail.attempts[0];
    expect(attempt.credentialId).toBe('cred-1');
    expect(attempt.credential).not.toBeNull();
    expect(attempt.credential!.id).toBe('cred-1');
    expect(attempt.credential!.name).toBe('Agnes 主账号');
    expect(attempt.credential!.provider).toBe('agnes');
    expect(attempt.credential!.status).toBe('ACTIVE');
    // maskedApiKey must not be present — credential summary should only contain
    // id/name/provider/status for audit identification, not key-derived info.
    expect((attempt.credential as any).maskedApiKey).toBeUndefined();
  });

  it('Case 3: credential response does not leak secret/maskedApiKey/encryptedSecret', async () => {
    const db = createDb({
      'sel:generation_jobs': () => [baseJob],
      'sel:users': () => [{ id: 'user-1', email: 'test@example.com', role: 'USER', status: 'ACTIVE' }],
      'sel:assets': () => [],
      'sel:price_quotes': () => [],
      'sel:credit_reservations': () => [],
      'sel:usage_events': () => [],
      'sel:generation_attempts': () => [
        {
          id: 'att-1',
          generationJobId: 'job-1',
          attemptNo: 1,
          provider: 'agnes',
          model: 'agnes-image-2.1',
          credentialId: 'cred-1',
          providerJobId: null,
          status: 'SUCCEEDED',
          startedAt: NOW,
          endedAt: NOW,
          errorCode: null,
          errorMessage: null,
          estimatedCostMicrousd: 500,
          reportedCostMicrousd: 0,
          metadata: null,
        },
      ],
      'sel:provider_credentials': () => [
        {
          id: 'cred-1',
          name: 'Agnes 主账号',
          status: 'ACTIVE',
          providerCode: 'agnes',
        },
      ],
      'sel:generation_dispatch_outbox': () => [],
      'sel:cost_events': () => [],
    });
    const svc = new GenerationsAdminService(db as any, {} as any, {} as any);

    const detail = await svc.detail('job-1');
    const json = JSON.stringify(detail);

    // maskedApiKey must not be present in the response — generation detail only
    // requires GENERATION_READ, so no key-derived info should be exposed.
    expect(json).not.toContain('maskedApiKey');
    // encryptedSecret must not be exposed either
    expect(json).not.toContain('encryptedSecret');
    expect(json).not.toContain('encrypted_secret');
    // No apiKey/token/secret fields
    expect(json).not.toContain('"apiKey"');
    expect(json).not.toContain('"secret"');
    expect(json).not.toContain('"token"');
  });

  it('Case 4: returns multiple assets with correct fields including displayUrl', async () => {
    const db = createDb({
      'sel:generation_jobs': () => [baseJob],
      'sel:users': () => [{ id: 'user-1', email: 'test@example.com', role: 'USER', status: 'ACTIVE' }],
      'sel:assets': () => [
        {
          id: 'asset-1',
          workspaceId: 'ws-1',
          userId: 'user-1',
          generationJobId: 'job-1',
          type: 'IMAGE',
          storageProvider: 'aws_s3',
          bucket: 'test-bucket',
          objectKey: 'images/2026/08/26/abc.png',
          mimeType: 'image/png',
          size: 12345,
          width: 1024,
          height: 768,
          duration: null,
          metadata: { source: 'agnes' },
          createdAt: NOW,
        },
      ],
      'sel:price_quotes': () => [],
      'sel:credit_reservations': () => [],
      'sel:usage_events': () => [],
      'sel:generation_attempts': () => [],
      'sel:provider_credentials': () => [],
      'sel:generation_dispatch_outbox': () => [],
      'sel:cost_events': () => [],
    });
    const svc = new GenerationsAdminService(db as any, {} as any, {} as any);

    const detail = await svc.detail('job-1');

    expect(detail.assets).toHaveLength(1);
    const asset = detail.assets[0];
    expect(asset.id).toBe('asset-1');
    expect(asset.type).toBe('IMAGE');
    expect(asset.mimeType).toBe('image/png');
    expect(asset.width).toBe(1024);
    expect(asset.height).toBe(768);
    expect(asset.displayUrl).toBe('https://cdn.example.test/image.png');
    // Ensure storage details are not exposed
    const json = JSON.stringify(detail.assets);
    expect(json).not.toContain('objectKey');
    expect(json).not.toContain('object_key');
    expect(json).not.toContain('test-bucket');
  });

  it('Case 5: user=null and credential=null when records do not exist (no 500)', async () => {
    const db = createDb({
      'sel:generation_jobs': () => [baseJob],
      'sel:users': () => [], // user not found
      'sel:assets': () => [],
      'sel:price_quotes': () => [],
      'sel:credit_reservations': () => [],
      'sel:usage_events': () => [],
      'sel:generation_attempts': () => [
        {
          id: 'att-1',
          generationJobId: 'job-1',
          attemptNo: 1,
          provider: 'agnes',
          model: 'agnes-image-2.1',
          credentialId: 'cred-deleted',
          providerJobId: null,
          status: 'SUCCEEDED',
          startedAt: NOW,
          endedAt: NOW,
          errorCode: null,
          errorMessage: null,
          estimatedCostMicrousd: 500,
          reportedCostMicrousd: 0,
          metadata: null,
        },
      ],
      'sel:provider_credentials': () => [], // credential deleted
      'sel:generation_dispatch_outbox': () => [],
      'sel:cost_events': () => [],
    });
    const svc = new GenerationsAdminService(db as any, {} as any, {} as any);

    // Should not throw
    const detail = await svc.detail('job-1');

    expect(detail.user).toBeNull();
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0].credentialId).toBe('cred-deleted');
    expect(detail.attempts[0].credential).toBeNull();
  });

  it('Case 5b: attempt with credentialId=null shows credential=null (historical compatibility)', async () => {
    const db = createDb({
      'sel:generation_jobs': () => [baseJob],
      'sel:users': () => [{ id: 'user-1', email: 'test@example.com', role: 'USER', status: 'ACTIVE' }],
      'sel:assets': () => [],
      'sel:price_quotes': () => [],
      'sel:credit_reservations': () => [],
      'sel:usage_events': () => [],
      'sel:generation_attempts': () => [
        {
          id: 'att-old',
          generationJobId: 'job-1',
          attemptNo: 1,
          provider: 'agnes',
          model: 'agnes-image-2.1',
          credentialId: null, // historical attempt without credential
          providerJobId: null,
          status: 'SUCCEEDED',
          startedAt: NOW,
          endedAt: NOW,
          errorCode: null,
          errorMessage: null,
          estimatedCostMicrousd: 500,
          reportedCostMicrousd: 0,
          metadata: null,
        },
      ],
      'sel:provider_credentials': () => [],
      'sel:generation_dispatch_outbox': () => [],
      'sel:cost_events': () => [],
    });
    const svc = new GenerationsAdminService(db as any, {} as any, {} as any);

    const detail = await svc.detail('job-1');

    expect(detail.attempts[0].credentialId).toBeNull();
    expect(detail.attempts[0].credential).toBeNull();
  });

  it('preserves existing fields (userId, workspaceId) for backward compatibility', async () => {
    const db = createDb({
      'sel:generation_jobs': () => [baseJob],
      'sel:users': () => [{ id: 'user-1', email: 'test@example.com', role: 'USER', status: 'ACTIVE' }],
      'sel:assets': () => [],
      'sel:price_quotes': () => [],
      'sel:credit_reservations': () => [],
      'sel:usage_events': () => [],
      'sel:generation_attempts': () => [],
      'sel:provider_credentials': () => [],
      'sel:generation_dispatch_outbox': () => [],
      'sel:cost_events': () => [],
    });
    const svc = new GenerationsAdminService(db as any, {} as any, {} as any);

    const detail = await svc.detail('job-1');

    // Existing fields must still be present
    expect(detail.userId).toBe('user-1');
    expect(detail.workspaceId).toBe('ws-1');
    expect(detail.id).toBe('job-1');
    expect(detail.type).toBe('IMAGE');
    expect(detail.status).toBe('SUCCEEDED');
  });
});
