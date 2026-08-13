'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  conversationApi,
  sendMessageStream,
  type Conversation,
  type Message,
} from '../../lib/api'
import { renderMarkdown } from '../../lib/markdown'
import { userTokenCount } from '../../lib/tokens'
import { useDialog } from './DialogProvider'
import { useClipboard } from './useClipboard'
import TrashIcon from './TrashIcon'

// 文本对话功能已永久删除，保留以下内联值仅用于兼容已有页面
const TEXT_MODELS = [{ apiId: 'agnes-2.0-flash', name: '通用对话' }]
const DEFAULT_MODEL = 'agnes-2.0-flash'

function nowISO(): string {
  return new Date().toISOString()
}

function formatDateTime(value?: string): string {
  if (!value) return ''
  const normalized = typeof value === 'string' && !value.includes('T') ? value.replace(' ', 'T') : value
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatDuration(ms?: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function ChatView() {
  const params = useParams<{ id?: string }>()
  const router = useRouter()
  const { confirm, alert } = useDialog()
  const { copyText, isCopied } = useClipboard()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConv, setCurrentConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL)
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens] = useState(4096)
  const [enableThinking, setEnableThinking] = useState(false)
  const [editingConvId, setEditingConvId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [streamingStartedAt, setStreamingStartedAt] = useState<string | null>(null)
  const [streamingError, setStreamingError] = useState('')
  const [notFound, setNotFound] = useState(false)

  const messagesEl = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  const currentId = params?.id || null

  const modelLabel = useCallback(
    (modelId: string) => TEXT_MODELS.find((m) => m.apiId === modelId)?.name || modelId,
    [],
  )

  const senderName = useCallback(
    (msg: Message) => {
      if (msg.role === 'user') return '用户'
      return modelLabel(msg.model || selectedModel)
    },
    [modelLabel, selectedModel],
  )

  const scrollBottom = useCallback(() => {
    if (messagesEl.current) {
      messagesEl.current.scrollTop = messagesEl.current.scrollHeight
    }
  }, [])

  const loadConversations = useCallback(async () => {
    setConversations(await conversationApi.list(100))
  }, [])

  const loadConversation = useCallback(
    async (id: string) => {
      try {
        const [conv, msgs] = await Promise.all([
          conversationApi.get(id),
          conversationApi.listMessages(id),
        ])
        setNotFound(false)
        setCurrentConv(conv)
        setMessages(msgs)
        requestAnimationFrame(scrollBottom)
      } catch (err) {
        const message = (err as Error).message || ''
        if (/not found|不存在/i.test(message) || (err as { code?: string }).code === 'GENERATION_NOT_FOUND') {
          setNotFound(true)
          setCurrentConv(null)
          setMessages([])
        } else {
          await alert({ title: '加载失败', message, confirmVariant: 'danger' })
        }
      }
    },
    [scrollBottom, alert],
  )

  const newConversation = useCallback(async () => {
    const conv = await conversationApi.create('新对话')
    setSelectedModel(DEFAULT_MODEL)
    await loadConversations()
    router.push(`/app/chat/${conv.id}`)
  }, [loadConversations, router])

  const deleteConv = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      const ok = await confirm({
        title: '删除对话',
        message: '确定删除此对话？删除后无法恢复。',
        confirmText: '删除',
        cancelText: '取消',
        confirmVariant: 'danger',
      })
      if (!ok) return
      await conversationApi.remove(id)
      await loadConversations()
      if (currentConv?.id === id) {
        setCurrentConv(null)
        setMessages([])
        router.push('/app/chat')
      }
    },
    [confirm, loadConversations, currentConv, router],
  )

  const startRename = useCallback((conv: Conversation, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setEditingConvId(conv.id)
    setEditingTitle(conv.title)
    requestAnimationFrame(() => editInputRef.current?.focus())
  }, [])

  const cancelRename = useCallback(() => setEditingConvId(null), [])

  const isEditingInHeader = (convId: string) => editingConvId === convId && currentConv?.id === convId
  const isEditingInSidebar = (convId: string) => editingConvId === convId && currentConv?.id !== convId

  const saveRename = useCallback(
    async (convId: string) => {
      const title = editingTitle.trim()
      const original = conversations.find((c) => c.id === convId)?.title
      setEditingConvId(null)
      if (!title || title === original) return
      try {
        const updated = await conversationApi.rename(convId, title)
        setConversations((list) => list.map((c) => (c.id === convId ? updated : c)))
        if (currentConv?.id === convId) {
          setCurrentConv((c) => (c ? { ...c, title: updated.title } : c))
        }
      } catch (err) {
        await alert({ title: '重命名失败', message: (err as Error).message, confirmVariant: 'danger' })
      }
    },
    [editingTitle, conversations, currentConv, alert],
  )

  const selectConversation = useCallback(
    async (conv: Conversation) => {
      if (editingConvId) cancelRename()
      if (currentConv?.id === conv.id) return
      router.push(`/app/chat/${conv.id}`)
    },
    [editingConvId, currentConv, cancelRename, router],
  )

  const chatPayload = useCallback(
    () => ({
      model: selectedModel,
      temperature,
      max_tokens: maxTokens,
      enable_thinking: enableThinking,
    }),
    [selectedModel, temperature, maxTokens, enableThinking],
  )

  const beginStreaming = () => {
    setLoading(true)
    setStreaming(true)
    setStreamContent('')
    setStreamingError('')
    setStreamingStartedAt(nowISO())
  }

  const finishStreaming = () => {
    setStreaming(false)
    setLoading(false)
    setStreamContent('')
    setStreamingStartedAt(null)
  }

  const handleStreamDone = useCallback(async () => {
    finishStreaming()
    loadConversations()
    if (currentConv?.id) {
      await loadConversation(currentConv.id)
    }
  }, [loadConversations, currentConv, loadConversation])

  const handleStreamError = useCallback(
    async (err: string) => {
      finishStreaming()
      setStreamingError(typeof err === 'string' ? err : '消息发送失败，请稍后重试。')
    },
    [],
  )

  const submitContent = useCallback(
    (content: string) => {
      if (!currentConv) return
      setMessages((prev) => [...prev, { role: 'user', content, createdAt: nowISO() } as Message])
      beginStreaming()
      requestAnimationFrame(scrollBottom)
      sendMessageStream(
        currentConv.id,
        { content, ...chatPayload() },
        (chunk) => {
          setStreamContent((prev) => prev + chunk)
          requestAnimationFrame(scrollBottom)
        },
        handleStreamDone,
        handleStreamError,
      )
    },
    [currentConv, chatPayload, handleStreamDone, handleStreamError, scrollBottom],
  )

  const send = useCallback(async () => {
    if (!input.trim() || loading) return
    if (!currentConv) {
      const conv = await conversationApi.create(input.trim().slice(0, 30))
      await loadConversations()
      router.replace(`/app/chat/${conv.id}`)
      setCurrentConv(conv)
      // 等待路由切换后由 id useEffect 加载，这里直接发送
      const content = input.trim()
      setInput('')
      setTimeout(() => submitContent(content), 50)
      return
    }
    const content = input.trim()
    setInput('')
    submitContent(content)
  }, [input, loading, currentConv, loadConversations, router, submitContent])

  // Initial load
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await loadConversations()
      if (cancelled) return
      if (currentId) {
        await loadConversation(currentId)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load conversation when id changes
  useEffect(() => {
    if (loading || streaming) return
    if (currentId) {
      loadConversation(currentId)
    } else {
      setNotFound(false)
      setCurrentConv(null)
      setMessages([])
      setSelectedModel(DEFAULT_MODEL)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  const userIcon = (
    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  )
  const aiIcon = (
    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73A2 2 0 0112 2zM7 14a1 1 0 100 2 1 1 0 000-2zm10 0a1 1 0 100 2 1 1 0 000-2z" />
    </svg>
  )

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-80 border-r border-gray-200 flex flex-col bg-gray-50">
        <div className="p-4 border-b border-gray-200">
          <button onClick={newConversation} className="btn-primary w-full flex items-center justify-center gap-2">
            <span className="text-lg">+</span> 新建对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => selectConversation(conv)}
              className={`group flex items-center justify-between px-4 py-3 rounded-2xl cursor-pointer transition-all duration-200 text-sm border ${
                currentConv?.id === conv.id
                  ? 'bg-gradient-to-r from-fuchsia-500/20 to-cyan-400/10 border-gray-300 text-white'
                  : 'border-gray-200 hover:bg-gray-100 hover:border-gray-300 text-gray-700 hover:text-gray-900'
              }`}
            >
              <div className="truncate flex-1 min-w-0">
                {isEditingInSidebar(conv.id) ? (
                  <input
                    ref={editInputRef}
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename(conv.id)
                      if (e.key === 'Escape') cancelRename()
                    }}
                    onBlur={cancelRename}
                    onClick={(e) => e.stopPropagation()}
                    className="input-field text-sm py-1.5 px-2.5 w-full"
                  />
                ) : (
                  <p className="truncate font-semibold">{conv.title}</p>
                )}
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {editingConvId === conv.id ? (
                  <>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation()
                        saveRename(conv.id)
                      }}
                      className="w-7 h-7 rounded-xl flex items-center justify-center text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 transition-all"
                      title="保存"
                    >
                      ✓
                    </button>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation()
                        cancelRename()
                      }}
                      className="w-7 h-7 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-all"
                      title="取消"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={(e) => startRename(conv, e)}
                      className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-all"
                      title="重命名"
                    >
                      ✎
                    </button>
                    <button
                      onClick={(e) => deleteConv(conv.id, e)}
                      className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-xl flex items-center justify-center text-gray-500 hover:bg-rose-100 hover:text-rose-600 transition-all"
                      title="删除"
                    >
                      <TrashIcon />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!conversations.length && (
            <p className="text-center text-gray-400 text-sm py-12">暂无对话，点击上方开始</p>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-4 flex-wrap bg-gray-50">
          {currentConv && (
            <div className="flex items-center gap-2 min-w-0 max-w-[240px]">
              {isEditingInHeader(currentConv.id) ? (
                <>
                  <input
                    ref={editInputRef}
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename(currentConv.id)
                      if (e.key === 'Escape') cancelRename()
                    }}
                    onBlur={cancelRename}
                    className="input-field text-sm py-1.5 px-2.5 w-full"
                  />
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => saveRename(currentConv.id)}
                    className="btn-ghost text-xs px-2 py-1 text-emerald-600 hover:text-emerald-700 flex-shrink-0"
                    title="保存"
                  >
                    ✓
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={cancelRename}
                    className="btn-ghost text-xs px-2 py-1 text-gray-500 hover:text-gray-900 flex-shrink-0"
                    title="取消"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <span className="font-semibold text-gray-900 truncate">{currentConv.title}</span>
                  <button
                    onClick={() => startRename(currentConv)}
                    className="btn-ghost text-xs px-2 py-1 text-gray-500 hover:text-gray-900 flex-shrink-0"
                    title="重命名"
                  >
                    ✎
                  </button>
                </>
              )}
            </div>
          )}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="select-field w-auto text-sm"
          >
            {TEXT_MODELS.map((m) => (
              <option key={m.apiId} value={m.apiId}>
                {m.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 glass px-3 py-2 rounded-2xl">
            温度
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-24 accent-fuchsia-500"
            />
            <span className="w-8 text-fuchsia-600 font-semibold">{temperature}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 glass px-3 py-2 rounded-2xl cursor-pointer">
            <input
              type="checkbox"
              checked={enableThinking}
              onChange={(e) => setEnableThinking(e.target.checked)}
              className="rounded accent-fuchsia-500"
            />
            Thinking 模式
          </label>
        </div>

        {/* Messages */}
        <div ref={messagesEl} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {notFound && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-3xl bg-rose-100 flex items-center justify-center text-3xl mb-5 border border-gray-200">
                🗑️
              </div>
              <p className="text-lg font-bold text-gray-900">对话不存在或已被删除</p>
              <p className="text-sm mt-2 text-gray-500">该对话可能已被删除，或链接已失效。</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link href="/app/chat" className="btn-secondary text-sm px-4 py-2">
                  返回聊天列表
                </Link>
                <button onClick={newConversation} className="btn-primary text-sm px-4 py-2">
                  新建对话
                </button>
              </div>
            </div>
          )}

          {!notFound && !messages.length && !streaming && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <div className="w-20 h-20 rounded-3xl bg-fuchsia-100 flex items-center justify-center text-4xl mb-5 border border-gray-200">
                💬
              </div>
              <p className="text-xl font-bold bg-gradient-to-r from-fuchsia-600 to-cyan-600 bg-clip-text text-transparent">
                开始对话
              </p>
              <p className="text-sm mt-2 text-gray-400">支持多轮对话、流式输出、Token 统计</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={msg.id ?? i} className="flex gap-3 justify-start">
              <div
                className={`w-10 h-10 rounded-2xl flex-shrink-0 flex items-center justify-center border shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-br from-fuchsia-500/90 to-violet-600/90 border-fuchsia-400/30'
                    : 'bg-gradient-to-br from-cyan-500/80 to-fuchsia-500/80 border-cyan-400/30'
                }`}
                title={senderName(msg)}
              >
                {msg.role === 'user' ? userIcon : aiIcon}
              </div>

              <div className="flex-1 min-w-0 max-w-4xl group/msg">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{senderName(msg)}</span>
                  <span className="text-xs text-gray-400">{formatDateTime(msg.createdAt)}</span>
                </div>

                <div
                  className={`rounded-3xl px-5 py-4 text-sm leading-relaxed border border-gray-200 ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-fuchsia-500/25 to-violet-600/20 text-white'
                      : 'glass text-gray-800'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div
                      className="markdown-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}

                  {msg.role === 'user' && (
                    <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500 flex items-center gap-3 flex-wrap">
                      <div className="flex gap-3 flex-wrap flex-1 min-w-0">
                        <span>📊 {userTokenCount(msg)} tokens</span>
                      </div>
                      <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => copyText(msg.content, `msg-${msg.id ?? i}`)}
                          className={`px-2 py-1 rounded-lg transition-colors ${
                            isCopied(`msg-${msg.id ?? i}`)
                              ? 'text-emerald-600 bg-emerald-100'
                              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                          }`}
                        >
                          {isCopied(`msg-${msg.id ?? i}`) ? '已复制' : '复制'}
                        </button>
                      </div>
                    </div>
                  )}

                  {msg.role === 'assistant' && (
                    <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500 flex items-center gap-3 flex-wrap">
                      <div className="flex gap-3 flex-wrap flex-1 min-w-0">
                        {msg.outputTokens > 0 ? (
                          <span>
                            📊 {msg.inputTokens} + {msg.outputTokens} = {msg.inputTokens + msg.outputTokens} tokens
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => copyText(msg.content, `msg-${msg.id ?? i}`)}
                          className={`px-2 py-1 rounded-lg transition-colors ${
                            isCopied(`msg-${msg.id ?? i}`)
                              ? 'text-emerald-600 bg-emerald-100'
                              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                          }`}
                        >
                          {isCopied(`msg-${msg.id ?? i}`) ? '已复制' : '复制'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Streaming */}
          {streaming && (
            <div className="flex gap-3 justify-start">
              <div
                className="w-10 h-10 rounded-2xl flex-shrink-0 flex items-center justify-center border shadow-sm bg-gradient-to-br from-cyan-500/80 to-fuchsia-500/80 border-cyan-400/30"
                title={modelLabel(selectedModel)}
              >
                {aiIcon}
              </div>
              <div className="flex-1 min-w-0 max-w-4xl group/msg">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{modelLabel(selectedModel)}</span>
                  <span className="text-xs text-gray-400">{formatDateTime(streamingStartedAt ?? undefined)}</span>
                  <span className="badge-progress text-[10px]">生成中</span>
                </div>
                <div className="glass rounded-3xl px-5 py-4 text-sm border border-gray-200">
                  {streamContent ? (
                    <>
                      <div
                        className="markdown-body"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(streamContent) }}
                      />
                      <span className="inline-block w-2 h-4 bg-gradient-to-b from-fuchsia-400 to-cyan-400 animate-pulse ml-1 rounded-full align-middle" />
                    </>
                  ) : (
                    <p className="text-gray-500">正在思考...</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {streamingError && (
            <div className="glass-card border border-rose-400/30 bg-rose-500/10 py-3 px-4 text-sm text-rose-600">
              {streamingError}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-5 border-t border-gray-200 bg-gray-50">
          <div className="flex gap-3 max-w-4xl mx-auto">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={2}
              placeholder={notFound ? '对话不存在，无法发送消息' : '输入消息，Enter 发送...'}
              className="input-field flex-1 resize-none"
              disabled={loading || notFound}
            />
            <button onClick={send} disabled={loading || notFound || !input.trim()} className="btn-primary self-end px-8">
              {loading ? '生成中...' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}