/**
 * Email template rendering (P0-1).
 *
 * Generates HTML and text bodies for transactional emails.
 * Templates NEVER include secrets, API keys, or session tokens.
 * Only one-time-use tokens (password reset, email verification) are included,
 * and they are embedded as URL parameters — never logged.
 */

export interface EmailTemplateResult {
  subject: string;
  html: string;
  text: string;
}

/** Build password reset email content. */
export function renderPasswordResetEmail(opts: {
  email: string;
  resetToken: string;
  resetUrl: string;
  appName: string;
}): EmailTemplateResult {
  const url = `${opts.resetUrl}?token=${opts.resetToken}`;
  const subject = `【${opts.appName}】重置您的密码`;
  const text =
    `您好，\n\n` +
    `我们收到了您的密码重置请求。请点击以下链接重置密码：\n\n` +
    `${url}\n\n` +
    `此链接有效期为 30 分钟，且只能使用一次。\n` +
    `如果您没有请求重置密码，请忽略此邮件。\n\n` +
    `${opts.appName} 团队`;
  const html =
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">` +
    `<h2 style="color:#7C3AED;">${opts.appName}</h2>` +
    `<p>您好，</p>` +
    `<p>我们收到了您的密码重置请求。请点击以下按钮重置密码：</p>` +
    `<p style="margin:24px 0;">` +
    `<a href="${url}" style="display:inline-block;padding:12px 32px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;">重置密码</a>` +
    `</p>` +
    `<p style="color:#666;font-size:13px;">此链接有效期为 30 分钟，且只能使用一次。</p>` +
    `<p style="color:#666;font-size:13px;">如果您没有请求重置密码，请忽略此邮件。</p>` +
    `<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />` +
    `<p style="color:#999;font-size:12px;">${opts.appName} 团队</p>` +
    `</div>`;
  return { subject, html, text };
}

/** Build email verification email content. */
export function renderEmailVerificationEmail(opts: {
  email: string;
  verifyToken: string;
  verifyUrl: string;
  appName: string;
}): EmailTemplateResult {
  const url = `${opts.verifyUrl}?token=${opts.verifyToken}`;
  const subject = `【${opts.appName}】验证您的邮箱`;
  const text =
    `您好，\n\n` +
    `请点击以下链接验证您的邮箱地址：\n\n` +
    `${url}\n\n` +
    `此链接有效期为 24 小时，且只能使用一次。\n` +
    `如果您没有注册 ${opts.appName} 账号，请忽略此邮件。\n\n` +
    `${opts.appName} 团队`;
  const html =
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">` +
    `<h2 style="color:#7C3AED;">${opts.appName}</h2>` +
    `<p>您好，</p>` +
    `<p>请点击以下按钮验证您的邮箱地址：</p>` +
    `<p style="margin:24px 0;">` +
    `<a href="${url}" style="display:inline-block;padding:12px 32px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;">验证邮箱</a>` +
    `</p>` +
    `<p style="color:#666;font-size:13px;">此链接有效期为 24 小时，且只能使用一次。</p>` +
    `<p style="color:#666;font-size:13px;">如果您没有注册 ${opts.appName} 账号，请忽略此邮件。</p>` +
    `<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />` +
    `<p style="color:#999;font-size:12px;">${opts.appName} 团队</p>` +
    `</div>`;
  return { subject, html, text };
}

/** Build admin test email content. */
export function renderTestEmail(opts: { appName: string }): EmailTemplateResult {
  const subject = `【${opts.appName}】邮件配置测试`;
  const text = `这是一封来自 ${opts.appName} 管理后台的测试邮件。如果您收到此邮件，说明邮件配置正确。`;
  const html =
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">` +
    `<h2 style="color:#7C3AED;">${opts.appName}</h2>` +
    `<p>这是一封来自管理后台的测试邮件。</p>` +
    `<p>如果您收到此邮件，说明邮件配置正确。</p>` +
    `<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />` +
    `<p style="color:#999;font-size:12px;">${opts.appName} 团队</p>` +
    `</div>`;
  return { subject, html, text };
}
