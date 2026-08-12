/**
 * Email sender interface (P1.5).
 *
 * Production: plug in SMTP/SendGrid/SES adapter.
 * Development: ConsoleEmailSender logs tokens to console.
 *
 * EMAIL DELIVERY ADAPTER REQUIRED for production use.
 */
export interface EmailSender {
  sendPasswordReset(opts: { email: string; resetToken: string }): Promise<void>;
  sendEmailVerification(opts: { email: string; verifyToken: string }): Promise<void>;
}
