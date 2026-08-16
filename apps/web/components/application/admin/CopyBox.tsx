'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Button, Tooltip } from 'antd'
import { CheckOutlined, CopyOutlined, DownOutlined, UpOutlined } from '@ant-design/icons'

interface CopyBoxProps {
  /** 要复制的文本内容 */
  value: string
  /** 标题（可选） */
  label?: string
  /** 描述文本（可选） */
  description?: ReactNode
  /** 自定义类名 */
  className?: string
  /** 是否用 monospace 字体（默认 true） */
  mono?: boolean
  /** 复制成功后的回调 */
  onCopied?: () => void
  /** 是否允许折叠长内容（默认 false）。开启后内容超过 collapsedLines 行时自动折叠。 */
  collapsible?: boolean
  /** 折叠时显示的行数（默认 6） */
  collapsedLines?: number
}

/** 折叠阈值：内容行数超过此值时启用折叠 */
const DEFAULT_COLLAPSED_LINES = 6

/**
 * 带一键复制功能的展示框。
 *
 * 使用 navigator.clipboard.writeText 并降级到 document.execCommand('copy')，
 * 复制成功后按钮短暂变为对勾状态，配合 antd message 提示。
 *
 * 当 `collapsible` 为 true 且内容行数超过 `collapsedLines` 时，
 * 内容默认折叠，点击底部按钮可展开/收起。
 */
export function CopyBox({
  value,
  label,
  description,
  className = '',
  mono = true,
  onCopied,
  collapsible = false,
  collapsedLines = DEFAULT_COLLAPSED_LINES,
}: CopyBoxProps) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const lineCount = useMemo(() => {
    if (!value) return 0
    return value.split('\n').length
  }, [value])

  const canCollapse = collapsible && lineCount > collapsedLines

  const handleCopy = async () => {
    if (!value?.trim()) return
    let ok = false
    try {
      await navigator.clipboard.writeText(value)
      ok = true
    } catch {
      // 降级方案：创建临时 textarea
      try {
        const ta = document.createElement('textarea')
        ta.value = value
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        ok = true
      } catch {
        ok = false
      }
    }

    if (ok) {
      setCopied(true)
      onCopied?.()
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className={`rounded-xl border border-gray-200 bg-gray-50 overflow-hidden ${className}`}>
      {(label || description) && (
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          {label && <p className="text-sm font-medium text-gray-900">{label}</p>}
          {description && <div className="text-xs text-gray-500 mt-1">{description}</div>}
        </div>
      )}
      <div className="flex items-start gap-2 p-4">
        <pre
          className={`flex-1 overflow-x-auto text-sm text-gray-700 whitespace-pre-wrap break-all ${
            mono ? 'font-mono' : ''
          } ${canCollapse && !expanded ? 'max-h-36 overflow-hidden' : ''}`}
          style={
            canCollapse && !expanded
              ? { maxHeight: `${collapsedLines * 1.5}rem` }
              : undefined
          }
        >
          {value || '（无内容）'}
        </pre>
        <Tooltip title={copied ? '已复制' : '一键复制'}>
          <Button
            type="text"
            size="small"
            icon={copied ? <CheckOutlined style={{ color: '#10b981' }} /> : <CopyOutlined />}
            onClick={() => void handleCopy()}
            className="flex-shrink-0 mt-0.5"
          />
        </Tooltip>
      </div>
      {canCollapse && (
        <div className="border-t border-gray-100 px-4 py-2">
          <Button
            type="text"
            size="small"
            onClick={() => setExpanded((v) => !v)}
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            className="text-gray-500 hover:text-gray-700"
          >
            {expanded ? '收起' : `展开全部（${lineCount} 行）`}
          </Button>
        </div>
      )}
    </div>
  )
}

export default CopyBox
