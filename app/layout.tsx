import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '価値観マッチング｜直感で答える、理論に基づく相性診断',
  description:
    '8つの問いに直感で答えるだけ。心理学の「類似性」と「相補性」から、価値観が重なる最高の理解者と、自分にない視点をくれる最強の相棒を見つけます。',
  applicationName: '価値観マッチング',
  openGraph: {
    title: '価値観マッチング',
    description: '直感で答える、理論に基づく相性診断',
    type: 'website',
    locale: 'ja_JP',
  },
  appleWebApp: {
    capable: true,
    title: '価値観マッチング',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#F7F5F2',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <head>
        {/* Hiragino / 游明朝 を持たない環境（主に Android）向けの明朝フォールバック */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@500;600;700&display=swap"
        />
      </head>
      <body className="antialiased">
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  )
}
