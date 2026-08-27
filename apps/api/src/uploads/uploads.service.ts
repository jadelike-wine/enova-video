import { Inject, Injectable } from '@nestjs/common'
import { domainError, ERROR_CODES } from '@enova/contracts'
import { assets, type Database } from '@enova/db'
import { createObjectStorage } from '@enova/provider'
import { DATABASE } from '../database/database.module.js'
import { SettingsService } from '../settings/settings.service.js'

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function matchesDeclaredImageType(data: Buffer, contentType: string): boolean {
  if (contentType === 'image/jpeg') {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  }
  if (contentType === 'image/png') {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  return contentType === 'image/webp'
    && data.length >= 12
    && data.subarray(0, 4).toString('ascii') === 'RIFF'
    && data.subarray(8, 12).toString('ascii') === 'WEBP'
}

@Injectable()
export class UploadsService {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async upload(
    data: Buffer,
    contentType: string,
    _filename?: string,
    actor?: { userId: string; workspaceId: string },
  ): Promise<{ url: string }> {
    const ext = IMAGE_EXTENSIONS[contentType.toLowerCase()]
    if (!ext) {
      throw domainError(ERROR_CODES.UPLOAD_INVALID, 'Only JPEG, PNG, and WebP image uploads are allowed', 400)
    }
    if (data.byteLength === 0) {
      throw domainError(ERROR_CODES.UPLOAD_INVALID, 'Image upload is empty', 400)
    }
    if (data.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
      throw domainError(ERROR_CODES.UPLOAD_INVALID, 'Image upload is too large (maximum 10 MiB)', 413)
    }
    if (!matchesDeclaredImageType(data, contentType.toLowerCase())) {
      throw domainError(ERROR_CODES.UPLOAD_INVALID, 'Image content does not match its declared content type', 400)
    }

    const config = await this.settings.getStorageConfig()
    if (config.provider === 'none' || !config.configured) {
      throw domainError(ERROR_CODES.UPLOAD_INVALID, 'Object storage is not configured', 503)
    }
    const download = {
      guard: { allowHttp: false, resolveDns: true, devAllowlist: [] },
      maxBytes: MAX_IMAGE_UPLOAD_BYTES,
      timeoutMs: 30_000,
    }
    const storage = createObjectStorage(config.provider === 'aws_s3'
      ? {
          kind: 'aws_s3',
          s3: {
            region: config.region,
            bucket: config.bucket,
            prefix: config.prefix,
            publicBaseUrl: config.publicBaseUrl,
            endpointUrl: config.endpointUrl,
            credentials: config.credentials,
            download,
            allowedContentTypePrefixes: ['image/'],
          },
        }
      : {
          kind: 'qiniu',
          qiniu: {
            accessKey: config.qiniu.accessKey,
            secretKey: config.qiniu.secretKey,
            bucket: config.qiniu.bucket,
            domain: config.qiniu.domain,
            region: config.qiniu.region,
            prefix: config.prefix,
            download,
            allowedContentTypePrefixes: ['image/'],
          },
        })

    const stored = await storage.uploadBytes(data, { mediaType: 'image', ext, contentType })
    if (!stored) {
      throw domainError(ERROR_CODES.UPLOAD_INVALID, 'Object storage did not accept the image upload', 503)
    }
    if (actor) {
      try {
        await this.db.insert(assets).values({
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          type: 'UPLOAD',
          storageProvider: stored.provider,
          objectKey: stored.key,
          mimeType: contentType.toLowerCase(),
          size: stored.size,
        })
      } catch (error) {
        await storage.deleteObject(stored.key).catch(() => undefined)
        throw error
      }
    }
    return { url: stored.url || await storage.getDisplayUrl(stored.key) }
  }
}
