'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'
import { publicApi, type LegalDocument } from '../../../lib/api'

export default function LegalDocumentPage() {
  const t = useTranslations('legal')
  const params = useParams<{ slug: string }>()
  const [document, setDocument] = useState<LegalDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const slug = params.slug
    let active = true
    setLoading(true)
    setNotFound(false)
    publicApi
      .legalDocument(slug)
      .then((next) => {
        if (active) setDocument(next)
      })
      .catch(() => {
        if (active) {
          setDocument(null)
          setNotFound(true)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [params.slug])

  if (loading) return <main className="mx-auto max-w-3xl p-8 text-gray-500">{t('loading')}</main>
  if (notFound || !document) return <main className="mx-auto max-w-3xl p-8 text-gray-500">{t('notFound')}</main>

  const html = DOMPurify.sanitize(marked.parse(document.contentMd, { breaks: true }) as string)
  return (
    <main className="mx-auto max-w-3xl p-6 sm:p-10">
      <article className="glass-card p-6 sm:p-10">
        <h1 className="text-3xl font-bold text-gray-900">{document.title}</h1>
        <div
          className="prose prose-gray mt-8 max-w-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </article>
    </main>
  )
}
