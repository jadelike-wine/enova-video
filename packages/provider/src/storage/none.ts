import type { ObjectStorage, StorageUploadInput, StorageUploadResult } from '../object-storage.interface.js';

/**
 * none 对象存储：不转存，返回 null，由调用方降级保留上游原始 URL。
 */
export class NoneObjectStorage implements ObjectStorage {
  readonly provider = 'none';

  async uploadBytes(_data: Buffer, _input?: StorageUploadInput): Promise<StorageUploadResult | null> {
    return null;
  }

  async uploadFromUrl(_sourceUrl: string, _input?: StorageUploadInput): Promise<StorageUploadResult | null> {
    return null;
  }

  async uploadFile(_filePath: string, _input?: StorageUploadInput): Promise<StorageUploadResult | null> {
    return null;
  }

  async getDisplayUrl(_key: string): Promise<string> {
    return '';
  }
}