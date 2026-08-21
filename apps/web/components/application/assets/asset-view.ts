import type { Asset, ListAssetsParams } from '@/lib/api'

export interface AssetDateGroup {
  key: string
  label: string
  assets: Asset[]
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function localCalendarDateKey(value: Date | string): string {
  const date = toDate(value)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatAssetDate(date: Date | string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(toDate(date))
}

export function groupAssetsByDate(assets: Asset[], locale: string): AssetDateGroup[] {
  const groups = new Map<string, AssetDateGroup>()

  for (const asset of assets) {
    const key = localCalendarDateKey(asset.createdAt)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        label: formatAssetDate(asset.createdAt, locale),
        assets: [],
      }
      groups.set(key, group)
    }
    group.assets.push(asset)
  }

  return Array.from(groups.values())
}

export function buildAssetsQuery(params: ListAssetsParams = {}): string {
  const query = new URLSearchParams()
  if (params.type && params.type !== 'ALL') query.set('type', params.type)
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.sort && params.sort !== 'NEWEST') query.set('sort', params.sort)
  if (params.limit !== undefined && params.limit !== 60) query.set('limit', String(params.limit))
  return query.toString()
}
