'use client'

import { motion } from 'framer-motion'
import { PictureOutlined, UserOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { CreationTemplate } from './types.js'

const templates: Array<CreationTemplate & { icon: React.ReactNode }> = [
  { id: 'product', title: '商品图生成', description: '干净、专业的产品视觉', prompt: '一张高级电商商品图，柔和影棚光，干净背景，突出产品材质与细节', icon: <PictureOutlined /> },
  { id: 'portrait', title: '人物写真', description: '自然有表现力的人像', prompt: '一张自然光人物写真，电影感构图，细腻肤质，轻松自然的情绪', icon: <UserOutlined /> },
  { id: 'poster', title: '科技海报', description: '大胆鲜明的视觉海报', prompt: '一张未来感科技海报，深色背景，霓虹光线，几何构图，视觉冲击力强', icon: <ThunderboltOutlined /> },
]

export interface CreationTemplatesProps { onSelect: (prompt: string) => void; items?: Array<CreationTemplate & { icon?: React.ReactNode }> }

export default function CreationTemplates({ onSelect, items = templates }: CreationTemplatesProps) {
  return <div className="image-creator-templates" aria-label="创作模板">{items.map((template) => <motion.button key={template.id} type="button" className="image-creator-template" whileHover={{ y: -3 }} whileFocus={{ y: -3 }} onClick={() => onSelect(template.prompt)}><span className="image-creator-template__visual" aria-hidden="true">{template.icon}</span><span><strong>{template.title}</strong>{template.description && <small>{template.description}</small>}</span></motion.button>)}</div>
}
