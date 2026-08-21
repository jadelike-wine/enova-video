'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { App, Button, DatePicker, Dropdown, Empty, Image as AntdImage, Modal, Result, Segmented, Skeleton, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { CheckOutlined, DownOutlined, EyeOutlined, FilterOutlined, PictureOutlined, PlayCircleOutlined, ReloadOutlined, SortAscendingOutlined } from '@ant-design/icons'
import { useLocale, useTranslations } from 'next-intl'
import dayjs, { type Dayjs } from 'dayjs'
import { assetsApi, type Asset, type AssetListType, type AssetSort } from '@/lib/api'
import { groupAssetsByDate } from './assets/asset-view'
import styles from './assets/assets-view.module.css'

export type AssetTimePreset = 'ALL' | 'WEEK' | 'MONTH' | 'QUARTER' | 'CUSTOM'

interface DateRange {
  from: string
  to: string
}

/** Build an inclusive local-calendar range for the quick time filters. */
export function getDateRangeForPreset(preset: AssetTimePreset, now = new Date()): DateRange {
  if (preset === 'ALL' || preset === 'CUSTOM') return { from: '', to: '' }

  const days = preset === 'WEEK' ? 7 : preset === 'MONTH' ? 30 : 90
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() - (days - 1))

  const to = new Date(now)
  to.setHours(23, 59, 59, 999)
  return { from: from.toISOString(), to: to.toISOString() }
}

function isVideoAsset(asset: Asset): boolean {
  return asset.type === 'VIDEO' || asset.mimeType?.toLowerCase().startsWith('video/') === true
}

function isRenderableAsset(asset: Asset): boolean {
  return Boolean(asset.url) && (isVideoAsset(asset) || asset.type === 'IMAGE' || asset.mimeType?.toLowerCase().startsWith('image/') === true)
}

function formatDuration(duration: number | null): string {
  if (duration == null || !Number.isFinite(duration) || duration < 0) return ''
  const totalSeconds = Math.round(duration)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function formatAssetMeta(asset: Asset): string {
  const parts: string[] = []
  if (asset.width && asset.height) parts.push(`${asset.width} × ${asset.height}`)
  if (isVideoAsset(asset) && asset.duration != null) {
    const duration = formatDuration(asset.duration)
    if (duration) parts.push(duration)
  }
  return parts.join(' · ')
}

function withCheck(label: string, checked: boolean): React.ReactNode {
  return (
    <span className="flex items-center gap-2">
      <span className="w-4 text-center text-teal-600">{checked ? <CheckOutlined /> : null}</span>
      <span>{label}</span>
    </span>
  )
}

function toDatePickerValue(value: string): Dayjs | null {
  if (!value) return null
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed : null
}

export default function AssetsView() {
  const t = useTranslations('assets')
  const tc = useTranslations()
  const locale = useLocale()
  const { message } = App.useApp()
  const [type, setType] = useState<AssetListType>('ALL')
  const [timePreset, setTimePreset] = useState<AssetTimePreset>('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sort, setSort] = useState<AssetSort>('NEWEST')
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const requestIdRef = useRef(0)

  const query = useMemo(
    () => ({ type, from, to, sort, limit: 60 }),
    [from, sort, to, type],
  )

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    let active = true

    setLoading(true)
    setLoadError(false)
    setAssets([])

    void assetsApi
      .list(query)
      .then((nextAssets) => {
        if (!active || requestId !== requestIdRef.current) return
        setAssets(nextAssets)
      })
      .catch(() => {
        if (!active || requestId !== requestIdRef.current) return
        setAssets([])
        setLoadError(true)
        message.error(tc('common.loadFailed'))
      })
      .finally(() => {
        if (active && requestId === requestIdRef.current) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [message, query, retryToken, tc])

  const clearFilters = useCallback(() => {
    setType('ALL')
    setTimePreset('ALL')
    setFrom('')
    setTo('')
    setSort('NEWEST')
  }, [])

  const applyTimePreset = useCallback((nextPreset: AssetTimePreset) => {
    setTimePreset(nextPreset)
    if (nextPreset === 'CUSTOM') {
      setFrom('')
      setTo('')
      return
    }
    const range = getDateRangeForPreset(nextPreset)
    setFrom(range.from)
    setTo(range.to)
  }, [])

  const handleCustomRangeChange = useCallback((values: [Dayjs | null, Dayjs | null] | null) => {
    const start = values?.[0]
    const end = values?.[1]
    setFrom(start ? start.startOf('day').toISOString() : '')
    setTo(end ? end.endOf('day').toISOString() : '')
  }, [])

  const visibleAssets = useMemo(
    () => assets.filter(isRenderableAsset),
    [assets],
  )
  const groups = useMemo(
    () => groupAssetsByDate(visibleAssets, locale === 'zh-CN' ? 'zh-CN' : 'en-US'),
    [locale, visibleAssets],
  )
  const hasActiveFilters = type !== 'ALL' || timePreset !== 'ALL' || sort !== 'NEWEST'

  const typeLabel = type === 'IMAGE' ? t('typeImages') : type === 'VIDEO' ? t('typeVideos') : t('typeAll')
  const timeLabel = timePreset === 'WEEK'
    ? t('recentWeek')
    : timePreset === 'MONTH'
      ? t('recentMonth')
      : timePreset === 'QUARTER'
        ? t('recentQuarter')
        : timePreset === 'CUSTOM'
          ? t('customRange')
          : t('allTime')
  const sortLabel = sort === 'OLDEST' ? t('oldest') : t('newest')

  const filterItems: MenuProps['items'] = [
    { key: 'ALL', label: withCheck(t('filterAll'), type === 'ALL'), onClick: () => setType('ALL') },
    { key: 'IMAGE', label: withCheck(t('filterImages'), type === 'IMAGE'), onClick: () => setType('IMAGE') },
    { key: 'VIDEO', label: withCheck(t('filterVideos'), type === 'VIDEO'), onClick: () => setType('VIDEO') },
  ]
  const timeItems: MenuProps['items'] = [
    { key: 'ALL', label: withCheck(t('allTime'), timePreset === 'ALL'), onClick: () => applyTimePreset('ALL') },
    { key: 'WEEK', label: withCheck(t('recentWeek'), timePreset === 'WEEK'), onClick: () => applyTimePreset('WEEK') },
    { key: 'MONTH', label: withCheck(t('recentMonth'), timePreset === 'MONTH'), onClick: () => applyTimePreset('MONTH') },
    { key: 'QUARTER', label: withCheck(t('recentQuarter'), timePreset === 'QUARTER'), onClick: () => applyTimePreset('QUARTER') },
    { type: 'divider' },
    { key: 'CUSTOM', label: withCheck(t('customRange'), timePreset === 'CUSTOM'), onClick: () => applyTimePreset('CUSTOM') },
  ]
  const sortItems: MenuProps['items'] = [
    { key: 'NEWEST', label: withCheck(t('newest'), sort === 'NEWEST'), onClick: () => setSort('NEWEST') },
    { key: 'OLDEST', label: withCheck(t('oldest'), sort === 'OLDEST'), onClick: () => setSort('OLDEST') },
  ]

  const renderAsset = (asset: Asset) => {
    const isVideo = isVideoAsset(asset)
    const label = asset.prompt || (isVideo ? t('videoAlt') : t('imageAlt'))
    const meta = formatAssetMeta(asset)

    return (
      <article className={styles.assetCard} key={asset.id}>
        <div className={styles.mediaFrame}>
          {isVideo ? (
            <button
              type="button"
              className={styles.videoButton}
              aria-label={`${t('play')} — ${label}`}
              onClick={() => setPreviewAsset(asset)}
            >
              <video className={styles.videoMedia} src={asset.url ?? undefined} muted preload="metadata" aria-hidden="true" />
              <span className={styles.playOverlay} aria-hidden="true"><PlayCircleOutlined /></span>
              {asset.duration != null && <span className={styles.duration}>{formatDuration(asset.duration)}</span>}
            </button>
          ) : (
            <AntdImage
              className={styles.imageMedia}
              src={asset.url ?? undefined}
              alt={label}
              preview={{ mask: <span className={styles.previewMask}><EyeOutlined />{t('preview')}</span> }}
            />
          )}
        </div>
        <div className={styles.assetInfo}>
          <div className={styles.prompt} title={asset.prompt ?? undefined}>{asset.prompt || label}</div>
          {meta && <div className={styles.assetMeta}>{meta}</div>}
        </div>
      </article>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <header className={styles.header}>
          <div>
            <Typography.Title level={1} className={styles.title}>{t('title')}</Typography.Title>
            <div className={styles.subtitle}>{t('subtitle')}</div>
          </div>
        </header>

        <div className={styles.toolbar}>
          <div className={styles.typeControl}>
            <Segmented
              aria-label={t('mediaType')}
              value={type}
              onChange={(value) => setType(value as AssetListType)}
              options={[
                { value: 'ALL', label: t('typeAll') },
                { value: 'IMAGE', label: t('typeImages') },
                { value: 'VIDEO', label: t('typeVideos') },
              ]}
            />
          </div>
          <div className={styles.dropdowns}>
            <Dropdown trigger={['click']} menu={{ items: filterItems }}>
              <Button type="text" className={styles.controlButton} data-active={type !== 'ALL'} icon={<FilterOutlined />}>
                {t('filter')}{type !== 'ALL' ? ` · ${typeLabel}` : ''}<DownOutlined />
              </Button>
            </Dropdown>
            <Dropdown trigger={['click']} menu={{ items: timeItems }}>
              <Button type="text" className={styles.controlButton} data-active={timePreset !== 'ALL'}>
                {t('time')} · {timeLabel}<DownOutlined />
              </Button>
            </Dropdown>
            <Dropdown trigger={['click']} menu={{ items: sortItems }}>
              <Button type="text" className={styles.controlButton} data-active={sort !== 'NEWEST'} icon={<SortAscendingOutlined />}>
                {t('sort')} · {sortLabel}<DownOutlined />
              </Button>
            </Dropdown>
          </div>
        </div>

        {timePreset === 'CUSTOM' && (
          <div className={styles.customRange}>
            <DatePicker.RangePicker
              className={styles.customPicker}
              value={[toDatePickerValue(from), toDatePickerValue(to)]}
              onChange={handleCustomRangeChange}
              allowEmpty={[true, true]}
              aria-label={t('customRange')}
            />
          </div>
        )}

        {loading ? (
          <div className={styles.skeletonGrid} aria-label={tc('common.loading')}>
            {Array.from({ length: 8 }, (_, index) => (
              <div className={styles.skeletonCard} key={index}>
                <Skeleton.Image active className={styles.skeletonMedia} />
                <Skeleton active title={false} paragraph={{ rows: 1, width: '65%' }} className={styles.skeletonText} />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className={styles.state}>
            <div className={styles.errorState}>
              <Result
                status="error"
                title={tc('common.loadFailed')}
                subTitle={t('errorHint')}
                extra={<Button type="primary" icon={<ReloadOutlined />} onClick={() => setRetryToken((value) => value + 1)}>{tc('common.retry')}</Button>}
              />
            </div>
          </div>
        ) : !visibleAssets.length ? (
          <div className={styles.state}>
            {hasActiveFilters ? (
              <Empty description={t('filteredEmptyTitle')}>
                <p className="mb-4 text-sm text-slate-500">{t('filteredEmptyHint')}</p>
                <Button type="primary" onClick={clearFilters}>{tc('common.clear')}</Button>
              </Empty>
            ) : (
              <Empty description={t('emptyTitle')}>
                <p className="mb-4 text-sm text-slate-500">{t('emptyHint')}</p>
                <Link href="/app/images">
                  <Button type="primary" icon={<PictureOutlined />}>{t('createImage')}</Button>
                </Link>
              </Empty>
            )}
          </div>
        ) : (
          <div className={styles.groups}>
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className={styles.groupTitle}>{group.label}</h2>
                <div className={styles.grid}>{group.assets.map(renderAsset)}</div>
              </section>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={Boolean(previewAsset)}
        title={previewAsset?.prompt || t('videoPreview')}
        footer={null}
        centered
        onCancel={() => setPreviewAsset(null)}
      >
        {previewAsset?.url && (
          <video className={styles.modalVideo} src={previewAsset.url} controls autoPlay playsInline />
        )}
      </Modal>
    </div>
  )
}
