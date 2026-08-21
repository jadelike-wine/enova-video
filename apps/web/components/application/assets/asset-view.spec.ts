import { describe, expect, it } from 'vitest'

import type { Asset } from '@/lib/api'
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
  it('omits default and empty asset query values', () => {
    expect(buildAssetsQuery({})).toBe('')
    expect(buildAssetsQuery({ sort: 'NEWEST', limit: 60, from: '', to: '' })).toBe('')
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

  it('formats a date using the requested locale', () => {
    expect(formatAssetDate(new Date(2026, 7, 20, 12), 'en-US')).toBe('August 20, 2026')
  })
})
