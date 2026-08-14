'use client'

import { useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/i18n.config'
import { Button, Dropdown } from 'antd'
import { CheckOutlined, GlobalOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { locales, localeShortNames, type Locale } from '@/i18n.config'

export default function LanguageSwitcher() {
  const locale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()

  const switchTo = (nextLocale: Locale) => {
    if (nextLocale === locale) return
    // next-intl navigation: useRouter().replace 保持 pathname 不变，只替换 locale
    router.replace(pathname, { locale: nextLocale })
  }

  const items: MenuProps['items'] = locales.map((l) => ({
    key: l,
    label: (
      <div className="flex items-center justify-between w-full">
        <span>{localeShortNames[l]}</span>
        {l === locale && <CheckOutlined className="text-[#7C3AED]" />}
      </div>
    ),
    onClick: () => switchTo(l),
  }))

  return (
    <Dropdown menu={{ items }} placement="bottomRight">
      <Button
        type="text"
        size="small"
        icon={<GlobalOutlined />}
        className="flex items-center gap-1"
      >
        {localeShortNames[locale]}
      </Button>
    </Dropdown>
  )
}
