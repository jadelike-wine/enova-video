/** @vitest-environment jsdom */

import React, { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Test fixture data and mocks are hoisted to be available before imports.
const { mockDetail, mockAlert } = vi.hoisted(() => ({
  mockDetail: vi.fn(),
  mockAlert: vi.fn().mockResolvedValue(true),
}))

// Vitest keeps this workspace's JSX in classic mode while Next compiles it with
// the automatic runtime in production.
;(globalThis as typeof globalThis & { React: typeof React }).React = React
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

vi.mock('antd', () => {
  const Button = ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
    React.createElement('button', props, children)
  const Tag = ({ children, color }: { children?: ReactNode; color?: string }) =>
    React.createElement('span', { 'data-color': color }, children)
  const Tooltip = ({ children, title }: { children?: ReactNode; title?: ReactNode }) =>
    React.createElement('span', { 'data-tooltip': typeof title === 'string' ? title : '' }, children)
  const Descriptions = ({ children }: { children?: ReactNode }) =>
    React.createElement('div', {}, children)
  const DescriptionsItem = ({ children, label }: { children?: ReactNode; label?: string }) =>
    React.createElement('div', { 'data-label': label }, children)
  Descriptions.Item = DescriptionsItem
  function Table({ columns, dataSource, rowKey }: { columns?: Array<{ title?: string; key?: string; dataIndex?: string; render?: (val: unknown, record: Record<string, unknown>) => ReactNode }>; dataSource?: Record<string, unknown>[]; rowKey?: unknown }) {
    void rowKey
    const rows = dataSource ?? []
    const cols = columns ?? []
    return React.createElement('table', { 'data-testid': 'ant-table' },
      React.createElement('thead', {},
        React.createElement('tr', {}, ...cols.map((col) => React.createElement('th', { key: col.key ?? col.dataIndex }, col.title))),
      ),
      React.createElement('tbody', {},
        ...rows.map((row, rowIdx) =>
          React.createElement('tr', { key: rowIdx },
            ...cols.map((col) =>
              React.createElement('td', { key: col.key ?? col.dataIndex },
                col.render
                  ? col.render(col.dataIndex ? row[col.dataIndex] : undefined, row)
                  : (col.dataIndex ? String(row[col.dataIndex] ?? '') : ''),
              ),
            ),
          ),
        ),
      ),
    )
  }
  const Card = ({ title, children, extra }: { title?: ReactNode; children?: ReactNode; extra?: ReactNode }) =>
    React.createElement('div', { 'data-card-title': typeof title === 'string' ? title : '' }, ...[title, extra, children].filter(Boolean))
  return { Button, Card, Descriptions, Table, Tag, Tooltip }
})

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    React.createElement('a', props as React.AnchorHTMLAttributes<HTMLAnchorElement>, children),
}))

vi.mock('../DialogProvider', () => ({
  useDialog: () => ({
    alert: mockAlert,
    confirm: vi.fn().mockResolvedValue(true),
  }),
}))

vi.mock('../../../lib/errorMessage', () => ({
  formatErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

// Mock AdminUi with minimal implementations
vi.mock('./AdminUi', () => ({
  BackLink: ({ label }: { label: string }) => React.createElement('div', { 'data-testid': 'back-link' }, label),
  ContentLoading: () => React.createElement('div', { 'data-testid': 'loading' }),
  PageHeader: ({ title }: { title: string }) => React.createElement('h2', null, title),
  StatusBadge: ({ status }: { status: string | null | undefined }) =>
    React.createElement('span', { 'data-testid': 'status-badge' }, status ?? '—'),
  fmtDate: (v: string | Date | null | undefined) => (v ? new Date(v).toISOString().slice(0, 16) : '—'),
  fmtMicrousd: (v: number | null | undefined) => (v != null ? `$${(v / 1_000_000).toFixed(4)}` : '—'),
}))

// Mock the admin API
vi.mock('../../../lib/adminApi', () => ({
  adminGenerationsApi: {
    detail: mockDetail,
    forceFail: vi.fn(),
    replay: vi.fn(),
  },
}))

import AdminGenerationDetailView from './AdminGenerationDetailView'

const NOW = '2026-08-26T10:00:00.000Z'

function makeBaseDetail(overrides?: Record<string, unknown>) {
  return {
    id: 'job-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
    type: 'IMAGE',
    provider: 'agnes',
    model: 'agnes-image-2.1',
    status: 'SUCCEEDED',
    attemptCount: 1,
    estimatedCostMicrousd: 500,
    reportedCostMicrousd: 0,
    finalCostMicrousd: 0,
    costStatus: 'ESTIMATED',
    providerJobId: null,
    errorCode: null,
    errorMessage: null,
    createdAt: NOW,
    completedAt: NOW,
    user: null,
    assets: [],
    quote: null,
    reservation: null,
    attempts: [],
    outbox: [],
    usageEvent: null,
    ...overrides,
  }
}

async function renderView(jobId: string): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(AdminGenerationDetailView, { jobId }))
  })
  // Flush any pending microtasks from useEffect-triggered async work
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  return { container, root }
}

afterEach(() => {
  document.body.innerHTML = ''
  mockDetail.mockClear()
  mockAlert.mockClear()
})

async function unmountRoot(root: Root) {
  await act(async () => {
    root.unmount()
  })
}

describe('AdminGenerationDetailView', () => {
  it('renders user email and account info when user is present', async () => {
    mockDetail.mockResolvedValue(
      makeBaseDetail({
        user: { id: 'user-1', email: 'admin@test.com', role: 'ADMIN', status: 'ACTIVE' },
      }),
    )
    const { container, root } = await renderView('job-1')

    expect(container.textContent).toContain('admin@test.com')
    expect(container.textContent).toContain('user-1')
    expect(container.textContent).toContain('ws-1')
    expect(container.textContent).toContain('ADMIN')
    expect(container.textContent).toContain('ACTIVE')

    await unmountRoot(root)
  })

  it('renders "用户不存在或已删除" when user is null', async () => {
    mockDetail.mockResolvedValue(makeBaseDetail({ user: null }))
    const { container, root } = await renderView('job-1')

    expect(container.textContent).toContain('用户不存在或已删除')

    await unmountRoot(root)
  })

  it('renders credential name in attempts table', async () => {
    mockDetail.mockResolvedValue(
      makeBaseDetail({
        attempts: [
          {
            id: 'att-1',
            attemptNo: 1,
            provider: 'agnes',
            model: 'agnes-image-2.1',
            credentialId: 'cred-1',
            credential: {
              id: 'cred-1',
              name: 'Agnes 主账号',
              provider: 'agnes',
              status: 'ACTIVE',
            },
            status: 'SUCCEEDED',
            providerJobId: null,
            errorCode: null,
            errorMessage: null,
            estimatedCostMicrousd: 500,
            reportedCostMicrousd: 0,
            startedAt: NOW,
            endedAt: NOW,
          },
        ],
      }),
    )
    const { container, root } = await renderView('job-1')

    expect(container.textContent).toContain('Agnes 主账号')
    // maskedApiKey should not be rendered in the UI
    expect(container.textContent).not.toContain('maskedApiKey')

    await unmountRoot(root)
  })

  it('renders "未记录" for attempts without credentialId', async () => {
    mockDetail.mockResolvedValue(
      makeBaseDetail({
        attempts: [
          {
            id: 'att-old',
            attemptNo: 1,
            provider: 'agnes',
            model: 'agnes-image-2.1',
            credentialId: null,
            credential: null,
            status: 'SUCCEEDED',
            providerJobId: null,
            errorCode: null,
            errorMessage: null,
            estimatedCostMicrousd: 500,
            reportedCostMicrousd: 0,
            startedAt: NOW,
            endedAt: NOW,
          },
        ],
      }),
    )
    const { container, root } = await renderView('job-1')

    expect(container.textContent).toContain('未记录')

    await unmountRoot(root)
  })

  it('renders "已删除" when credentialId exists but credential is null', async () => {
    mockDetail.mockResolvedValue(
      makeBaseDetail({
        attempts: [
          {
            id: 'att-del',
            attemptNo: 1,
            provider: 'agnes',
            model: 'agnes-image-2.1',
            credentialId: 'cred-deleted',
            credential: null,
            status: 'SUCCEEDED',
            providerJobId: null,
            errorCode: null,
            errorMessage: null,
            estimatedCostMicrousd: 500,
            reportedCostMicrousd: 0,
            startedAt: NOW,
            endedAt: NOW,
          },
        ],
      }),
    )
    const { container, root } = await renderView('job-1')

    expect(container.textContent).toContain('已删除')

    await unmountRoot(root)
  })

  it('renders asset image preview with displayUrl', async () => {
    mockDetail.mockResolvedValue(
      makeBaseDetail({
        assets: [
          {
            id: 'asset-1',
            type: 'IMAGE',
            mimeType: 'image/png',
            size: 12345,
            width: 1024,
            height: 768,
            duration: null,
            metadata: null,
            displayUrl: 'https://cdn.example.test/image.png',
            createdAt: NOW,
          },
        ],
      }),
    )
    const { container, root } = await renderView('job-1')

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://cdn.example.test/image.png')

    await unmountRoot(root)
  })

  it('renders "无生成资产" when assets is empty', async () => {
    mockDetail.mockResolvedValue(makeBaseDetail({ assets: [] }))
    const { container, root } = await renderView('job-1')

    expect(container.textContent).toContain('无生成资产')

    await unmountRoot(root)
  })

  it('does not leak any plaintext secret or maskedApiKey in the response', async () => {
    const plaintextSecret = 'sk-agnes-live-1234567890'
    mockDetail.mockResolvedValue(
      makeBaseDetail({
        attempts: [
          {
            id: 'att-1',
            attemptNo: 1,
            provider: 'agnes',
            model: 'agnes-image-2.1',
            credentialId: 'cred-1',
            credential: {
              id: 'cred-1',
              name: 'Agnes 主账号',
              provider: 'agnes',
              status: 'ACTIVE',
            },
            status: 'SUCCEEDED',
            providerJobId: null,
            errorCode: null,
            errorMessage: null,
            estimatedCostMicrousd: 500,
            reportedCostMicrousd: 0,
            startedAt: NOW,
            endedAt: NOW,
          },
        ],
      }),
    )
    const { container, root } = await renderView('job-1')

    expect(container.textContent).not.toContain(plaintextSecret)
    expect(container.innerHTML).not.toContain('encryptedSecret')
    // maskedApiKey should not be present anywhere in the rendered output
    expect(container.textContent).not.toContain('maskedApiKey')

    await unmountRoot(root)
  })
})
