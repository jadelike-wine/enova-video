'use client'

import { type ReactNode } from 'react'
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd'
import zhCn from 'antd/locale/zh_CN'
import enUs from 'antd/locale/en_US'

const themeToken = {
  colorPrimary: '#7C3AED',
  colorInfo: '#7C3AED',
  colorSuccess: '#10B981',
  colorWarning: '#F59E0B',
  colorError: '#EF4444',
  colorLink: '#06B6D4',
  borderRadius: 10,
  borderRadiusLG: 12,
  borderRadiusSM: 8,
  colorBgLayout: '#f7f7f8',
  controlHeight: 40,
  controlHeightLG: 44,
  fontSize: 14,
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
          },
          Input: {
            controlHeight: 40,
            controlHeightLG: 44,
          },
          Select: {
            controlHeight: 40,
            controlHeightLG: 44,
          },
          Modal: {
            borderRadiusLG: 16,
          },
          Card: {
            borderRadiusLG: 16,
          },
          Table: {
            borderRadiusLG: 12,
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
