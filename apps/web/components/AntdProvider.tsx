'use client'

import { type ReactNode } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCn from 'antd/locale/zh_CN'
import enUs from 'antd/locale/en_US'

const themeToken = {
  colorPrimary: '#0d9488',
  colorPrimaryHover: '#14b8a6',
  colorPrimaryActive: '#0f766e',
  colorInfo: '#0d9488',
  colorSuccess: '#10B981',
  colorWarning: '#F59E0B',
  colorError: '#EF4444',
  colorLink: '#0d9488',
  borderRadius: 10,
  borderRadiusLG: 16,
  borderRadiusSM: 8,
  colorBgLayout: '#f8fafc',
  colorBgContainer: '#ffffff',
  colorBorder: '#e2e8f0',
  colorBorderSecondary: '#f1f5f9',
  colorText: '#0f172a',
  colorTextSecondary: '#64748b',
  colorTextTertiary: '#94a3b8',
  colorTextQuaternary: '#cbd5e1',
  controlHeight: 40,
  controlHeightLG: 44,
  controlHeightSM: 32,
  fontSize: 14,
  fontSizeSM: 13,
  wireframe: false,
}

export default function AntdProvider({
  children,
  locale,
}: {
  children: ReactNode
  locale: string
}) {
  const antdLocale = locale === 'en' ? enUs : zhCn

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        token: themeToken,
        components: {
          Button: {
            controlHeight: 40,
            controlHeightLG: 44,
            paddingInline: 20,
            fontWeight: 600,
            borderRadius: 10,
            borderRadiusLG: 12,
            borderRadiusSM: 8,
            primaryShadow: '0 1px 3px rgba(13, 148, 136, 0.2)',
          },
          Input: {
            controlHeight: 40,
            controlHeightLG: 44,
            borderRadius: 10,
            borderRadiusLG: 12,
            activeBorderColor: '#0d9488',
            hoverBorderColor: '#14b8a6',
          },
          InputNumber: {
            controlHeight: 40,
            borderRadius: 10,
            activeBorderColor: '#0d9488',
            hoverBorderColor: '#14b8a6',
          },
          Select: {
            controlHeight: 40,
            controlHeightLG: 44,
            borderRadius: 10,
            borderRadiusLG: 12,
          },
          Segmented: {
            borderRadius: 10,
          },
          Modal: {
            borderRadiusLG: 16,
          },
          Card: {
            borderRadiusLG: 16,
            headerBg: '#ffffff',
            headerFontSize: 15,
          },
          Table: {
            borderRadiusLG: 12,
            headerBg: '#f8fafc',
            headerColor: '#475569',
            rowHoverBg: '#f1f5f9',
          },
          Tabs: {
            horizontalItemPadding: '8px 16px',
            itemSelectedColor: '#0d9488',
            inkBarColor: '#14b8a6',
            itemHoverColor: '#334155',
            titleFontSize: 14,
          },
          Switch: {
            colorPrimary: '#14b8a6',
            colorPrimaryHover: '#0d9488',
          },
          Divider: {
            colorSplit: '#f1f5f9',
          },
        },
      }}
    >
      <AntdApp
        message={{ maxCount: 3 }}
        notification={{ placement: 'topRight' }}
      >
        {children}
      </AntdApp>
    </ConfigProvider>
  )
}
