import { Injectable } from '@nestjs/common';
import type { EmailSender } from './email-sender.interface.js';

/**
 * Mock email sender for tests (P0-1).
 *
 * Captures all sent emails in memory for test assertions.
 * Never sends real emails. Never logs tokens.
 */
@Injectable()
export class MockEmailSender implements EmailSender {
  readonly sentPasswordResets: Array<{ email: string; resetToken: string }> = [];
  readonly sentEmailVerifications: Array<{ email: string; verifyToken: string }> = [];

  async sendPasswordReset(opts: { email: string; resetToken: string }): Promise<void> {
    this.sentPasswordResets.push({ ...opts });
  }

  async sendEmailVerification(opts: { email: string; verifyToken: string }): Promise<void> {
    this.sentEmailVerifications.push({ ...opts });
  }

  /** Clear captured emails between tests. */
  reset(): void {
    this.sentPasswordResets.length = 0;
    this.sentEmailVerifications.length = 0;
  }
}
