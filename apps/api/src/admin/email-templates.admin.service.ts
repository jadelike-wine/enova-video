import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import type { Database } from '@enova/db';
import { schema } from '@enova/db';
import { DATABASE } from '../database/database.module.js';

/**
 * 邮件事件元数据定义。
 * 每个事件对应的显示名称、分类、说明、可用占位符。
 */
export interface EmailEventMeta {
  event: string;
  label: string;
  category: string;
  description: string;
  optional: boolean;
  placeholders: string[];
}

/**
 * 邮件模板列表响应。
 */
export interface EmailTemplateListResponse {
  events: EmailEventMeta[];
  locales: string[];
  placeholders: string[];
}

/**
 * 邮件模板详情。
 */
export interface EmailTemplateDetail {
  event: string;
  locale: string;
  subject: string;
  html: string;
  isCustom: boolean;
  updatedAt?: string;
  placeholders: string[];
}

/**
 * 预览响应。
 */
export interface EmailTemplatePreview {
  subject: string;
  html: string;
}

/**
 * 支持的邮件事件注册表。
 * 对齐 sub2api 的邮件事件定义。
 */
export const EMAIL_EVENTS: EmailEventMeta[] = [
  {
    event: 'auth.verify_code',
    label: '邮箱验证码',
    category: 'auth',
    description: '注册、绑定邮箱、OAuth 补全邮箱或 TOTP 邮箱校验时发送。',
    optional: false,
    placeholders: [
      '{{site_name}}',
      '{{recipient_name}}',
      '{{recipient_email}}',
      '{{verification_code}}',
      '{{expires_in_minutes}}',
    ],
  },
  {
    event: 'auth.password_reset',
    label: '密码重置',
    category: 'auth',
    description: '用户请求密码重置链接时发送。',
    optional: false,
    placeholders: [
      '{{site_name}}',
      '{{recipient_name}}',
      '{{recipient_email}}',
      '{{reset_url}}',
    ],
  },
  {
    event: 'subscription.expiry_reminder',
    label: '订阅到期提醒',
    category: 'subscription',
    description: '后台任务在订阅仍有效且距离到期剩余 7 天、3 天、1 天时各发送一次，可通过邮件设置中的开关关闭。',
    optional: true,
    placeholders: [
      '{{site_name}}',
      '{{recipient_name}}',
      '{{recipient_email}}',
      '{{subscription_group}}',
      '{{subscription_days}}',
      '{{expiry_time}}',
      '{{days_remaining}}',
      '{{unsubscribe_url}}',
    ],
  },
  {
    event: 'balance.low',
    label: '余额不足提醒',
    category: 'billing',
    description: '用户余额低于全局或个人配置的提醒阈值时发送。',
    optional: true,
    placeholders: [
      '{{site_name}}',
      '{{recipient_name}}',
      '{{recipient_email}}',
      '{{current_balance}}',
      '{{threshold}}',
      '{{recharge_url}}',
    ],
  },
  {
    event: 'balance.recharge_success',
    label: '余额充值成功',
    category: 'billing',
    description: '余额充值订单支付完成并入账后发送。',
    optional: false,
    placeholders: [
      '{{site_name}}',
      '{{recipient_name}}',
      '{{recipient_email}}',
      '{{recharge_amount}}',
      '{{current_balance}}',
      '{{order_id}}',
    ],
  },
];

/**
 * 支持的语言列表。
 */
export const EMAIL_LOCALES = ['zh', 'en'];

/**
 * 全局占位符（所有事件共用的兜底列表）。
 */
const GLOBAL_PLACEHOLDERS = [
  '{{site_name}}',
  '{{recipient_name}}',
  '{{recipient_email}}',
  '{{verification_code}}',
  '{{expires_in_minutes}}',
  '{{reset_url}}',
  '{{subscription_group}}',
  '{{subscription_days}}',
  '{{expiry_time}}',
  '{{days_remaining}}',
  '{{current_balance}}',
  '{{threshold}}',
  '{{recharge_url}}',
  '{{recharge_amount}}',
  '{{order_id}}',
  '{{unsubscribe_url}}',
];

/**
 * 官方默认模板（用于初始化和恢复）。
 */
const OFFICIAL_TEMPLATES: Record<string, Record<string, { subject: string; html: string }>> = {
  'auth.verify_code': {
    zh: {
      subject: '【{{site_name}}】验证您的邮箱',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
<h2 style="color:#7C3AED;">{{site_name}}</h2>
<p>您好，</p>
<p>请点击以下按钮验证您的邮箱地址：</p>
<p style="margin:24px 0;">
<a href="{{reset_url}}" style="display:inline-block;padding:12px 32px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;">验证邮箱</a>
</p>
<p style="color:#666;font-size:13px;">此链接有效期为 24 小时，且只能使用一次。</p>
<p style="color:#666;font-size:13px;">如果您没有注册 {{site_name}} 账号，请忽略此邮件。</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
<p style="color:#999;font-size:12px;">{{site_name}} 团队</p>
</div>`,
    },
    en: {
      subject: '[{{site_name}}] Verify Your Email',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
<h2 style="color:#7C3AED;">{{site_name}}</h2>
<p>Hello,</p>
<p>Please click the button below to verify your email address:</p>
<p style="margin:24px 0;">
<a href="{{reset_url}}" style="display:inline-block;padding:12px 32px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;">Verify Email</a>
</p>
<p style="color:#666;font-size:13px;">This link is valid for 24 hours and can only be used once.</p>
<p style="color:#666;font-size:13px;">If you did not register a {{site_name}} account, please ignore this email.</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
<p style="color:#999;font-size:12px;">{{site_name}} Team</p>
</div>`,
    },
  },
  'auth.password_reset': {
    zh: {
      subject: '【{{site_name}}】重置您的密码',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
<h2 style="color:#7C3AED;">{{site_name}}</h2>
<p>您好，</p>
<p>我们收到了您的密码重置请求。请点击以下按钮重置密码：</p>
<p style="margin:24px 0;">
<a href="{{reset_url}}" style="display:inline-block;padding:12px 32px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;">重置密码</a>
</p>
<p style="color:#666;font-size:13px;">此链接有效期为 30 分钟，且只能使用一次。</p>
<p style="color:#666;font-size:13px;">如果您没有请求重置密码，请忽略此邮件。</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
<p style="color:#999;font-size:12px;">{{site_name}} 团队</p>
</div>`,
    },
    en: {
      subject: '[{{site_name}}] Reset Your Password',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
<h2 style="color:#7C3AED;">{{site_name}}</h2>
<p>Hello,</p>
<p>We received your password reset request. Please click the button below to reset your password:</p>
<p style="margin:24px 0;">
<a href="{{reset_url}}" style="display:inline-block;padding:12px 32px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;">Reset Password</a>
</p>
<p style="color:#666;font-size:13px;">This link is valid for 30 minutes and can only be used once.</p>
<p style="color:#666;font-size:13px;">If you did not request a password reset, please ignore this email.</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
<p style="color:#999;font-size:12px;">{{site_name}} Team</p>
</div>`,
    },
  },
  'subscription.expiry_reminder': {
    zh: {
      subject: '【{{site_name}}】您的订阅即将到期',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
<h2 style="color:#7C3AED;">{{site_name}}</h2>
<p>您好，</p>
<p>您的订阅 <strong>{{subscription_group}}</strong> 将在 <strong>{{days_remaining}}</strong> 天后到期。</p>
<p>到期时间：{{expiry_time}}</p>
<p style="margin:24px 0;">
<a href="{{unsubscribe_url}}" style="display:inline-block;padding:12px 32px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;">续费订阅</a>
</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
<p style="color:#999;font-size:12px;">{{site_name}} 团队</p>
</div>`,
    },
    en: {
      subject: '[{{site_name}}] Your Subscription is Expiring Soon',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
<h2 style="color:#7C3AED;">{{site_name}}</h2>
<p>Hello,</p>
<p>Your subscription <strong>{{subscription_group}}</strong> will expire in <strong>{{days_remaining}}</strong> days.</p>
<p>Expiry time: {{expiry_time}}</p>
<p style="margin:24px 0;">
<a href="{{unsubscribe_url}}" style="display:inline-block;padding:12px 32px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;">Renew Subscription</a>
</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
<p style="color:#999;font-size:12px;">{{site_name}} Team</p>
</div>`,
    },
  },
  'balance.low': {
    zh: {
      subject: '【{{site_name}}】您的余额不足',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
<h2 style="color:#7C3AED;">{{site_name}}</h2>
<p>您好，</p>
<p>您当前的余额为 <strong>{{current_balance}}</strong> 元，低于提醒阈值 <strong>{{threshold}}</strong> 元。</p>
<p>请及时充值以确保服务正常使用。</p>
<p style="margin:24px 0;">
<a href="{{recharge_url}}" style="display:inline-block;padding:12px 32px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;">立即充值</a>
</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
<p style="color:#999;font-size:12px;">{{site_name}} 团队</p>
</div>`,
    },
    en: {
      subject: '[{{site_name}}] Your Balance is Low',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
<h2 style="color:#7C3AED;">{{site_name}}</h2>
<p>Hello,</p>
<p>Your current balance is <strong>{{current_balance}}</strong>, below the alert threshold of <strong>{{threshold}}</strong>.</p>
<p>Please recharge to ensure continued service.</p>
<p style="margin:24px 0;">
<a href="{{recharge_url}}" style="display:inline-block;padding:12px 32px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;">Recharge Now</a>
</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
<p style="color:#999;font-size:12px;">{{site_name}} Team</p>
</div>`,
    },
  },
  'balance.recharge_success': {
    zh: {
      subject: '【{{site_name}}】充值成功',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
<h2 style="color:#7C3AED;">{{site_name}}</h2>
<p>您好，</p>
<p>您的充值订单已成功支付。</p>
<p>充值金额：<strong>{{recharge_amount}}</strong> 元</p>
<p>当前余额：<strong>{{current_balance}}</strong> 元</p>
<p>订单号：{{order_id}}</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
<p style="color:#999;font-size:12px;">{{site_name}} 团队</p>
</div>`,
    },
    en: {
      subject: '[{{site_name}}] Recharge Successful',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
<h2 style="color:#7C3AED;">{{site_name}}</h2>
<p>Hello,</p>
<p>Your recharge order has been successfully paid.</p>
<p>Amount: <strong>{{recharge_amount}}</strong></p>
<p>Current balance: <strong>{{current_balance}}</strong></p>
<p>Order ID: {{order_id}}</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
<p style="color:#999;font-size:12px;">{{site_name}} Team</p>
</div>`,
    },
  },
};

/**
 * Mock 数据用于预览渲染。
 */
const PREVIEW_MOCK_DATA: Record<string, string> = {
  '{{site_name}}': 'EnovaMotion',
  '{{recipient_name}}': '测试用户',
  '{{recipient_email}}': 'user@example.com',
  '{{verification_code}}': '123456',
  '{{expires_in_minutes}}': '30',
  '{{reset_url}}': 'https://example.com/reset?token=preview',
  '{{subscription_group}}': '专业版',
  '{{subscription_days}}': '30',
  '{{expiry_time}}': '2026-09-01 00:00:00',
  '{{days_remaining}}': '7',
  '{{current_balance}}': '5.00',
  '{{threshold}}': '10.00',
  '{{recharge_url}}': 'https://example.com/wallet',
  '{{recharge_amount}}': '100.00',
  '{{order_id}}': 'ORD-2026-001',
  '{{unsubscribe_url}}': 'https://example.com/unsubscribe',
};

/**
 * 邮件模板管理服务。
 * 提供模板 CRUD、预览渲染、恢复官方模板等能力。
 */
@Injectable()
export class EmailTemplatesAdminService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * 获取邮件模板列表（事件 + 语言 + 全局占位符）。
   */
  async listTemplates(): Promise<EmailTemplateListResponse> {
    return {
      events: EMAIL_EVENTS,
      locales: EMAIL_LOCALES,
      placeholders: GLOBAL_PLACEHOLDERS,
    };
  }

  /**
   * 获取指定事件和语言的模板详情。
   * 如果数据库无自定义模板，返回官方默认模板。
   */
  async getTemplate(event: string, locale: string): Promise<EmailTemplateDetail> {
    const meta = EMAIL_EVENTS.find((e) => e.event === event);
    if (!meta) {
      throw new Error(`Unknown email event: ${event}`);
    }

    const [row] = await this.db
      .select()
      .from(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.event, event), eq(schema.emailTemplates.locale, locale)))
      .limit(1);

    if (row) {
      return {
        event,
        locale,
        subject: row.subject,
        html: row.html,
        isCustom: row.isCustom,
        updatedAt: row.updatedAt?.toISOString(),
        placeholders: meta.placeholders,
      };
    }

    // 回退到官方默认模板
    const official = OFFICIAL_TEMPLATES[event]?.[locale] ?? OFFICIAL_TEMPLATES[event]?.['zh'];
    if (!official) {
      throw new Error(`No template available for event=${event} locale=${locale}`);
    }

    return {
      event,
      locale,
      subject: official.subject,
      html: official.html,
      isCustom: false,
      placeholders: meta.placeholders,
    };
  }

  /**
   * 更新（或创建）模板。
   */
  async updateTemplate(
    event: string,
    locale: string,
    data: { subject: string; html: string },
    updatedBy?: string,
  ): Promise<EmailTemplateDetail> {
    const meta = EMAIL_EVENTS.find((e) => e.event === event);
    if (!meta) {
      throw new Error(`Unknown email event: ${event}`);
    }

    const [existing] = await this.db
      .select()
      .from(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.event, event), eq(schema.emailTemplates.locale, locale)))
      .limit(1);

    if (existing) {
      const [updated] = await this.db
        .update(schema.emailTemplates)
        .set({
          subject: data.subject,
          html: data.html,
          isCustom: true,
          updatedBy: updatedBy ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.emailTemplates.id, existing.id))
        .returning();
      return {
        event,
        locale,
        subject: updated.subject,
        html: updated.html,
        isCustom: updated.isCustom,
        updatedAt: updated.updatedAt.toISOString(),
        placeholders: meta.placeholders,
      };
    }

    const [created] = await this.db
      .insert(schema.emailTemplates)
      .values({
        event,
        locale,
        subject: data.subject,
        html: data.html,
        isCustom: true,
        updatedBy: updatedBy ?? null,
      })
      .returning();

    return {
      event,
      locale,
      subject: created.subject,
      html: created.html,
      isCustom: created.isCustom,
      updatedAt: created.updatedAt.toISOString(),
      placeholders: meta.placeholders,
    };
  }

  /**
   * 恢复官方默认模板（删除自定义模板）。
   */
  async restoreOfficial(event: string, locale: string): Promise<EmailTemplateDetail> {
    const meta = EMAIL_EVENTS.find((e) => e.event === event);
    if (!meta) {
      throw new Error(`Unknown email event: ${event}`);
    }

    // 删除自定义模板
    await this.db
      .delete(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.event, event), eq(schema.emailTemplates.locale, locale)));

    const official = OFFICIAL_TEMPLATES[event]?.[locale] ?? OFFICIAL_TEMPLATES[event]?.['zh'];
    if (!official) {
      throw new Error(`No official template available for event=${event} locale=${locale}`);
    }

    return {
      event,
      locale,
      subject: official.subject,
      html: official.html,
      isCustom: false,
      placeholders: meta.placeholders,
    };
  }

  /**
   * 预览模板（用 mock 数据替换占位符）。
   */
  async previewTemplate(data: {
    event: string;
    locale: string;
    subject: string;
    html: string;
  }): Promise<EmailTemplatePreview> {
    let subject = data.subject;
    let html = data.html;

    for (const [key, value] of Object.entries(PREVIEW_MOCK_DATA)) {
      subject = subject.replaceAll(key, value);
      html = html.replaceAll(key, value);
    }

    return { subject, html };
  }
}
