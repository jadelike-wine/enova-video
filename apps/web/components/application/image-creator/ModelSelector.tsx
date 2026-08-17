'use client'

import { Select } from 'antd'
import { IMAGE_MODELS, IMAGE_QUALITY_SIZES, IMAGE_RATIOS, getImageOutputDimensions } from '../../../lib/models.js'
import styles from './image-creator.module.css'

export interface ModelSelectorProps {
  model: string
  ratio: string
  size: string
  onModelChange: (value: string) => void
  onRatioChange: (value: string) => void
  onSizeChange: (value: string) => void
  disabled?: boolean
  className?: string
}

export default function ModelSelector({ model, ratio, size, onModelChange, onRatioChange, onSizeChange, disabled, className = '' }: ModelSelectorProps) {
  const dimensions = getImageOutputDimensions(size, ratio)
  return <div className={`${styles['image-creator-model-selector']} ${className}`}>
    <Select aria-label="模型" value={model} disabled={disabled} onChange={onModelChange} options={IMAGE_MODELS.map((item) => ({ value: item.apiId, label: item.name }))} />
    <Select aria-label="比例" value={ratio} disabled={disabled} onChange={onRatioChange} options={IMAGE_RATIOS.map((item) => ({ value: item.id, label: item.label }))} />
    <Select aria-label="清晰度" value={size} disabled={disabled} onChange={onSizeChange} options={IMAGE_QUALITY_SIZES.map((item) => ({ value: item.id, label: item.label }))} />
    {dimensions && <span className="image-creator-model-selector__dimensions">{dimensions}</span>}
  </div>
}
