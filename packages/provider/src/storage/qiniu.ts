import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { ObjectStorage, StorageUploadInput, StorageUploadResult } from '../object-storage.interface.js';
import { cleanupTempFile, downloadToTempFile, type UrlGuardOptions } from './downloader.js';

export interface QiniuStorageConfig {
  accessKey: string;
  secretKey: string;
  bucket: string;
  domain: string;
  region: string;
  prefix?: string;
  download: {
    guard: UrlGuardOptions;
    maxBytes: number;
    timeoutMs: number;
  };
  allowedContentTypePrefixes: string[];
}

const UPLOAD_ENDPOINTS: Record<string, string> = {
  z0: 'https://upload.qiniup.com',
  z1: 'https://upload-z1.qiniup.com',
  z2: 'https://upload-z2.qiniup.com',
  na0: 'https://upload-na0.qiniup.com',
  as0: 'https://upload-as0.qiniup.com',
};

const MEDIA_DIRS: Record<string, string> = {
  image: 'images',
  video: 'videos',
  document: 'documents',
  other: 'other',
};

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildKey(prefix: string, mediaType: string, ext: string): string {
  const dir = MEDIA_DIRS[mediaType] ?? 'other';
  const safePrefix = prefix.replace(/^\/+|\/+$/g, '');
  const safeExt = (ext || 'bin').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'bin';
  const key = `${safePrefix ? `${safePrefix}/` : ''}${dir}/${new Date().toISOString().slice(0, 10)}/${randomBytes(16).toString('hex')}.${safeExt}`;
  return key.replace(/\/{2,}/g, '/');
}

function uploadToken(cfg: QiniuStorageConfig, key: string): string {
  const policy = JSON.stringify({ scope: `${cfg.bucket}:${key}`, deadline: Math.floor(Date.now() / 1000) + 3600 });
  const encodedPolicy = base64Url(Buffer.from(policy));
  const signature = base64Url(createHmac('sha1', cfg.secretKey).update(encodedPolicy).digest());
  return `${cfg.accessKey}:${signature}:${encodedPolicy}`;
}

function publicUrl(domain: string, key: string): string {
  return `${domain.replace(/\/$/, '')}/${key}`;
}

export class QiniuObjectStorage implements ObjectStorage {
  readonly provider = 'qiniu';

  constructor(private readonly cfg: QiniuStorageConfig) {}

  async uploadBytes(data: Buffer, input?: StorageUploadInput): Promise<StorageUploadResult | null> {
    const key = buildKey(this.cfg.prefix ?? '', input?.mediaType ?? 'other', input?.ext ?? 'bin');
    const form = new FormData();
    form.set('token', uploadToken(this.cfg, key));
    form.set('key', key);
    form.set('file', new Blob([data], { type: input?.contentType ?? 'application/octet-stream' }), key);
    const response = await fetch(UPLOAD_ENDPOINTS[this.cfg.region] ?? UPLOAD_ENDPOINTS.z0, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`Qiniu upload failed: HTTP ${response.status}`);
    return { provider: this.provider, key, url: publicUrl(this.cfg.domain, key), size: data.byteLength };
  }

  async uploadFromUrl(sourceUrl: string, input?: StorageUploadInput): Promise<StorageUploadResult | null> {
    const downloaded = await downloadToTempFile(sourceUrl, {
      guard: this.cfg.download.guard,
      maxBytes: this.cfg.download.maxBytes,
      timeoutMs: this.cfg.download.timeoutMs,
      allowedContentTypePrefixes: this.cfg.allowedContentTypePrefixes,
    });
    try {
      return await this.uploadFile(downloaded.filePath, {
        mediaType: input?.mediaType ?? 'other',
        ext: input?.ext,
        contentType: input?.contentType ?? downloaded.contentType,
      });
    } finally {
      await cleanupTempFile(downloaded.filePath);
    }
  }

  async uploadFile(filePath: string, input?: StorageUploadInput): Promise<StorageUploadResult | null> {
    const data = await readFile(filePath);
    return this.uploadBytes(data, input);
  }

  async getDisplayUrl(key: string): Promise<string> {
    return publicUrl(this.cfg.domain, key);
  }

  async objectExists(key: string): Promise<boolean> {
    const response = await fetch(publicUrl(this.cfg.domain, key), { method: 'HEAD', redirect: 'manual' });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`Qiniu object check failed: HTTP ${response.status}`);
    return true;
  }

  async deleteObject(key: string): Promise<void> {
    const path = `/delete/${base64Url(Buffer.from(`${this.cfg.bucket}:${key}`))}`;
    const authorization = `QBox ${this.cfg.accessKey}:${base64Url(createHmac('sha1', this.cfg.secretKey).update(`${path}\n`).digest())}`;
    const response = await fetch(`https://rs.qiniu.com${path}`, { method: 'POST', headers: { Authorization: authorization } });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Qiniu object delete failed: HTTP ${response.status}`);
  }
}
