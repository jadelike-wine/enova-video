'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Input } from 'antd'

export interface AgreementDocumentDraft {
  slug: string
  title: string
  contentMd: string
}

interface AgreementDocumentsEditorProps {
  value: string
  onChange: (value: string) => void
}

/**
 * 解析登录条款文档 JSON。容错处理：非法 JSON / 非数组返回空列表，
 * 每项仅保留 slug / title / contentMd 三个字符串字段，保持与后端约定一致。
 */
export function parseAgreementDocuments(value: string): AgreementDocumentDraft[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => {
      const document = item as Partial<AgreementDocumentDraft>
      return {
        slug: typeof document.slug === 'string' ? document.slug : '',
        title: typeof document.title === 'string' ? document.title : '',
        contentMd: typeof document.contentMd === 'string' ? document.contentMd : '',
      }
    })
  } catch {
    return []
  }
}

/**
 * 将文档 JSON 规范化为统一序列化格式（字段顺序固定）。
 * 用于初始化 draft，保证"内容未变 → 字符串未变 → 不产生脏标记"。
 */
export function normalizeDocumentsJson(value: string): string {
  return JSON.stringify(parseAgreementDocuments(value))
}

/**
 * 从路由标识中提取显示用的 slug 值。
 * 如果 slug 以 / 开头（完整路由路径），直接显示；否则将 slug 转为完整路径 `/legal/{slug}`。
 */
function slugToRoute(slug: string): string {
  const trimmed = (slug ?? '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/')) return trimmed
  return `/legal/${trimmed}`
}

/**
 * 从路由标识输入中提取 slug。
 * 如果以 / 开头，取最后一段路径段；否则直接使用输入值。
 */
function routeToSlug(route: string): string {
  const trimmed = (route ?? '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/')) {
    const segments = trimmed.split('/').filter(Boolean)
    return segments.length > 0 ? segments[segments.length - 1] : ''
  }
  return trimmed
}

export default function AgreementDocumentsEditor({ value, onChange }: AgreementDocumentsEditorProps) {
  const [documents, setDocuments] = useState<AgreementDocumentDraft[]>(() => parseAgreementDocuments(value))

  useEffect(() => {
    setDocuments(parseAgreementDocuments(value))
  }, [value])

  const update = (next: AgreementDocumentDraft[]) => {
    setDocuments(next)
    onChange(JSON.stringify(next))
  }

  // 校验路由标识：必须以 / 开头且不重复
  const routeErrors = useMemo<Record<number, string>>(() => {
    const errors: Record<number, string> = {}
    const routes = new Set<string>()

    documents.forEach((doc, index) => {
      const route = slugToRoute(doc.slug)
      if (!route.trim()) {
        errors[index] = '路由标识不能为空'
      } else if (!route.startsWith('/')) {
        errors[index] = '路由标识必须以 / 开头'
      } else {
        // 提取 slug 用于唯一性比较
        const slug = routeToSlug(route).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        if (routes.has(slug)) {
          errors[index] = '路由标识不能重复'
        } else {
          routes.add(slug)
        }
      }
    })

    return errors
  }, [documents])

  return (
    <div className="space-y-3">
      {documents.length === 0 && (
        <Empty
          description="暂无协议文档。添加后将展示在登录 / 注册页面，例如服务条款、隐私政策。"
        />
      )}

      {documents.map((document, index) => {
        const routeDisplay = slugToRoute(document.slug)
        return (
          <div key={index} className="space-y-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-gray-500">文档 {index + 1}</span>
              <Button
                size="small"
                danger
                onClick={() => update(documents.filter((_, i) => i !== index))}
              >
                删除文档
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-500">文档名称</label>
                <Input
                  value={document.title}
                  placeholder="例如：服务条款"
                  onChange={(event) =>
                    update(documents.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">路由标识</label>
                <Input
                  value={routeDisplay}
                  placeholder="例如：/legal/terms"
                  onChange={(event) =>
                    update(documents.map((item, i) => (i === index ? { ...item, slug: event.target.value } : item)))
                  }
                  status={routeErrors[index] ? 'error' : undefined}
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  访问路径：<code className="font-mono">{routeDisplay || '/legal/…'}</code>
                </p>
                {routeErrors[index] && (
                  <p className="mt-1 text-[11px] text-red-500">{routeErrors[index]}</p>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-500">Markdown 内容</label>
              <Input.TextArea
                className="min-h-40 font-mono text-xs leading-relaxed"
                value={document.contentMd}
                placeholder="输入 Markdown 格式的条款内容"
                autoSize={{ minRows: 6 }}
                onChange={(event) =>
                  update(documents.map((item, i) => (i === index ? { ...item, contentMd: event.target.value } : item)))
                }
              />
            </div>
          </div>
        )
      })}

      <Button
        onClick={() => update([...documents, { slug: '/legal/', title: '', contentMd: '' }])}
      >
        添加文档
      </Button>
    </div>
  )
}
