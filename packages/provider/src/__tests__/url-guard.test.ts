import { describe, expect, it } from 'vitest';
import { validateFetchableUrl, validateSmtpHost, type UrlGuardOptions } from '../url-guard.js';

const prodGuard: UrlGuardOptions = { allowHttp: false, resolveDns: false };
const devGuard: UrlGuardOptions = { allowHttp: true, resolveDns: false };

async function expectBlocked(url: string, guard: UrlGuardOptions): Promise<void> {
  await expect(validateFetchableUrl(url, guard)).rejects.toThrow();
}

async function expectAllowed(url: string, guard: UrlGuardOptions): Promise<void> {
  await expect(validateFetchableUrl(url, guard)).resolves.toBeUndefined();
}

describe('SSRF guard (validateFetchableUrl)', () => {
  it('allows https public host', async () => {
    await expectAllowed('https://api.agnes.example.com/v1', prodGuard);
  });

  it('blocks localhost', async () => {
    await expectBlocked('https://localhost:8080', prodGuard);
    await expectBlocked('http://127.0.0.1:8080', prodGuard);
    await expectBlocked('https://[::1]/', prodGuard);
  });

  it('blocks private / link-local ranges', async () => {
    await expectBlocked('https://10.0.0.5/', prodGuard);
    await expectBlocked('https://192.168.1.1/', prodGuard);
    await expectBlocked('https://172.16.0.1/', prodGuard);
    await expectBlocked('https://169.254.169.254/latest/meta-data/', prodGuard);
    await expectBlocked('http://0.0.0.0/', prodGuard);
  });

  it('blocks http in production', async () => {
    await expectBlocked('http://api.agnes.example.com', prodGuard);
  });

  it('allows http in dev when enabled', async () => {
    await expectAllowed('http://api.agnes.example.com', devGuard);
  });

  it('blocks file: and ftp: schemes regardless of allowHttp', async () => {
    await expectBlocked('file:///etc/passwd', devGuard);
    await expectBlocked('ftp://example.com/file', devGuard);
  });

  it('blocks invalid URL', async () => {
    await expect(validateFetchableUrl('not-a-url', prodGuard)).rejects.toThrow();
  });

  it('honors dev allowlist host override', async () => {
    const guard: UrlGuardOptions = { allowHttp: false, resolveDns: false, devAllowlist: ['meta.internal'] };
    await expectAllowed('https://meta.internal/svc', guard);
  });

  // BUG-005: IP 变体覆盖测试
  describe('BUG-005: IP variant coverage', () => {
    it('blocks decimal IP (2130706433 → 127.0.0.1)', async () => {
      await expectBlocked('https://2130706433/', prodGuard);
    });

    it('blocks decimal IP for private 10.x (167772161 → 10.0.0.1)', async () => {
      await expectBlocked('https://167772161/', prodGuard);
    });

    it('blocks decimal IP for link-local (2852039166 → 169.254.169.254)', async () => {
      await expectBlocked('https://2852039166/', prodGuard);
    });

    it('blocks hex IP segments (0x7f.0.0.1 → 127.0.0.1)', async () => {
      await expectBlocked('https://0x7f.0.0.1/', prodGuard);
    });

    it('blocks octal IP segments (0177.0.0.1 → 127.0.0.1)', async () => {
      await expectBlocked('https://0177.0.0.1/', prodGuard);
    });

    it('blocks IPv6 mapped IPv4 loopback (::ffff:127.0.0.1)', async () => {
      await expectBlocked('https://[::ffff:127.0.0.1]/', prodGuard);
    });

    it('blocks IPv6 mapped IPv4 private (::ffff:10.0.0.1)', async () => {
      await expectBlocked('https://[::ffff:10.0.0.1]/', prodGuard);
    });

    it('blocks IPv6 mapped IPv4 link-local (::ffff:169.254.169.254)', async () => {
      await expectBlocked('https://[::ffff:169.254.169.254]/', prodGuard);
    });

    it('blocks 0.0.0.0', async () => {
      await expectBlocked('https://0.0.0.0/', prodGuard);
    });

    it('allows public decimal IP (3997760612 → 238.21.74.148)', async () => {
      await expectAllowed('https://3997760612/', prodGuard);
    });
  });
});

describe('SSRF guard (validateSmtpHost)', () => {
  it('allows public SMTP host', async () => {
    await expect(validateSmtpHost('smtp.example.com', prodGuard)).resolves.toBeUndefined();
  });

  it('blocks localhost', async () => {
    await expect(validateSmtpHost('localhost', prodGuard)).rejects.toThrow();
    await expect(validateSmtpHost('127.0.0.1', prodGuard)).rejects.toThrow();
    await expect(validateSmtpHost('::1', prodGuard)).rejects.toThrow();
  });

  it('blocks private / link-local ranges', async () => {
    await expect(validateSmtpHost('10.0.0.5', prodGuard)).rejects.toThrow();
    await expect(validateSmtpHost('192.168.1.1', prodGuard)).rejects.toThrow();
    await expect(validateSmtpHost('172.16.0.1', prodGuard)).rejects.toThrow();
    await expect(validateSmtpHost('169.254.169.254', prodGuard)).rejects.toThrow();
  });

  it('blocks empty host', async () => {
    await expect(validateSmtpHost('', prodGuard)).rejects.toThrow();
    await expect(validateSmtpHost('   ', prodGuard)).rejects.toThrow();
  });

  it('honors dev allowlist host override', async () => {
    const guard: UrlGuardOptions = { allowHttp: false, resolveDns: false, devAllowlist: ['mail.internal'] };
    await expect(validateSmtpHost('mail.internal', guard)).resolves.toBeUndefined();
  });
});