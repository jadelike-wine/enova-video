'use client'

/**
 * 工作区顶部 header。
 *
 * 聊天流模式下不再展示标题/参数（它们属于生成结果卡片）。
 * 这里只保留一个极简的间距占位，确保内容区域从合理的位置开始。
 */
export default function WorkspaceHeader() {
  return <header className="sr-only" aria-hidden="true" />
}
