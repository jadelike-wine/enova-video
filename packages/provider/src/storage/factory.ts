import type { ObjectStorage } from '../object-storage.interface.js';
import { S3ObjectStorage, type S3StorageConfig } from './s3.js';
import { NoneObjectStorage } from './none.js';

export type StorageKind = 'none' | 's3';

export interface StorageFactoryConfig {
  kind: StorageKind;
  s3?: S3StorageConfig;
}

/**
 * 根据配置创建 ObjectStorage 实例。
 * 生产可使用任意 Provider（s3 / qiniu / none），业务层只依赖 ObjectStorage 抽象。
 */
export function createObjectStorage(cfg: StorageFactoryConfig): ObjectStorage {
  if (cfg.kind === 's3' && cfg.s3) return new S3ObjectStorage(cfg.s3);
  return new NoneObjectStorage();
}

export { S3ObjectStorage, NoneObjectStorage };
export type { S3StorageConfig };