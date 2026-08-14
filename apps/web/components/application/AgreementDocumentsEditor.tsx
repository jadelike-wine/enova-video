'use client'

import { useEffect, useState } from 'react'

interface AgreementDocumentDraft {
  slug: string
  title: string
  contentMd: string
}

interface AgreementDocumentsEditorProps {
  value: string
  onChange: (value: string) => void
}

function parseDocuments(value: string): AgreementDocumentDraft[] {
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

export default function AgreementDocumentsEditor({ value, onChange }: AgreementDocumentsEditorProps) {
  const [documents, setDocuments] = useState<AgreementDocumentDraft[]>(() => parseDocuments(value))

  useEffect(() => {
    setDocuments(parseDocuments(value))
  }, [value])

  const update = (next: AgreementDocumentDraft[]) => {
    setDocuments(next)
    onChange(JSON.stringify(next))
  }

  return (
    <div className="flex-1 space-y-3">
      {documents.map((document, index) => (
        <div key={index} className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input-field"
              value={document.title}
              placeholder="文档名称"
              onChange={(event) => update(documents.map((item, i) => i === index ? { ...item, title: event.target.value } : item))}
            />
            <input
              className="input-field"
              value={document.slug}
              placeholder="路由标识，如 terms"
              onChange={(event) => update(documents.map((item, i) => i === index ? { ...item, slug: event.target.value } : item))}
            />
          </div>
          <textarea
            className="input-field min-h-32 font-mono text-xs"
            value={document.contentMd}
            placeholder="Markdown 内容"
            onChange={(event) => update(documents.map((item, i) => i === index ? { ...item, contentMd: event.target.value } : item))}
          />
          <button
            type="button"
            className="text-xs text-rose-600 hover:underline"
            onClick={() => update(documents.filter((_, i) => i !== index))}
          >
            删除文档
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-secondary text-sm"
        onClick={() => update([...documents, { slug: `document-${documents.length + 1}`, title: '', contentMd: '' }])}
      >
        添加文档
      </button>
    </div>
  )
}
