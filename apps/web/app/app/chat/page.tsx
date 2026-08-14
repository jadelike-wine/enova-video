import type { Metadata } from 'next'
import ChatView from '../../../components/application/ChatView'
import { appMetadata } from '../../../lib/seo'
import AppShell from '../AppShell'

export async function generateMetadata(): Promise<Metadata> {
  return appMetadata('AI 对话', '/app/chat')
}

export default function ChatPage() {
  return (
    <AppShell>
      <ChatView />
    </AppShell>
  )
}