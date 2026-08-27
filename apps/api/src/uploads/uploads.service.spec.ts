import { afterEach, describe, expect, it, vi } from 'vitest'
import * as provider from '@enova/provider'
import { UploadsService } from './uploads.service.js'

vi.mock('@enova/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@enova/provider')>()
  return { ...actual, createObjectStorage: vi.fn(actual.createObjectStorage) }
})

function settings(configured = true) {
  return {
    getStorageConfig: vi.fn().mockResolvedValue({
      provider: configured ? 'qiniu' : 'none', configured,
      region: '', bucket: '', prefix: 'uploads', publicBaseUrl: '', endpointUrl: '',
      qiniu: { accessKey: 'ak', secretKey: 'sk', bucket: 'bucket', domain: 'https://cdn.example.com', region: 'z0' },
    }),
  }
}

function assetDb() {
  const values = vi.fn().mockResolvedValue([])
  return { insert: vi.fn().mockReturnValue({ values }), values }
}

describe('UploadsService', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(provider.createObjectStorage).mockClear()
  })

  it('rejects non-image uploads', async () => {
    const service = new UploadsService(settings() as never, assetDb() as never)
    await expect(service.upload(Buffer.from('x'), 'text/plain', 'x.txt')).rejects.toThrow(/image/i)
  })

  it('rejects content whose bytes do not match the declared image type', async () => {
    const service = new UploadsService(settings() as never, assetDb() as never)
    await expect(service.upload(Buffer.from('not a png'), 'image/png', 'x.png')).rejects.toThrow(/content/i)
  })

  it('rejects files over 10 MiB', async () => {
    const service = new UploadsService(settings() as never, assetDb() as never)
    await expect(service.upload(Buffer.alloc(10 * 1024 * 1024 + 1), 'image/png', 'x.png')).rejects.toThrow(/large/i)
  })

  it('fails clearly when object storage is not configured', async () => {
    const service = new UploadsService(settings(false) as never, assetDb() as never)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(service.upload(png, 'image/png', 'x.png')).rejects.toThrow(/storage/i)
  })

  it('uploads an accepted image and returns a usable URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    const service = new UploadsService(settings() as never, assetDb() as never)

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(service.upload(png, 'image/png', 'x.png')).resolves.toEqual({
      url: expect.stringMatching(/^https:\/\/cdn\.example\.com\/uploads\/images\//),
    })
  })

  it('uses a display URL when a private S3 upload returns an empty URL', async () => {
    const storage = {
      uploadBytes: vi.fn().mockResolvedValue({ key: 'uploads/images/private.png', url: '' }),
      getDisplayUrl: vi.fn().mockResolvedValue('https://signed.example.com/private.png'),
    }
    vi.mocked(provider.createObjectStorage).mockReturnValueOnce(storage as never)
    const config = await settings().getStorageConfig()
    config.provider = 'aws_s3'
    const service = new UploadsService({ getStorageConfig: vi.fn().mockResolvedValue(config) } as never, assetDb() as never)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    await expect(service.upload(png, 'image/png', 'private.png')).resolves.toEqual({
      url: 'https://signed.example.com/private.png',
    })
    expect(storage.getDisplayUrl).toHaveBeenCalledWith('uploads/images/private.png')
  })

  it('records an uploaded object under the submitting user and workspace', async () => {
    const storage = {
      uploadBytes: vi.fn().mockResolvedValue({ provider: 'aws_s3', key: 'uploads/images/input.png', url: 'https://cdn.example.com/input.png', size: 8 }),
      getDisplayUrl: vi.fn(),
    }
    vi.mocked(provider.createObjectStorage).mockReturnValueOnce(storage as never)
    const config = await settings().getStorageConfig()
    config.provider = 'aws_s3'
    const db = assetDb()
    const service = new (UploadsService as any)({ getStorageConfig: vi.fn().mockResolvedValue(config) }, db)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    await service.upload(png, 'image/png', 'input.png', { userId: 'user-1', workspaceId: 'workspace-1' })

    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      type: 'UPLOAD',
      storageProvider: 'aws_s3',
      objectKey: 'uploads/images/input.png',
      mimeType: 'image/png',
      size: 8,
    }))
  })
})
