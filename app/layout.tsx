import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '価値観マッチング',
  description: '直感で答える、理論に基づく相性診断',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  )
}
