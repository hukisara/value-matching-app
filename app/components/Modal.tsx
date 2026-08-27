'use client'

import React, { useEffect } from 'react'
import { cx, Eyebrow } from './ui'

/**
 * シート型モーダル。
 * ・スマホでは下から立ち上がるボトムシート、デスクトップでは中央のカード
 * ・背景はぼかし + 減光（Apple の Materials に倣い、内容が下に透ける）
 * ・Esc で閉じる / 背景クリックで閉じる / 背後のスクロールをロック
 */
export function Modal({
  open,
  onClose,
  eyebrow,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  eyebrow?: string
  title: string
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-[rgba(20,18,16,0.32)] backdrop-blur-[6px] animate-fade"
        onClick={onClose}
      />
      <div
        className={cx(
          'relative z-10 flex max-h-[88dvh] w-full flex-col overflow-hidden bg-paper-raised',
          'rounded-t-[26px] border border-line shadow-lift animate-sheet',
          'sm:max-w-lg sm:rounded-[26px]'
        )}
      >
        {/* スマホ用のつまみ */}
        <div className="flex justify-center pt-3 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-line-strong" />
        </div>

        <header className="flex items-start justify-between gap-4 px-6 pb-5 pt-5 sm:px-8 sm:pt-8">
          <div>
            {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
            <h3 className="u-title text-[20px] text-ink">{title}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="u-press -mr-1 -mt-1 flex h-9 w-9 flex-none items-center justify-center rounded-full text-ink-faint hover:bg-paper-sunken hover:text-ink"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="relative min-h-0 flex-1">
          <div className="u-no-scrollbar h-full overflow-y-auto overscroll-contain px-6 pb-9 sm:px-8 sm:pb-10">
            {children}
          </div>
          {/* まだ下に続くことを示すフェード */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-paper-raised to-transparent" />
        </div>
      </div>
    </div>
  )
}
