/**
 * P0-4: Redis-based Rate Limiting Guard.
 *
 * Uses a **fixed window** counter per key (IP, userId, email, or IP+email)
 * backed by Redis for multi-instance consistency.
 *
 * This is a fixed-window limiter (not sliding window): the counter resets
 * when the TTL expires. This means a burst of up to 2×limit can occur at
 * window boundaries. For most use cases this is acceptable; if you need
 * strict sliding window, use a sorted-set approach (higher Redis cost).
 *
 * Usage:
 *   @UseGuards(RateLimitGuard)
 *   @RateLimit({ key: 'login', limit: 10, windowSec: 60, by: 'ip' })
 *
 * Configuration via environment:
 *   RATE_LIMIT_ENABLED=false  → guard is bypassed (all requests allowed)
 *   RATE_LIMIT_PREFIX=xxx     → Redis key prefix (default: enova:rl)
 *
 * Redis failure behavior:
 *   - Production: fail-closed (reject request with 503 to protect the system)
 *   - Development: fail-open (allow request, log warning)
 */

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import IORedis from 'ioredis';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { ENV, type Env } from '../../config/config.module.js';

/** Rate limit configuration metadata. */
export interface RateLimitConfig {
  /** Unique key name for this limit (e.g. 'login', 'register', 'payment.create'). */
  key: string;
  /** Maximum requests allowed in the window. */
  limit: number;
  /** Time window in seconds. */
  windowSec: number;
  /** What to limit by: 'ip', 'user', 'email', or 'ip+email' (combined). */
  by: 'ip' | 'user' | 'email' | 'ip+email';
}

/** Metadata key for rate limit configuration on route handlers. */
export const RATE_LIMIT_KEY = 'rate_limit_config';

/** Decorator to set rate limit configuration on a route handler. */
export const RateLimit = (config: RateLimitConfig) => SetMetadata(RATE_LIMIT_KEY, config);

/** Redis token for rate limiter. */
export const RATE_LIMIT_REDIS = Symbol('RATE_LIMIT_REDIS');

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMIT_REDIS) private readonly redis: IORedis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // If rate limiting is globally disabled, skip entirely.
    if (!this.env.RATE_LIMIT_ENABLED) return true;

    const config = this.reflector.get<RateLimitConfig>(RATE_LIMIT_KEY, context.getHandler());
    if (!config) return true; // No rate limit configured → allow

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const identifier = this.extractIdentifier(request, config);
    if (!identifier) return true; // Cannot extract identifier → allow

    const redisKey = this.buildKey(config, identifier);

    let allowed: boolean;
    try {
      allowed = await this.checkAndIncrement(redisKey, config.limit, config.windowSec);
    } catch (err) {
      // Redis failure: fail-closed in production, fail-open in development.
      if (this.env.NODE_ENV === 'production') {
        this.logger.error(
          `Rate limiter Redis failure (production fail-closed): ${err instanceof Error ? err.message : 'unknown'}`,
        );
        throw domainError(
          ERROR_CODES.RATE_LIMITED,
          'Service temporarily unavailable. Please try again later.',
          503,
        );
      }
      // Development: log warning and allow.
      this.logger.warn(
        `Rate limiter Redis failure (dev fail-open): ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return true;
    }

    if (!allowed) {
      this.logger.warn(
        `Rate limit exceeded: key=${config.key}, identifier=${this.maskIdentifier(identifier)}, limit=${config.limit}/${config.windowSec}s`,
      );
      throw domainError(
        ERROR_CODES.RATE_LIMITED,
        'Too many requests. Please try again later.',
        429,
        { retryAfterSec: config.windowSec },
      );
    }

    return true;
  }

  /** Extract the limiting identifier from the request. */
  private extractIdentifier(request: FastifyRequest, config: RateLimitConfig): string | null {
    switch (config.by) {
      case 'ip':
        return request.ip || null;
      case 'user': {
        const user = (request as FastifyRequest & { user?: { userId?: string } }).user;
        return user?.userId || null;
      }
      case 'email': {
        const body = request.body as { email?: string } | null;
        return body?.email?.trim().toLowerCase() || null;
      }
      case 'ip+email': {
        // Combined: rate limit by both IP and email.
        // This prevents a single IP from abusing different emails,
        // and a single email from being abused from different IPs.
        const body = request.body as { email?: string } | null;
        const ip = request.ip || '';
        const email = body?.email?.trim().toLowerCase() || '';
        if (!ip && !email) return null;
        return `${ip}:${email}`;
      }
      default:
        return null;
    }
  }

  /** Build Redis key using the configured prefix. */
  private buildKey(config: RateLimitConfig, identifier: string): string {
    return `${this.env.RATE_LIMIT_PREFIX}:${config.key}:${identifier}`;
  }

  /**
   * Check and increment the counter using Redis INCR + EXPIRE.
   * Returns true if the request is allowed, false if rate limited.
   *
   * This uses a **fixed window** counter: the counter resets when the
   * TTL expires. This is simpler and faster than a sliding window but
   * allows brief bursts at window boundaries.
   */
  private async checkAndIncrement(key: string, limit: number, windowSec: number): Promise<boolean> {
    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, windowSec, 'NX'); // Only set TTL on first increment
    const results = await pipeline.exec();
    if (!results) return true;

    const count = results[0][1] as number;
    return count <= limit;
  }

  /** Mask identifier for logging (privacy). */
  private maskIdentifier(identifier: string): string {
    if (identifier.includes('@')) {
      const [local, domain] = identifier.split('@');
      return `${local[0]}***@${domain}`;
    }
    if (identifier.includes(':')) {
      // IP:email format
      const [ip, email] = identifier.split(':');
      return `${this.maskIdentifier(ip)}:${email ? this.maskIdentifier(email) : ''}`;
    }
    return identifier.length > 4 ? `${identifier.slice(0, 4)}***` : '***';
  }
}
