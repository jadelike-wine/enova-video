import { Controller, Inject, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { domainError, ERROR_CODES } from '@enova/contracts'
import { AuthGuard } from '../common/guards/auth.guard.js'
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js'
import { RateLimit, RateLimitGuard } from '../common/guards/rate-limit.guard.js'
import { MAX_IMAGE_UPLOAD_BYTES, UploadsService } from './uploads.service.js'

@ApiTags('uploads')
@Controller('api/v1/uploads')
@UseGuards(AuthGuard, RateLimitGuard)
export class UploadsController {
  constructor(@Inject(UploadsService) private readonly uploads: UploadsService) {}

  @Post()
  @RateLimit({ key: 'image_upload', limit: 30, windowSec: 60, by: 'user' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: '上传图片生成输入（JPEG/PNG/WebP，最大 10 MiB）' })
  async upload(@Req() request: FastifyRequest, @CurrentUser() user: AuthUser): Promise<{ url: string }> {
    try {
      const part = await request.file({ limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_IMAGE_UPLOAD_BYTES } })
      if (!part) {
        throw domainError(ERROR_CODES.UPLOAD_INVALID, 'Image file is required', 400)
      }
      const data = await part.toBuffer()
      return this.uploads.upload(data, part.mimetype, part.filename, user)
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw domainError(ERROR_CODES.UPLOAD_INVALID, 'Image upload is too large (maximum 10 MiB)', 413)
      }
      throw error
    }
  }
}
