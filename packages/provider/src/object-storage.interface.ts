/**
 * 对象存储抽象：支持 S3-compatible 与七牛，保留现有设计。
 * DB 只保存 bucket + object_key，访问时动态生成 URL / presigned URL。
 */

export interface StorageUploadInput {
  mediaType: 'image' | 'video' | 'document' | 'other';
  ext?: string;
  contentType?: string;
}

export interface StorageUploadResult {
  provider: string;
  key: string;
  url?: string; // 公开/CDN 稳定 URL；私有 bucket 为空，读取时生成 presigned URL
  size: number;
}

export interface ObjectStorage {
  readonly provider: string;
  uploadBytes(data: Buffer, input?: StorageUploadInput): Promise<StorageUploadResult | null>;
  uploadFromUrl(sourceUrl: string, input?: StorageUploadInput): Promise<StorageUploadResult | null>;
  /** 从临时文件流式上传（无需整体载入内存），适合大视频。 */
  uploadFile(filePath: string, input?: StorageUploadInput): Promise<StorageUploadResult | null>;
  getDisplayUrl(key: string): Promise<string>;
  /** P0-3: 删除对象（用于资源清理）。不存在时静默成功。 */
  deleteObject(key: string): Promise<void>;
  /** P0-3: 检查对象是否存在。 */
  objectExists(key: string): Promise<boolean>;
}

/** 兼容性入口：根据配置返回当前 ObjectStorage 实例。由 DI 提供。 */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');