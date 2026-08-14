import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStorage, StorageUploadInput, StorageUploadResult } from '../object-storage.interface.js';
import { downloadToTempFile, cleanupTempFile, type UrlGuardOptions } from './downloader.js';

/**
 * AWS S3 对象存储实现。
 * - Base URL / 上游 URL 经 SSRF 校验。
 * - 大文件通过临时文件流式上传，避免整块载入内存。
 * - 私有 bucket：DB 只存 object key，展示时动态生成 presigned URL。
 */
export interface S3StorageConfig {
  region: string;
  bucket: string;
  prefix?: string;
  publicBaseUrl?: string;
  endpointUrl?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  /** 下载上游结果时的 SSRF/大小/超时限制。 */
  download: {
    guard: UrlGuardOptions;
    maxBytes: number;
    timeoutMs: number;
  };
  /** 下载 MIME 白名单前缀。 */
  allowedContentTypePrefixes: string[];
}

const MEDIA_DIRS: Record<string, string> = {
  image: 'images',
  video: 'videos',
  document: 'documents',
  other: 'other',
  img: 'images',
};

function buildObjectKey(prefix: string, mediaType: string, ext: string): string {
  const dir = MEDIA_DIRS[mediaType] ?? 'other';
  const safeExt = (ext || 'bin').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'bin';
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const key = `${prefix}/${dir}/${y}/${m}/${d}/${randomHex()}.${safeExt}`;
  return key.replace(/\/{2,}/g, '/').replace(/^\//, '');
}

function randomHex(): string {
  return randomBytes(16).toString('hex');
}

export class S3ObjectStorage implements ObjectStorage {
  readonly provider = 'aws_s3';
  private readonly client: S3Client;

  constructor(private readonly cfg: S3StorageConfig) {
    this.client = new S3Client({
      region: cfg.region || 'us-east-1',
      endpoint: cfg.endpointUrl || undefined,
      credentials: cfg.credentials,
    });
  }

  async uploadBytes(data: Buffer, input?: StorageUploadInput): Promise<StorageUploadResult | null> {
    const ct = input?.contentType || guessContentType(input?.ext || 'bin');
    const key = buildObjectKey(this.cfg.prefix ?? '', input?.mediaType || 'other', input?.ext || detectExt(ct));
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: data, ContentType: ct }),
    );
    return { provider: this.provider, key, url: this.publicUrl(key), size: data.byteLength };
  }

  async uploadFromUrl(sourceUrl: string, input?: StorageUploadInput): Promise<StorageUploadResult | null> {
    const dl = await downloadToTempFile(sourceUrl, {
      guard: this.cfg.download.guard,
      maxBytes: this.cfg.download.maxBytes,
      timeoutMs: this.cfg.download.timeoutMs,
      allowedContentTypePrefixes: this.cfg.allowedContentTypePrefixes,
    });
    const ct = input?.contentType || dl.contentType || guessContentType(detectExt(dl.contentType));
    const ext = input?.ext || detectExt(ct);
    const mediaType = input?.mediaType || (ct.startsWith('video/') ? 'video' : ct.startsWith('image/') ? 'image' : 'other');
    const key = buildObjectKey(this.cfg.prefix ?? '', mediaType, ext);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.cfg.bucket,
          Key: key,
          Body: createReadStream(dl.filePath),
          ContentType: ct,
        }),
      );
    } finally {
      await cleanupTempFile(dl.filePath);
    }
    return { provider: this.provider, key, url: this.publicUrl(key), size: dl.size };
  }

  async uploadFile(filePath: string, input?: StorageUploadInput): Promise<StorageUploadResult | null> {
    const ct = input?.contentType || guessContentType(input?.ext || 'bin');
    const ext = input?.ext || detectExt(ct);
    const mediaType = input?.mediaType || (ct.startsWith('video/') ? 'video' : ct.startsWith('image/') ? 'image' : 'other');
    const key = buildObjectKey(this.cfg.prefix ?? '', mediaType, ext);
    const { size } = await stat(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: ct,
      }),
    );
    return { provider: this.provider, key, url: this.publicUrl(key), size };
  }

  async getDisplayUrl(key: string): Promise<string> {
    const publicUrl = this.publicUrl(key);
    if (publicUrl) return publicUrl;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }), { expiresIn: 3600 });
  }

  /** P0-3: Delete an object. Succeeds if the object doesn't exist (NotFound).
   *  Other errors (permissions, network, auth) are re-thrown. */
  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
    } catch (err) {
      // S3 DeleteObject is idempotent: NotFound means the object is already gone.
      // All other errors (AccessDenied, NetworkError, InvalidBucket, etc.) must propagate.
      const name = (err as Error).name ?? '';
      const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 0;
      if (name === 'NotFound' || name === 'NoSuchKey' || code === 404) {
        return; // Object already deleted — safe to proceed.
      }
      throw err;
    }
  }

  /** P0-3: Check if an object exists. Returns false only for NotFound.
   *  Other errors propagate so callers don't assume the object is absent. */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
      return true;
    } catch (err) {
      const name = (err as Error).name ?? '';
      const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 0;
      if (name === 'NotFound' || name === 'NoSuchKey' || code === 404) {
        return false;
      }
      throw err;
    }
  }

  private publicUrl(key: string): string {
    if (this.cfg.publicBaseUrl) return `${this.cfg.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    return '';
  }
}

function guessContentType(ext: string): string {
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
  };
  return map[(ext || '').toLowerCase()] ?? 'application/octet-stream';
}

function detectExt(contentType: string): string {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('png')) return 'png';
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('quicktime')) return 'mov';
  if (ct.includes('pdf')) return 'pdf';
  return 'bin';
}
