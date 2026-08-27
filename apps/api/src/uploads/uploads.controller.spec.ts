import { describe, expect, it, vi } from 'vitest'
import { UploadsController } from './uploads.controller.js'

describe('UploadsController', () => {
  it('limits uploads to one file part with no text fields', async () => {
    const request = { file: vi.fn().mockResolvedValue(null) }
    const controller = new UploadsController({ upload: vi.fn() } as never)

    await expect(controller.upload(request as never, {} as never)).rejects.toThrow(/required/i)

    expect(request.file).toHaveBeenCalledWith(expect.objectContaining({
      limits: expect.objectContaining({ files: 1, fields: 0, parts: 1 }),
    }))
  })

  it('maps the multipart file-size error to the upload domain error', async () => {
    const error = Object.assign(new Error('request file too large'), { code: 'FST_REQ_FILE_TOO_LARGE' })
    const request = { file: vi.fn().mockRejectedValue(error) }
    const controller = new UploadsController({ upload: vi.fn() } as never)

    await expect(controller.upload(request as never)).rejects.toMatchObject({
      code: 'UPLOAD_INVALID',
      statusCode: 413,
    })
  })
})
