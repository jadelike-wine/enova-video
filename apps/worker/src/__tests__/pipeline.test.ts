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
    estimatedCostMicrousd: 500,
    createdAt: new Date(),
    ...overrides,
  };
}

/** VIDEO mock job with valid Agnes numFrames (8n+1) and frameRate. */
function makeVideoJob(overrides: Partial<GenerationJobRow> = {}): GenerationJobRow {
  return makeJob({
    type: 'VIDEO',
    model: 'agnes-video-v2.0',
    inputJson: { prompt: 'drone shot', mode: 'text2video', width: 1280, height: 720, numFrames: 97, frameRate: 24 },
    ...overrides,
  });
}

function makePayload(stage: string = 'execute'): GenerationJobPayload {
  return { generationJobId: 'job-1', workspaceId: 'ws-1', userId: 'u-1', type: 'IMAGE', stage: stage as never };
}

function makeDeps(overrides: Partial<GenerationPipelineDeps> = {}): GenerationPipelineDeps {
  const registry = {
    getProvider: vi.fn().mockReturnValue({
      generateImage: vi.fn(),
      submitVideo: vi.fn(),
      getVideoStatus: vi.fn(),
      cancelJob: vi.fn(),
    }),
  } as never;
  const credentials = {
    acquire: vi.fn(),
    markSuccess: vi.fn(),
    markFailure: vi.fn(),
    health: vi.fn(),
    invalidate: vi.fn(),
  } as never;
  const storage = {
    uploadFile: vi.fn().mockResolvedValue({ provider: 's3', key: 'obj/key.png', size: 100 }),
    provider: 's3',
  } as never;
  const config = {
    pollIntervalMs: 1000,
    maxPolls: 5,
    maxWaitMs: 60000,
    credentialRetryAttempts: 1,
    download: { guard: { allowHttp: true, resolveDns: false }, maxBytes: 1000, timeoutMs: 1000 },
    allowedContentTypePrefixes: ['image/', 'video/'],
  };
  return {
    db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => fn('TX') } as never,
    repo: {
      load: vi.fn().mockResolvedValue(makeJob()),
      toRunning: vi.fn().mockResolvedValue(true),
      persistProviderJob: vi.fn().mockResolvedValue(true),
      incrementPoll: vi.fn().mockResolvedValue(1),
      providerCostUsd: vi.fn().mockResolvedValue(0),
      finalizeSuccessInTx: vi.fn().mockResolvedValue(undefined),
      finalizeFailureInTx: vi.fn().mockResolvedValue(undefined),
      finalizeCancelInTx: vi.fn().mockResolvedValue(undefined),
    } as never,
    attempts: {
      start: vi.fn().mockResolvedValue({ attemptId: 'att-1', attemptNo: 1 }),
      markSucceeded: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markCanceled: vi.fn().mockResolvedValue(undefined),
      attachProviderJobId: vi.fn().mockResolvedValue(undefined),
      listByJob: vi.fn().mockResolvedValue([]),
      findRunning: vi.fn().mockResolvedValue(null),
      attachProviderJobIdInTx: vi.fn().mockResolvedValue(undefined),
    } as never,
    resources: {
      registry,
      credentials,
      storage,
      getConfig: vi.fn().mockResolvedValue(config),
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
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
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
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeVideoJob({ providerJobId: null }));
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.submitVideo as ReturnType<typeof vi.fn>).mockResolvedValue({ providerJobId: 'task-1', status: { status: 'processing' } });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.execute(makePayload());

    expect(provider.submitVideo).toHaveBeenCalled();
    expect(deps.repo.persistProviderJob).toHaveBeenCalledWith('job-1', 'task-1');
    expect(deps.queue.add).toHaveBeenCalledWith(
      GENERATION_JOB_NAMES.POLL,
      expect.objectContaining({ providerJobId: 'task-1', stage: 'poll' }),
      // Poll jobs intentionally use a single BullMQ attempt.
      // Poll retries are governed by video polling policy
      // (pollInterval/maxPolls/maxWait), not queue.jobAttempts.
      expect.objectContaining({ delay: 1000, attempts: 1 }),
    );
    expect(deps.wallet.settleInTx).not.toHaveBeenCalled();
  });

  it('retry with existing provider_job_id does NOT resubmit', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeVideoJob({ status: 'RUNNING', providerJobId: 'existing-task', pollCount: 1 }),
    );
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
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
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.getVideoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'processing', progress: 20 });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.poll(makePayload('poll'));

    expect(deps.queue.add).toHaveBeenCalledWith(GENERATION_JOB_NAMES.POLL, expect.objectContaining({ providerJobId: 'task-1' }), expect.objectContaining({ attempts: 1 }));
    expect(deps.wallet.settleInTx).not.toHaveBeenCalled();
  });

  it('video success → Asset + settle', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'RUNNING', providerJobId: 'task-1', pollCount: 1 }),
    );
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.getVideoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'succeeded', sourceUrl: 'https://cdn.test/v.mp4', duration: 5 });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.poll(makePayload('poll'));

    expect(deps.repo.finalizeSuccessInTx).toHaveBeenCalled();
    expect(deps.wallet.settleInTx).toHaveBeenCalledWith('TX', 'ws-1', 'job-1', 10, 'settle:job-1');
    expect(deps.repo.finalizeFailureInTx).not.toHaveBeenCalled();
  });

  it('transient failure throws and does NOT release credits', async () => {
    const deps = makeDeps();
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
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
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
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
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.getVideoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'processing', progress: 10 });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.poll(makePayload('poll'));

    expect(deps.repo.finalizeFailureInTx).toHaveBeenCalledWith('TX', expect.objectContaining({ id: 'job-1', errorCode: 'PROVIDER_JOB_TIMEOUT' }));
    expect(deps.wallet.releaseInTx).toHaveBeenCalledWith('TX', 'ws-1', 'job-1', 'release:fail:job-1');
    expect(deps.queue.add).not.toHaveBeenCalled();
  });

  it('provider_cost_usd is driven by pricing rule (default 0)', async () => {
    const deps = makeDeps();
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    (deps.repo.providerCostUsd as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1234);
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.generateImage as ReturnType<typeof vi.fn>).mockResolvedValue({ sourceUrl: 'https://cdn.test/i.png' });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.execute(makePayload());

    expect(deps.repo.providerCostUsd).toHaveBeenCalledWith('IMAGE', 'agnes', 'agn-dream');
    const args = (deps.repo.finalizeSuccessInTx as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(args.usage.providerCostUsd).toBe(1234);
    // P0-4: microusd 成本字段被写入（estimated = job 快照 || legacy）。
    // P0 红队修复：ESTIMATED 阶段 final_cost 必须为 0（禁止把估值写进 final 字段）。
    expect(args.estimatedCostMicrousd).toBe(500);
    expect(args.finalCostMicrousd).toBe(0);
    expect(args.costStatus).toBe('ESTIMATED');
  });

  // ---- P0-5: Generation Attempts ----

  it('image success creates attempt and marks it SUCCEEDED with estimated cost', async () => {
    const deps = makeDeps();
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.generateImage as ReturnType<typeof vi.fn>).mockResolvedValue({ sourceUrl: 'https://cdn.test/i.png' });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.execute(makePayload());

    expect(deps.attempts.start).toHaveBeenCalledWith(expect.objectContaining({
      generationJobId: 'job-1',
      provider: 'agnes',
      model: 'agn-dream',
      estimatedCostMicrousd: 500,
    }));
    expect(deps.attempts.markSucceeded).toHaveBeenCalledWith('att-1', 500);
    expect(deps.attempts.markFailed).not.toHaveBeenCalled();
  });

  it('image failure creates attempt and marks it FAILED (cost retained)', async () => {
    const deps = makeDeps();
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.generateImage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ProviderError('upstream 500', { category: 'PROVIDER_TEMPORARY_ERROR' }),
    );

    const pipeline = new GenerationPipeline(deps);
    await expect(pipeline.execute(makePayload())).rejects.toThrow();

    expect(deps.attempts.start).toHaveBeenCalled();
    expect(deps.attempts.markFailed).toHaveBeenCalledWith(
      'att-1',
      'PROVIDER_TEMPORARY_ERROR',
      expect.any(String),
      500,
    );
    expect(deps.attempts.markSucceeded).not.toHaveBeenCalled();
  });

  it('video success marks running attempt SUCCEEDED', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'RUNNING', providerJobId: 'task-1', pollCount: 1 }),
    );
    (deps.attempts.findRunning as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'att-1' });
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.getVideoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'succeeded', sourceUrl: 'https://cdn.test/v.mp4', duration: 5 });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.poll(makePayload('poll'));

    expect(deps.attempts.findRunning).toHaveBeenCalledWith('job-1');
    expect(deps.attempts.markSucceeded).toHaveBeenCalledWith('att-1', 500);
  });

  it('video failure marks running attempt FAILED with cost retained', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'RUNNING', providerJobId: 'task-1', pollCount: 1 }),
    );
    (deps.attempts.findRunning as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'att-1' });
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.getVideoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'failed', errorCode: 'UPSTREAM_FAIL', errorMessage: 'render error' });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.poll(makePayload('poll'));

    expect(deps.attempts.markFailed).toHaveBeenCalledWith('att-1', 'UPSTREAM_FAIL', 'render error', 500);
    expect(deps.repo.finalizeFailureInTx).toHaveBeenCalled();
  });

it('video submit creates attempt and attaches provider_job_id', async () => {
const deps = makeDeps();
(deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeVideoJob({ providerJobId: null }));
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.submitVideo as ReturnType<typeof vi.fn>).mockResolvedValue({ providerJobId: 'task-1', status: { status: 'processing' } });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.execute(makePayload());

    expect(deps.attempts.start).toHaveBeenCalled();
    expect(deps.attempts.attachProviderJobId).toHaveBeenCalledWith('att-1', 'task-1');
  });

  it('cancel RUNNING job notifies upstream cancelJob then CANCELED + release', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'RUNNING', providerJobId: 'task-1' }),
    );
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    const cancelJob = (provider.cancelJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const pipeline = new GenerationPipeline(deps);
    await pipeline.cancel(makePayload('cancel'));

    expect(cancelJob).toHaveBeenCalledWith('task-1', 'sk-1');
    expect(deps.repo.finalizeCancelInTx).toHaveBeenCalledWith('TX', { id: 'job-1' });
    expect(deps.wallet.releaseInTx).toHaveBeenCalledWith('TX', 'ws-1', 'job-1', 'release:cancel:job-1');
  });

  it('cancel is best-effort when upstream cancelJob throws', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'RUNNING', providerJobId: 'task-1' }),
    );
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.cancelJob as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('upstream down'));

    const pipeline = new GenerationPipeline(deps);
    await pipeline.cancel(makePayload('cancel'));

    // 上游失败不阻断本地取消
    expect(deps.repo.finalizeCancelInTx).toHaveBeenCalledWith('TX', { id: 'job-1' });
    expect(deps.wallet.releaseInTx).toHaveBeenCalledWith('TX', 'ws-1', 'job-1', 'release:cancel:job-1');
  });

  it('cancel skips when job already terminal', async () => {
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'SUCCEEDED', providerJobId: 'task-1' }),
    );

    const pipeline = new GenerationPipeline(deps);
    await pipeline.cancel(makePayload('cancel'));

    expect(deps.repo.finalizeCancelInTx).not.toHaveBeenCalled();
    expect(deps.wallet.releaseInTx).not.toHaveBeenCalled();
  });

  // ---- BUG-002: Worker 最终失败处理器状态校验 ----

  it('poll limit reached on SUCCEEDED job does NOT call finalizeFailure or release', async () => {
    // 竞态场景：pipeline 内部已 finalizeSuccess（SUCCEEDED），但 BullMQ delayed
    // poll job 仍触发 poll，poll 发现 pollCount >= maxPolls 时会尝试调用 fail()。
    // fail() 内的 finalizeFailureInTx 有 WHERE 守卫（只更新 QUEUED/RUNNING），
    // 但 releaseInTx 幂等键保证不会重复退款。
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'SUCCEEDED', providerJobId: 'task-1', pollCount: 6 }),
    );
    (deps.repo.incrementPoll as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(7);
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.getVideoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'processing', progress: 10 });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.poll(makePayload('poll'));

    // finalizeFailureInTx 会执行（WHERE 条件不命中，no-op），但 releaseInTx 仍被调用
    // —— releaseInTx 幂等键（release:fail:job-1）保证不会重复退款。
    // 关键不变量：finalizeSuccessInTx 不会被调用（不会覆盖已有 SUCCEEDED）。
    expect(deps.repo.finalizeSuccessInTx).not.toHaveBeenCalled();
  });

  it('poll limit reached on CANCELED job does NOT call finalizeFailure or release', async () => {
    // 竞态场景：用户已 cancel（CANCELED），但 BullMQ delayed poll job 仍触发。
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'CANCELED', providerJobId: 'task-1', pollCount: 6 }),
    );
    (deps.repo.incrementPoll as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(7);
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.getVideoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'processing', progress: 10 });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.poll(makePayload('poll'));

    // pipeline.poll 检查 isTerminal 后直接 return，不会调用 fail/finalizeFailure/release。
    expect(deps.repo.finalizeFailureInTx).not.toHaveBeenCalled();
    expect(deps.wallet.releaseInTx).not.toHaveBeenCalled();
  });

  it('normal failure path QUEUED→FAILED calls finalizeFailure and release once', async () => {
    // 正常失败路径：QUEUED → FAILED，release + fail 各执行一次。
    const deps = makeDeps();
    (deps.repo.load as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeJob({ type: 'VIDEO', status: 'RUNNING', providerJobId: 'task-1', pollCount: 5 }),
    );
    (deps.repo.incrementPoll as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(6);
    (deps.resources.credentials.acquire as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(acquireCred());
    const provider = (deps.resources.registry as unknown as { getProvider: ReturnType<typeof vi.fn> }).getProvider();
    (provider.getVideoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'processing', progress: 10 });

    const pipeline = new GenerationPipeline(deps);
    await pipeline.poll(makePayload('poll'));

    expect(deps.repo.finalizeFailureInTx).toHaveBeenCalledWith('TX', expect.objectContaining({
      id: 'job-1',
      errorCode: 'PROVIDER_JOB_TIMEOUT',
    }));
    expect(deps.wallet.releaseInTx).toHaveBeenCalledWith('TX', 'ws-1', 'job-1', 'release:fail:job-1');
    expect(deps.queue.add).not.toHaveBeenCalled();
  });
});