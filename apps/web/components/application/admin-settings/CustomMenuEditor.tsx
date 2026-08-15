'use client'

import { useEffect, useState } from 'react'

import type { CustomMenuItem } from '../../../lib/api'

export type EditableCustomMenuItem = CustomMenuItem & { enabled: boolean }

export interface CustomMenuEditorProps {
  value: string
  onChange: (value: string) => void
}

function makeId(prefix: string): string {
  const cryptoObject = globalThis.crypto
  return cryptoObject?.randomUUID ? `${prefix}-${cryptoObject.randomUUID()}` : `${prefix}-${Date.now()}`
}

function normalizeItem(raw: unknown, index: number): EditableCustomMenuItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<EditableCustomMenuItem>
  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : `menu-${index + 1}`,
    label: typeof item.label === 'string' ? item.label : '',
    url: typeof item.url === 'string' ? item.url : '',
    visibility: item.visibility === 'admin' ? 'admin' : 'user',
    enabled: item.enabled !== false,
    sortOrder: typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder) ? item.sortOrder : index + 1,
  }
}

export function parseCustomMenuItems(value: string): EditableCustomMenuItem[] {
  if (!value.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.map((item, index) => normalizeItem(item, index)).filter((item): item is EditableCustomMenuItem => item !== null)
      : []
  } catch {
    return []
  }
}

export function serializeCustomMenuItems(items: EditableCustomMenuItem[]): string {
  return JSON.stringify(
    [...items]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map(({ id, label, url, visibility, enabled, sortOrder }) => ({
        id,
        label,
        url,
        visibility,
        enabled,
        sortOrder,
      })),
  )
}

function resequence(items: EditableCustomMenuItem[]): EditableCustomMenuItem[] {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((item, index) => ({ ...item, sortOrder: index + 1 }))
}

export default function CustomMenuEditor({ value, onChange }: CustomMenuEditorProps) {
  const [items, setItems] = useState(() => parseCustomMenuItems(value))
  const [invalidJson, setInvalidJson] = useState(() => Boolean(value.trim()) && parseCustomMenuItems(value).length === 0)

  useEffect(() => {
    setItems(parseCustomMenuItems(value))
    setInvalidJson(Boolean(value.trim()) && parseCustomMenuItems(value).length === 0)
  }, [value])

  const commit = (next: EditableCustomMenuItem[]) => {
    setItems(next)
    setInvalidJson(false)
    onChange(serializeCustomMenuItems(next))
  }

  const updateItem = (index: number, patch: Partial<EditableCustomMenuItem>) => {
    commit(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)))
  }

  const moveItem = (index: number, direction: -1 | 1) => {
    const ordered = resequence(items)
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    const [item] = ordered.splice(index, 1)
    ordered.splice(target, 0, item)
    commit(resequence(ordered))
  }

  return (
    <div data-testid="custom-menu-editor" className="space-y-3">
      {invalidJson && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700" role="alert">
          当前菜单配置无法解析，保存前请通过下方字段重新整理。
        </p>
      )}
      {items.length === 0 && !invalidJson && <p className="text-xs text-gray-400">暂无自定义菜单页面。</p>}
      {items.map((item, index) => (
        <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50/70 p-4" data-testid={`custom-menu-item-${index}`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-700">菜单项 {index + 1}</span>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="上移菜单项" disabled={index === 0} onClick={() => moveItem(index, -1)} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-white disabled:opacity-40">上移</button>
              <button type="button" aria-label="下移菜单项" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-white disabled:opacity-40">下移</button>
              <button type="button" aria-label="删除菜单项" onClick={() => commit(resequence(items.filter((_, itemIndex) => itemIndex !== index)))} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">删除</button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-gray-500">
              菜单名称
              <input data-testid={`custom-menu-item-${index}-label`} value={item.label} onChange={(event) => updateItem(index, { label: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary-400" />
            </label>
            <label className="text-xs text-gray-500">
              菜单 ID
              <input value={item.id} onChange={(event) => updateItem(index, { id: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary-400" />
            </label>
            <label className="text-xs text-gray-500 md:col-span-2">
              页面 URL
              <input value={item.url} type="url" onChange={(event) => updateItem(index, { url: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary-400" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-600">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={item.enabled} onChange={(event) => updateItem(index, { enabled: event.target.checked })} />启用</label>
            <label className="inline-flex items-center gap-2">可见范围
              <select value={item.visibility} onChange={(event) => updateItem(index, { visibility: event.target.value as EditableCustomMenuItem['visibility'] })} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs">
                <option value="user">普通用户</option>
                <option value="admin">仅管理员</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-2">排序
              <input type="number" min={1} value={item.sortOrder} onChange={(event) => updateItem(index, { sortOrder: Number(event.target.value) || 1 })} className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs" />
            </label>
          </div>
        </div>
      ))}
      <button type="button" data-testid="custom-menu-add" onClick={() => commit([...items, { id: makeId('menu'), label: '', url: 'https://', visibility: 'user', enabled: true, sortOrder: items.length + 1 }])} className="w-full rounded-xl border border-dashed border-gray-300 px-4 py-3 text-xs font-medium text-gray-500 transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600">
        + 添加菜单页面
      </button>
    </div>
  )
}
