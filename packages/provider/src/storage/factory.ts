import type { ObjectStorage } from '../object-storage.interface.js';
import { S3ObjectStorage, type S3StorageConfig } from './s3.js';
import { NoneObjectStorage } from './none.js';
import { QiniuObjectStorage, type QiniuStorageConfig } from './qiniu.js';

export type StorageKind = 'none' | 'aws_s3' | 'qiniu' | 's3';

export interface StorageFactoryConfig {
  kind: StorageKind;
  s3?: S3StorageConfig;
  qiniu?: QiniuStorageConfig;
}

const SUPPORTED_KINDS: readonly StorageKind[] = ['none', 'aws_s3', 'qiniu', 's3'];

/**
 * 根据配置创建 ObjectStorage 实例。
 * 支持 AWS S3、七牛云和 none；s3 仅作为旧版本兼容别名。
 */
export function createObjectStorage(cfg: StorageFactoryConfig): ObjectStorage {
  if (!SUPPORTED_KINDS.includes(cfg.kind)) {
    throw new Error(
      `Unsupported storage provider "${cfg.kind}". ` +
      `Supported providers: aws_s3, qiniu, none.`,
    );
  }
  if ((cfg.kind === 'aws_s3' || cfg.kind === 's3') && cfg.s3) return new S3ObjectStorage(cfg.s3);
  if (cfg.kind === 'qiniu' && cfg.qiniu) return new QiniuObjectStorage(cfg.qiniu);
  return new NoneObjectStorage();
}

export { S3ObjectStorage, NoneObjectStorage, QiniuObjectStorage };
export type { S3StorageConfig, QiniuStorageConfig };
