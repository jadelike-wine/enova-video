'use client'

import { useEffect, useState } from 'react'

import type { CustomEndpoint } from '../../../lib/api'

export type { CustomEndpoint }

export interface CustomEndpointEditorProps {
  value: string
  onChange: (value: string) => void
}

function makeId(): string {
  const cryptoObject = globalThis.crypto
  return cryptoObject?.randomUUID ? `endpoint-${cryptoObject.randomUUID()}` : `endpoint-${Date.now()}`
}

function parseEndpoints(value: string): CustomEndpoint[] {
  if (!value.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((raw, index) => {
        if (!raw || typeof raw !== 'object') return null
        const endpoint = raw as Partial<CustomEndpoint>
        return {
          id: typeof endpoint.id === 'string' && endpoint.id.trim() ? endpoint.id : `endpoint-${index + 1}`,
          name: typeof endpoint.name === 'string' ? endpoint.name : '',
          url: typeof endpoint.url === 'string' ? endpoint.url : '',
          description: typeof endpoint.description === 'string' ? endpoint.description : '',
          sortOrder: typeof endpoint.sortOrder === 'number' && Number.isFinite(endpoint.sortOrder) ? endpoint.sortOrder : index + 1,
        }
      })
      .filter((endpoint): endpoint is CustomEndpoint => endpoint !== null)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  } catch {
    return []
  }
}

function serializeEndpoints(items: CustomEndpoint[]): string {
  return JSON.stringify(
    [...items]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map(({ id, name, url, description, sortOrder }) => ({ id, name, url, description, sortOrder })),
  )
}

function validHttpUrl(value: string): boolean {
  if (!value.trim()) return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export default function CustomEndpointEditor({ value, onChange }: CustomEndpointEditorProps) {
  const [items, setItems] = useState(() => parseEndpoints(value))

  useEffect(() => {
    setItems(parseEndpoints(value))
  }, [value])

  const commit = (next: CustomEndpoint[]) => {
    setItems(next)
    onChange(serializeEndpoints(next))
  }

  const updateItem = (index: number, patch: Partial<CustomEndpoint>) => {
    commit(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)))
  }

  const moveItem = (index: number, direction: -1 | 1) => {
    const ordered = [...items]
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    const [item] = ordered.splice(index, 1)
    ordered.splice(target, 0, item)
    commit(ordered.map((entry, entryIndex) => ({ ...entry, sortOrder: entryIndex + 1 })))
  }

  return (
    <div data-testid="custom-endpoint-editor" className="space-y-3">
      {items.length === 0 && <p className="text-xs text-gray-400">暂无自定义端点。</p>}
      {items.map((item, index) => {
        const urlInvalid = !validHttpUrl(item.url)
        return (
          <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50/70 p-4" data-testid={`custom-endpoint-item-${index}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700">端点 {index + 1}</span>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="上移端点" disabled={index === 0} onClick={() => moveItem(index, -1)} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-white disabled:opacity-40">上移</button>
                <button type="button" aria-label="下移端点" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-white disabled:opacity-40">下移</button>
                <button type="button" aria-label="删除端点" onClick={() => commit(items.filter((_, itemIndex) => itemIndex !== index))} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">删除</button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs text-gray-500">
                名称
                <input value={item.name} onChange={(event) => updateItem(index, { name: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary-400" />
              </label>
              <label className="text-xs text-gray-500 md:col-span-1">
                URL
                <input value={item.url} type="url" aria-invalid={urlInvalid} onChange={(event) => updateItem(index, { url: event.target.value })} className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary-400 ${urlInvalid ? 'border-red-300' : 'border-gray-200'}`} />
                {urlInvalid && <span className="mt-1 block text-[11px] text-red-600">请输入 http:// 或 https:// 地址</span>}
              </label>
              <label className="text-xs text-gray-500 md:col-span-2">
                描述
                <input value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary-400" />
              </label>
            </div>
          </div>
        )
      })}
      <button type="button" data-testid="custom-endpoint-add" onClick={() => commit([...items, { id: makeId(), name: '', url: 'https://', description: '', sortOrder: items.length + 1 }])} className="w-full rounded-xl border border-dashed border-gray-300 px-4 py-3 text-xs font-medium text-gray-500 transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600">
        + 添加自定义端点
      </button>
    </div>
  )
}
