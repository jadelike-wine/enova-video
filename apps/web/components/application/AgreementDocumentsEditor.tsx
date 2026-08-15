'use client'

import { useEffect, useState } from 'react'
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

export default function AgreementDocumentsEditor({ value, onChange }: AgreementDocumentsEditorProps) {
  const [documents, setDocuments] = useState<AgreementDocumentDraft[]>(() => parseAgreementDocuments(value))

  useEffect(() => {
    setDocuments(parseAgreementDocuments(value))
  }, [value])

  const update = (next: AgreementDocumentDraft[]) => {
    setDocuments(next)
    onChange(JSON.stringify(next))
  }

  return (
    <div className="space-y-3">
      {documents.length === 0 && (
        <Empty
          description="暂无协议文档。添加后将展示在登录 / 注册页面，例如服务条款、隐私政策。"
        />
      )}

      {documents.map((document, index) => (
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
                value={document.slug}
                placeholder="例如：terms"
                onChange={(event) =>
                  update(documents.map((item, i) => (i === index ? { ...item, slug: event.target.value } : item)))
                }
              />
              <p className="mt-1 text-[11px] text-gray-400">
                访问路径：<code className="font-mono">/legal/{document.slug || '…'}</code>
              </p>
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
      ))}

      <Button
        onClick={() => update([...documents, { slug: `document-${documents.length + 1}`, title: '', contentMd: '' }])}
      >
        添加文档
      </Button>
    </div>
  )
}
