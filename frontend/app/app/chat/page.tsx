import type { Metadata } from 'next'
import ChatView from '../../../components/application/ChatView'
import { appMetadata } from '../../../lib/seo'

export const metadata: Metadata = appMetadata('AI 对话', '/app/chat')

export default function ChatPage() {
  return <ChatView />
}