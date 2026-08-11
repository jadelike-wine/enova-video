import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'enova_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 天

/**
 * Session 管理：生成随机 token，数据库只存其 SHA-256 哈希。
 * 浏览器通过 HttpOnly / Secure / SameSite cookie 持有原始 token。
 * 严禁把 token 放进 localStorage。
 */
@Injectable()
export class SessionService {
  /** 生成一个不可预测的原始 token。 */
  issueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** 数据库只存哈希，泄露数据库也不能重放。 */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}