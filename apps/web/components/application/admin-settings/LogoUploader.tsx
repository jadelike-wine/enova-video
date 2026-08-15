'use client'

import { useState, type ChangeEvent } from 'react'

const MAX_LOGO_BYTES = 300 * 1024
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml'])
const ACCEPTED_EXTENSIONS = /\.(png|jpe?g|svg)$/i

export interface LogoUploaderProps {
  value: string
  onChange: (value: string) => void
}

function isSupportedImage(file: File): boolean {
  return ACCEPTED_TYPES.has(file.type) || ACCEPTED_EXTENSIONS.test(file.name)
}

export default function LogoUploader({ value, onChange }: LogoUploaderProps) {
  const [error, setError] = useState('')

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!isSupportedImage(file)) {
      setError('仅支持 PNG、JPG 或 SVG 图片')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo 文件不能超过 300KB')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setError('')
        onChange(reader.result)
      }
    }
    reader.onerror = () => setError('Logo 读取失败，请重试')
    reader.readAsDataURL(file)
  }

  return (
    <div data-testid="logo-uploader" className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-200 bg-gray-50">
          {value ? (
            // The configured value may be a remote URL or a data URI from the existing setting.
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary configured/data URI previews are not Next Image assets.
            <img src={value} alt="当前 Logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-gray-400">暂无 Logo</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-primary-300 hover:text-primary-600">
            选择图片
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="sr-only"
              onChange={handleFile}
            />
          </label>
          {value && (
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50"
              onClick={() => {
                setError('')
                onChange('')
              }}
            >
              移除 Logo
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">支持 PNG、JPG、SVG，文件大小不超过 300KB。</p>
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
    </div>
  )
}
