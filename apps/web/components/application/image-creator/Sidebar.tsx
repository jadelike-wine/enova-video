'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  AppstoreOutlined,
  CameraOutlined,
  MenuFoldOutlined,
  CrownOutlined,
  EditOutlined,
  FileImageOutlined,
  HomeOutlined,
  SettingOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import type { SidebarItem } from './types.js'

export interface SidebarProps {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  credits?: number | string
  userName?: string
  userEmail?: string
  userAvatarUrl?: string
  activeItem?: string
  items?: SidebarItem[]
}

const defaultItems: SidebarItem[] = [
  { id: 'home', label: '首页', href: '/app', icon: <HomeOutlined /> },
  { id: 'inspiration', label: '灵感', href: '/app/images', icon: <CrownOutlined /> },
  { id: 'generate', label: '生成', href: '/app/images', icon: <EditOutlined />, active: true },
  { id: 'assets', label: '素材库', href: '/app/assets', icon: <FileImageOutlined /> },
  { id: 'canvas', label: '画布', href: '/app/canvas', icon: <AppstoreOutlined /> },
  { id: 'video', label: '视频生成', href: '/app/videos', icon: <VideoCameraOutlined /> },
  { id: 'settings', label: '设置', href: '/app/settings', icon: <SettingOutlined /> },
]

export default function Sidebar({
  collapsed,
  onCollapsedChange,
  credits = 0,
  userName = '创作者',
  userEmail,
  userAvatarUrl,
  activeItem = 'generate',
  items = defaultItems,
}: SidebarProps) {
  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 220 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="image-creator-sidebar"
      aria-label="创作工作台导航"
    >
      <div className="image-creator-sidebar__brand">
        <span className="image-creator-sidebar__brand-mark" aria-hidden="true"><CameraOutlined /></span>
        <motion.span animate={{ opacity: collapsed ? 0 : 1 }} className="image-creator-sidebar__brand-label">灵动创影</motion.span>
        <button
          type="button"
          className="image-creator-sidebar__collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <MenuFoldOutlined rotate={collapsed ? 180 : 0} />
        </button>
      </div>
      <nav className="image-creator-sidebar__nav">
        {items.map((item) => {
          const active = item.active ?? item.id === activeItem
          const content = <><span className="image-creator-sidebar__icon">{item.icon}</span><motion.span animate={{ opacity: collapsed ? 0 : 1 }} className="image-creator-sidebar__label">{item.label}</motion.span></>
          return item.href && !item.disabled ? <Link key={item.id} href={item.href} className={`image-creator-sidebar__item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>{content}</Link> : <span key={item.id} className={`image-creator-sidebar__item${active ? ' is-active' : ''}${item.disabled ? ' is-disabled' : ''}`}>{content}</span>
        })}
      </nav>
      <div className="image-creator-sidebar__footer">
        <div className="image-creator-sidebar__credits" title={`${credits} Credits`}><CrownOutlined /><motion.span animate={{ opacity: collapsed ? 0 : 1 }}><strong>{credits}</strong> Credits</motion.span></div>
        <div className="image-creator-sidebar__user">
          {userAvatarUrl ? <img src={userAvatarUrl} alt="" /> : <span className="image-creator-sidebar__avatar">{userName.slice(0, 1)}</span>}
          <motion.span animate={{ opacity: collapsed ? 0 : 1 }} className="image-creator-sidebar__user-copy"><strong>{userName}</strong>{userEmail && <small>{userEmail}</small>}</motion.span>
        </div>
      </div>
    </motion.aside>
  )
}
