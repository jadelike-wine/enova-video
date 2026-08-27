import { describe, expect, it, vi } from 'vitest'

import { validateFetchableUrl } from '../url-guard.js'

describe('SSRF guard DNS failures', () => {
  it('fails closed when a hostname cannot be resolved', async () => {
    const dnsLookup = vi.fn().mockRejectedValue(new Error('DNS unavailable'))

    await expect(validateFetchableUrl('https://provider.example.test', {
      allowHttp: false,
      resolveDns: true,
      dnsLookup,
    })).rejects.toThrow(/DNS/i)
  })
})
