import type { Config } from 'tailwindcss'

/**
 * デザイントークン
 * ------------------------------------------------------------------
 * コンセプト：「価値観の輪郭を、静かに描く」
 * 紙のような温かいニュートラルの上に、日本の伝統色である
 * 藍（あい）と朱（しゅ）の2色だけを置く。
 * 藍＝類似性 / 選択肢A、朱＝相補性 / 選択肢B、という意味を持たせ、
 * 装飾ではなく情報として色を使う。
 */
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#F7F5F2', // ページ地色（温かみのあるオフホワイト）
          raised: '#FFFFFF',  // カード
          sunken: '#F1EDE7',  // 沈み込む面（インセット）
          deep: '#EAE5DD',
        },
        ink: {
          DEFAULT: '#141210', // 主文字
          soft: '#4B453C',    // 副文字
          muted: '#6E675D',   // 補足（小さい文字でもAA準拠）
          faint: '#9A9288',   // 装飾ラベル
        },
        line: {
          DEFAULT: '#E6E1D9',
          strong: '#D2CBBF',
        },
        ai: {                 // 藍：類似性 / 選択肢A / 自分
          DEFAULT: '#27406B',
          deep: '#1B2E4E',
          soft: '#EDF1F7',
          line: '#C6D2E4',
        },
        shu: {                // 朱：相補性 / 選択肢B / 相手
          DEFAULT: '#A85336',
          deep: '#823E27',
          soft: '#F9F0EB',
          line: '#E7D0C4',
        },
        matcha: {             // 完了・肯定
          DEFAULT: '#4F6B54',
          soft: '#EDF2ED',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        serif: ['var(--font-serif)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        xs: '6px',
        sm: '10px',
        md: '14px',
        lg: '20px',
        xl: '26px',
        '2xl': '32px',
      },
      boxShadow: {
        hairline: '0 0 0 1px rgba(20,18,16,0.06)',
        card: '0 1px 2px rgba(20,18,16,0.04), 0 12px 32px -20px rgba(20,18,16,0.22)',
        lift: '0 2px 4px rgba(20,18,16,0.05), 0 20px 44px -24px rgba(20,18,16,0.30)',
        press: 'inset 0 1px 2px rgba(20,18,16,0.10)',
        float: '0 8px 24px -8px rgba(20,18,16,0.24)',
      },
      transitionTimingFunction: {
        apple: 'cubic-bezier(0.32, 0.72, 0, 1)',
        quint: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      letterSpacing: {
        display: '-0.03em',
        title: '-0.015em',
        wide: '0.06em',
        widest: '0.18em',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fade: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        sheet: {
          '0%': { opacity: '0', transform: 'translateY(24px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        rise: 'rise 0.62s cubic-bezier(0.22, 1, 0.36, 1) both',
        fade: 'fade 0.5s ease-out both',
        sheet: 'sheet 0.42s cubic-bezier(0.32, 0.72, 0, 1) both',
        breathe: 'breathe 2.4s ease-in-out infinite',
        sweep: 'sweep 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      },
    },
  },
  plugins: [],
}

export default config
