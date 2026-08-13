import type { ObjectStorage } from '../object-storage.interface.js';
import { S3ObjectStorage, type S3StorageConfig } from './s3.js';
import { NoneObjectStorage } from './none.js';

export type StorageKind = 'none' | 's3';

export interface StorageFactoryConfig {
  kind: StorageKind;
  s3?: S3StorageConfig;
}

const SUPPORTED_KINDS: readonly StorageKind[] = ['none', 's3'];

/**
 * 根据配置创建 ObjectStorage 实例。
 * 仅支持 s3 / none。传入不支持的 provider（如历史遗留的 qiniu）会 throw，
 * 不会 silent fallback。
 */
export function createObjectStorage(cfg: StorageFactoryConfig): ObjectStorage {
  if (!SUPPORTED_KINDS.includes(cfg.kind)) {
    throw new Error(
      `Unsupported storage provider "${cfg.kind}". ` +
      `Supported providers: ${SUPPORTED_KINDS.join(', ')}. ` +
      `If you previously used "qiniu", please update storage.provider to "none" or "s3" in the admin settings.`,
    );
  }
  if (cfg.kind === 's3' && cfg.s3) return new S3ObjectStorage(cfg.s3);
  return new NoneObjectStorage();
}

export { S3ObjectStorage, NoneObjectStorage };
export type { S3StorageConfig };