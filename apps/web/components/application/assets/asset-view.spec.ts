import { afterEach, describe, expect, it, vi } from 'vitest'

import { assetsApi, type Asset } from '@/lib/api'
import { getDateRangeForPreset } from '../AssetsView'
import { buildAssetsQuery, formatAssetDate, groupAssetsByDate } from './asset-view'

function asset(id: string, createdAt: string): Asset {
  return {
    id,
    type: 'IMAGE',
    url: `https://example.com/${id}.png`,
    mimeType: 'image/png',
    size: 1024,
    width: 1024,
    height: 1024,
    duration: null,
    createdAt,
    generationId: `generation-${id}`,
    prompt: `Prompt ${id}`,
  }
}

describe('asset view helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('omits default and empty asset query values', () => {
    expect(buildAssetsQuery({})).toBe('')
    expect(buildAssetsQuery({ type: 'ALL', sort: 'NEWEST', limit: 60, from: '', to: '' })).toBe('')
  })

  it.each(['IMAGE', 'VIDEO'] as const)('encodes %s filters and a date range', (type) => {
    expect(
      buildAssetsQuery({
        type,
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T23:59:59.999Z',
      }),
    ).toBe(
      `type=${type}&from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-31T23%3A59%3A59.999Z`,
    )
  })

  it('encodes oldest sorting and a non-default limit', () => {
    expect(buildAssetsQuery({ sort: 'OLDEST', limit: 20 })).toBe('sort=OLDEST&limit=20')
  })

  it('uses the assets endpoint and omits defaults in the actual request URL', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response('[]', { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await assetsApi.list()
    await assetsApi.list({
      type: 'VIDEO',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
      sort: 'OLDEST',
      limit: 20,
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/assets')
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/api/v1/assets?type=VIDEO&from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-31T23%3A59%3A59.999Z&sort=OLDEST&limit=20',
    )
  })

  it('groups assets by local calendar date without reordering each group', () => {
    const firstDayLater = new Date(2026, 7, 20, 18).toISOString()
    const secondDayFirst = new Date(2026, 7, 21, 1).toISOString()
    const firstDayEarlier = new Date(2026, 7, 20, 2).toISOString()
    const assets = [
      asset('later-on-first-day', firstDayLater),
      asset('first-on-second-day', secondDayFirst),
      asset('earlier-on-first-day', firstDayEarlier),
    ]

    expect(groupAssetsByDate(assets, 'en-US')).toEqual([
      {
        key: '2026-08-20',
        label: 'August 20, 2026',
        assets: [assets[0], assets[2]],
      },
      {
        key: '2026-08-21',
        label: 'August 21, 2026',
        assets: [assets[1]],
      },
    ])
  })

  it('keeps timestamps on either side of local midnight in separate groups', () => {
    const justBeforeMidnight = asset(
      'just-before-midnight',
      new Date(2026, 7, 20, 23, 59, 59).toISOString(),
    )
    const justAfterMidnight = asset(
      'just-after-midnight',
      new Date(2026, 7, 21, 0, 0, 1).toISOString(),
    )

    expect(groupAssetsByDate([justBeforeMidnight, justAfterMidnight], 'en-US')).toEqual([
      {
        key: '2026-08-20',
        label: 'August 20, 2026',
        assets: [justBeforeMidnight],
      },
      {
        key: '2026-08-21',
        label: 'August 21, 2026',
        assets: [justAfterMidnight],
      },
    ])
  })

  it('formats a date using the requested locale', () => {
    expect(formatAssetDate(new Date(2026, 7, 20, 12), 'en-US')).toBe('August 20, 2026')
  })

  it('builds inclusive rolling ranges for the quick time presets', () => {
    const now = new Date(2026, 7, 21, 15, 30, 0)

    expect(getDateRangeForPreset('WEEK', now)).toEqual({
      from: new Date(2026, 7, 15, 0, 0, 0, 0).toISOString(),
      to: new Date(2026, 7, 21, 23, 59, 59, 999).toISOString(),
    })
    expect(getDateRangeForPreset('MONTH', now)).toEqual({
      from: new Date(2026, 6, 23, 0, 0, 0, 0).toISOString(),
      to: new Date(2026, 7, 21, 23, 59, 59, 999).toISOString(),
    })
  })
})
