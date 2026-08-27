'use client'

import React from 'react'

/* ==================================================================
   共通プリミティブ
   すべての画面がここから部品を取る。画面ごとに見た目を作らない。
   ================================================================== */

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

/* --- ページ土台 --------------------------------------------------- */
export function Screen({
  children,
  width = 'md',
  center = false,
  minH = true,
  className,
}: {
  children: React.ReactNode
  width?: 'sm' | 'md' | 'lg'
  center?: boolean
  minH?: boolean
  className?: string
}) {
  const max = width === 'sm' ? 'max-w-[26rem]' : width === 'lg' ? 'max-w-3xl' : 'max-w-md'
  return (
    <main
      className={cx(
        'w-full px-5 sm:px-6',
        minH && 'min-h-[100dvh]',
        center && 'flex flex-col justify-center',
        className
      )}
    >
      <div className={cx('mx-auto w-full', max)}>{children}</div>
    </main>
  )
}

/* --- 小さなラベル ------------------------------------------------- */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <span className={cx('u-eyebrow block', className)}>{children}</span>
}

/* --- ボタン ------------------------------------------------------- */
type ButtonProps = {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'outline' | 'quiet'
  size?: 'sm' | 'md' | 'lg'
  full?: boolean
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
  'aria-label'?: string
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  full,
  disabled,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const sizes: Record<string, string> = {
    sm: 'h-9 px-4 text-[13px] rounded-full gap-1.5',
    md: 'h-12 px-6 text-[15px] rounded-[14px] gap-2',
    lg: 'h-[58px] px-8 text-[17px] rounded-[16px] gap-2.5',
  }
  const variants: Record<string, string> = {
    primary:
      'bg-ink text-paper shadow-[0_1px_2px_rgba(20,18,16,0.18),0_10px_24px_-14px_rgba(20,18,16,0.7)] hover:bg-[#241f1a] disabled:bg-paper-deep disabled:text-ink-faint disabled:shadow-none',
    secondary:
      'bg-ai text-white shadow-[0_1px_2px_rgba(27,46,78,0.2),0_10px_24px_-14px_rgba(27,46,78,0.8)] hover:bg-ai-deep disabled:bg-paper-deep disabled:text-ink-faint disabled:shadow-none',
    outline:
      'bg-paper-raised text-ink border border-line hover:border-line-strong hover:bg-white disabled:border-line/60 disabled:bg-transparent disabled:text-ink-faint',
    quiet:
      'bg-transparent text-ink-muted hover:text-ink hover:bg-[rgba(20,18,16,0.05)]',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'u-press inline-flex items-center justify-center font-semibold tracking-[0.02em]',
        'disabled:cursor-not-allowed disabled:active:scale-100',
        sizes[size],
        variants[variant],
        full && 'w-full',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/* --- カード ------------------------------------------------------- */
export function Card({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <div className={cx('u-card', padded && 'p-6 sm:p-8', className)}>{children}</div>
  )
}

/* --- 見出し ------------------------------------------------------- */
export function SectionHead({
  index,
  eyebrow,
  title,
  lead,
  align = 'left',
}: {
  index?: string
  eyebrow?: string
  title: string
  lead?: string
  align?: 'left' | 'center'
}) {
  return (
    <header className={cx('mb-6', align === 'center' && 'text-center')}>
      <div
        className={cx(
          'mb-3 flex items-center gap-3',
          align === 'center' && 'justify-center'
        )}
      >
        {index && (
          <span className="u-num font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-faint">
            {index}
          </span>
        )}
        {index && <span className="h-px w-6 bg-line-strong" />}
        {eyebrow && <Eyebrow className="!text-ink-muted">{eyebrow}</Eyebrow>}
      </div>
      <h2 className="u-title text-[22px] text-ink sm:text-[26px]">{title}</h2>
      {lead && (
        <p
          className={cx(
            'u-body mt-3 text-[13px] text-ink-muted',
            align === 'center' && 'mx-auto max-w-md'
          )}
        >
          {lead}
        </p>
      )}
    </header>
  )
}

/* --- 区切り ------------------------------------------------------- */
export function Divider({ label }: { label?: string }) {
  if (!label) return <div className="u-rule my-8" />
  return (
    <div className="relative my-7 flex items-center">
      <div className="h-px flex-1 bg-line" />
      <span className="u-eyebrow px-4">{label}</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  )
}

/* --- アバター ----------------------------------------------------- */
const AVATAR_TONES = [
  { bg: '#EDF1F7', fg: '#27406B' }, // 藍
  { bg: '#F9F0EB', fg: '#A85336' }, // 朱
  { bg: '#EDF2ED', fg: '#4F6B54' }, // 松葉
  { bg: '#F3EFE7', fg: '#7A6A4F' }, // 砂
  { bg: '#F0EDF2', fg: '#5E4F6B' }, // 藤
  { bg: '#EFF1F1', fg: '#4C5A5C' }, // 錆浅葱
]

export function toneOf(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

export function Avatar({
  name,
  isMe = false,
  size = 32,
  className,
}: {
  name: string
  isMe?: boolean
  size?: number
  className?: string
}) {
  const clean = name.replace('(Bot)', '').trim()
  const tone = toneOf(clean)
  return (
    <span
      className={cx(
        'inline-flex flex-none items-center justify-center rounded-full font-semibold',
        isMe && 'ring-1 ring-ink/15',
        className
      )}
      style={{
        width: size,
        height: size,
        background: isMe ? '#141210' : tone.bg,
        color: isMe ? '#F7F5F2' : tone.fg,
        fontSize: Math.round(size * 0.42),
        letterSpacing: '0.01em',
      }}
      aria-hidden
    >
      {clean.slice(0, 1) || '・'}
    </span>
  )
}

/* --- 入力欄 ------------------------------------------------------- */
export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  maxLength,
  onEnter,
  autoFocus,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
  onEnter?: () => void
  autoFocus?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[13px] font-semibold tracking-[0.04em] text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
      </span>
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter()
        }}
        className="h-14 w-full rounded-[14px] border border-line bg-paper-sunken px-5 text-[17px] font-medium text-ink placeholder:font-normal placeholder:text-ink-faint outline-none transition-all duration-300 ease-apple focus:border-ai focus:bg-white focus:shadow-[0_0_0_4px_rgba(39,64,107,0.10)]"
      />
    </label>
  )
}

/* --- 通知 --------------------------------------------------------- */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-5 flex items-start gap-2.5 rounded-[14px] border border-shu-line bg-shu-soft px-4 py-3 text-[13px] font-medium leading-relaxed text-shu-deep animate-fade"
    >
      <svg className="mt-[3px] h-3.5 w-3.5 flex-none" viewBox="0 0 14 14" fill="none" aria-hidden>
        <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.1" />
        <path d="M7 4v3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="7" cy="10" r="0.75" fill="currentColor" />
      </svg>
      <span>{children}</span>
    </div>
  )
}

/* --- 読み込み中の輪 ----------------------------------------------- */
export function Spinner({ size = 44 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex flex-none items-center justify-center"
      style={{ width: size, height: size }}
      role="status"
      aria-label="読み込み中"
    >
      <span className="absolute inset-0 rounded-full border border-line" />
      <span className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-ink [animation-duration:0.9s]" />
    </span>
  )
}

/* --- 進捗の輪 ----------------------------------------------------- */
export function ProgressRing({
  value,
  total,
  size = 76,
}: {
  value: number
  total: number
  size?: number
}) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  const ratio = total > 0 ? value / total : 0
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E6E1D9" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#27406B"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.32,0.72,0,1)' }}
        />
      </svg>
      <span className="u-num absolute text-[15px] font-bold tracking-tight text-ink">
        {value}
        <span className="text-[11px] font-semibold text-ink-faint">/{total}</span>
      </span>
    </span>
  )
}

/* --- ロゴマーク ---------------------------------------------------
   2つの円が重なる＝価値観の重なり。アプリのコンセプトそのもの。
   ------------------------------------------------------------------ */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.68} viewBox="0 0 34 23" fill="none" aria-hidden>
      <circle cx="12" cy="11.5" r="10" stroke="#27406B" strokeWidth="1.3" />
      <circle cx="22" cy="11.5" r="10" stroke="#A85336" strokeWidth="1.3" />
    </svg>
  )
}

/* --- スコア表示 ---------------------------------------------------- */
export function ScoreDial({
  percent,
  size = 168,
  tone = 'ai',
  caption,
}: {
  percent: number
  size?: number
  tone?: 'ai' | 'shu'
  caption?: string
}) {
  const stroke = 3
  const r = (size - stroke * 2 - 8) / 2
  const c = 2 * Math.PI * r
  const color = tone === 'ai' ? '#27406B' : '#A85336'
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EAE5DD" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
          style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.22,1,0.36,1) 0.2s' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        {caption && <span className="u-eyebrow mb-1">{caption}</span>}
        <span className="u-num flex items-baseline text-ink">
          <span
            className="font-semibold tracking-[-0.04em]"
            style={{ fontSize: size * 0.32, lineHeight: 1 }}
          >
            {percent}
          </span>
          <span className="ml-0.5 text-[15px] font-semibold text-ink-faint">%</span>
        </span>
      </div>
    </div>
  )
}
