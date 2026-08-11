import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERATION_JOB_NAMES } from '@enova/contracts';
import { ProviderError } from '@enova/provider';
import { GenerationPipeline, type GenerationPipelineDeps } from '../generation/pipeline.js';
import type { GenerationJobRow } from '../generation/repo.js';
import type { GenerationJobPayload } from '@enova/contracts';

// 只 mock 两个下载工具函数，其余模块原样保留。
vi.mock('@enova/provider', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    downloadToTempFile: vi.fn(),
    cleanupTempFile: vi.fn(),
  };
});

const downloadToTempFile = vi.mocked((await import('@enova/provider')).downloadToTempFile);
const cleanupTempFile = vi.mocked((await import('@enova/provider')).cleanupTempFile);

function makeJob(overrides: Partial<GenerationJobRow> = {}): GenerationJobRow {
  return {
    id: 'job-1',
    workspaceId: 'ws-1',
    userId: 'u-1',
    type: 'IMAGE',
    status: 'QUEUED',
    provider: 'agnes',
    model: 'agn-dream',
    inputJson: { prompt: 'hello' },
    providerJobId: null,
    providerStartedAt: null,
    pollCount: 0,
    reservedCredits: 10,
    createdAt: new Date(),
    ...overrides,
  };
}

function makePayload(stage: string = 'execute'): GenerationJobPayload {
  return { generationJobId: 'job-1', workspaceId: 'ws-1', userId: 'u-1', type: 'IMAGE', stage: stage as never };
}

function makeDeps(overrides: Partial<GenerationPipelineDeps> = {}): GenerationPipelineDeps {
  return {
    db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => fn('TX') } as never,
    repo: {
      load: vi.fn().mockResolvedValue(makeJob()),
      toRunning: vi.fn().mockResolvedValue(true),
      persistProviderJob: vi.fn().mockResolvedValue(true),
      incrementPoll: vi.fn().mockResolvedValue(1),
      finalizeSuccessInTx: vi.fn().mockResolvedValue(undefined),
      finalizeFailureInTx: vi.fn().mockResolvedValue(undefined),
    } as never,
    registry: {
      getProvider: vi.fn().mockReturnValue({
        generateImage: vi.fn(),
        submitVideo: vi.fn(),
        getVideoStatus: vi.fn(),
        cancelJob: vi.fn(),
      }),
    } as never,
    credentials: {
      acquire: vi.fn(),
      markSuccess: vi.fn(),
      markFailure: vi.fn(),
      health: vi.fn(),
      invalidate: vi.fn(),
    } as never,
    storage: {
      uploadFile: vi.fn().mockResolvedValue({ provider: 's3', key: 'obj/key.png', size: 100 }),
      provider: 's3',
    } as never,
    wallet: {
      settleInTx: vi.fn().mockResolvedValue(undefined),
      releaseInTx: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    } as never,
    queue: { add: vi.fn().mockResolvedValue(undefined) } as never,
    logger: {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    } as never,
    config: {
      pollIntervalMs: 1000,
      maxPolls: 5,
      maxWaitMs: 60000,
      credentialRetryAttempts: 1,
      download: { guard: { allowHttp: true, resolveDns: false }, maxBytes: 1000, timeoutMs: 1000 },
      allowedContentTypePrefixes: ['image/', 'video/'],
    },
    ...overrides,
  } as unknown as GenerationPipelineDeps;
}

function acquireCred(secret = 'sk-1') {
  return { credentialId: 'c1', providerCode: 'agnes', secret, release: vi.fn().mockResolvedValue(undefined) };
}

describe('GenerationPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downloadToTempFile.mockReset();
    cleanupTempFile.mockReset();
    downloadToTempFile.mockResolvedValue({ filePath: '/tmp/x.png', contentType: 'image/png', size: 100 });
    cleanupTempFile.mockResolvedValue(undefined);
  });

  it('image success → Asset + Usage + settle + SUCCEEDED', async () => {
    const deps = makeDeps();
    (deps.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.generateImage as ReturnType<typeof vi.fn>).mockResolvedValue({ sourceUrl: 'https://cdn.test/i.png' });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.execute(makePayload());

    expect(deps.repo.finalizeSuccessInTx).toHaveBeenCalled();
    expect(deps.wallet.settleInTx).toHaveBeenCalledWith('TX', 'ws-1', 'job-1', 10, 'settle:job-1');
    expect(downloadToTempFile).toHaveBeenCalledWith('https://cdn.test/i.png', expect.objectContaining({ allowedContentTypePrefixes: expect.any(Array) }));
    expect(deps.repo.finalizeFailureInTx).not.toHaveBeenCalled();
  });

  it('video submit stores provider_job_id and schedules delayed poll', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({ type: 'VIDEO', providerJobId: null }));
    (deps.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.submitVideo as ReturnType<typeof vi.fn>).mockResolvedValue({ providerJobId: 'task-1', status: { status: 'processing' } });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.execute(makePayload());

    expect(provider.submitVideo).toHaveBeenCalled();
    expect(deps.repo.persistProviderJob).toHaveBeenCalledWith('job-1', 'task-1');
    expect(deps.queue.add).toHaveBeenCalledWith(
      GENERATION_JOB_NAMES.POLL,
      expect.objectContaining({ providerJobId: 'task-1', stage: 'poll' }),
      expect.objectContaining({ delay: 1000 }),
    );
    expect(deps.wallet.settleInTx).not.toHaveBeenCalled();
  });

  it('retry with existing provider_job_id does NOT resubmit', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'RUNNING', providerJobId: 'existing-task', pollCount: 1 }),
    );
    const provider = (deps.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.submitVideo as ReturnType<typeof vi.fn>).mockResolvedValue({ providerJobId: 'should-not-call', status: { status: 'processing' } });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.execute(makePayload());

    expect(provider.submitVideo).not.toHaveBeenCalled();
    expect(deps.repo.persistProviderJob).not.toHaveBeenCalled();
    expect(deps.queue.add).toHaveBeenCalled();
  });

  it('video processing in poll schedules next poll', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'RUNNING', providerJobId: 'task-1', pollCount: 1 }),
    );
    (deps.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.getVideoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'processing', progress: 20 });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.poll(makePayload('poll'));

    expect(deps.queue.add).toHaveBeenCalledWith(GENERATION_JOB_NAMES.POLL, expect.objectContaining({ providerJobId: 'task-1' }), expect.anything());
    expect(deps.wallet.settleInTx).not.toHaveBeenCalled();
  });

  it('video success → Asset + settle', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'RUNNING', providerJobId: 'task-1', pollCount: 1 }),
    );
    (deps.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.getVideoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'succeeded', sourceUrl: 'https://cdn.test/v.mp4', duration: 5 });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.poll(makePayload('poll'));

    expect(deps.repo.finalizeSuccessInTx).toHaveBeenCalled();
    expect(deps.wallet.settleInTx).toHaveBeenCalledWith('TX', 'ws-1', 'job-1', 10, 'settle:job-1');
    expect(deps.repo.finalizeFailureInTx).not.toHaveBeenCalled();
  });

  it('transient failure throws and does NOT release credits', async () => {
    const deps = makeDeps();
    (deps.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.generateImage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ProviderError('upstream 500', { category: 'PROVIDER_TEMPORARY_ERROR' }),
    );

    const pipeline = new GenerationPipeline(deps);
    await expect(pipeline.execute(makePayload())).rejects.toThrow();

    expect(deps.wallet.releaseInTx).not.toHaveBeenCalled();
    expect(deps.repo.finalizeFailureInTx).not.toHaveBeenCalled();
    // credential release 仍被调用（finally 保证）
    expect(acquireCred().release).toBeDefined();
  });

  it('permanent bad request fails and releases credits', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeJob({ type: 'IMAGE' }));
    (deps.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.generateImage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ProviderError('bad input', { category: 'PROVIDER_BAD_REQUEST' }),
    );

    const pipeline = new GenerationPipeline(deps);
    await expect(pipeline.execute(makePayload())).rejects.toThrow();

    expect(deps.wallet.releaseInTx).not.toHaveBeenCalled(); // bad request 也走 BullMQ retry 语义（无 key 切换）
    expect(deps.repo.finalizeFailureInTx).not.toHaveBeenCalled();
  });

  it('poll limit reached fails and releases once', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'RUNNING', providerJobId: 'task-1', pollCount: 5 }),
    );
    (deps.repo.incrementPoll as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(6); // >= maxPolls(5)
    (deps.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.getVideoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'processing', progress: 10 });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.poll(makePayload('poll'));

    expect(deps.repo.finalizeFailureInTx).toHaveBeenCalledWith('TX', expect.objectContaining({ id: 'job-1', errorCode: 'PROVIDER_JOB_TIMEOUT' }));
    expect(deps.wallet.releaseInTx).toHaveBeenCalledWith('TX', 'ws-1', 'job-1', 'release:fail:job-1');
    expect(deps.queue.add).not.toHaveBeenCalled();
  });
});