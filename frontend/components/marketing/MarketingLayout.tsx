import MarkdownHeader from './Header'
import MarkdownFooter from './Footer'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <MarkdownHeader />
      <main className="flex-1">{children}</main>
      <MarkdownFooter />
    </div>
  )
}