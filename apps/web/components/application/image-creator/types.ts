import type { TaskItem } from '../task-types'

/** The image modes supported by the existing image-generation form. */
export type GenerationMode = 'text2img' | 'img2img' | 'multi_img'

/** The view model used by the image creator, normalized from a Generation. */
export interface ImageTask extends TaskItem {
  status: string
  prompt?: string
  mode?: string
  size?: string
  ratio?: string
  model?: string
  input_images?: string[]
  output_url?: string
  error_message?: unknown
  created_at?: string
}

/** A local or previously uploaded image attached to the composer. */
export interface InputImage {
  file?: File
  preview: string
}

/** Values owned by the existing image-generation form. */
export interface ImageFormValues {
  model: string
  mode: string
  prompt: string
  size: string
  ratio: string
}

export type ComposerControlId = 'mode' | 'model' | 'ratio' | 'size'

export interface ComposerControlOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export interface ComposerControl {
  id: ComposerControlId
  label: string
  value: string
  options: ComposerControlOption[]
  disabled?: boolean
}

export interface CreationTemplate {
  id: string
  title: string
  description?: string
  prompt: string
  imageUrl?: string
  accentClassName?: string
}

/** The four presentational states of the generation canvas. */
export type PreviewState = 'empty' | 'generating' | 'success' | 'error'
export type CanvasState = PreviewState

export type ImageCardAction =
  | 'download'
  | 'regenerate'
  | 'edit'
  | 'copy-prompt'
  | 'favorite'
  | 'delete'

export interface ImageCardActions {
  onDownload?: (task: ImageTask) => void | Promise<void>
  onRegenerate?: (task: ImageTask) => void
  onEdit?: (task: ImageTask) => void
  onCopyPrompt?: (prompt?: string) => void | Promise<void>
  onFavorite?: (task: ImageTask, favorite: boolean) => void
  onDelete?: (task: ImageTask) => void
}
