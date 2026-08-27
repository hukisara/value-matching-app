'use client'

import React, { useRef, useState, useEffect } from 'react'

const EMPTY = ['', '', '', '']

/**
 * 4桁パスコード入力。
 * 1マス1文字にすることで「何桁必要か」が見た瞬間にわかる。
 * ・入力すると自動で次のマスへ、Backspace で前のマスへ
 * ・4桁の貼り付けを1回で受け取る
 * ・スマホでは数字キーパッドが立ち上がる
 */
export function PasscodeInput({
  value,
  onChange,
  onComplete,
}: {
  value: string
  onChange: (v: string) => void
  onComplete?: () => void
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const [cells, setCells] = useState<string[]>(() =>
    EMPTY.map((_, i) => value[i] ?? '')
  )

  // URL の ?room= などで外から値が入ったときに同期する
  useEffect(() => {
    if (value !== cells.join('')) {
      setCells(EMPTY.map((_, i) => value[i] ?? ''))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const commit = (next: string[]) => {
    setCells(next)
    onChange(next.join(''))
    return next.join('')
  }

  const handleChange = (i: number, raw: string) => {
    const only = raw.replace(/\D/g, '')

    if (!only) {
      const next = [...cells]
      next[i] = ''
      commit(next)
      return
    }

    // 貼り付け：複数桁をまとめて流し込む
    if (only.length > 1) {
      const next = [...EMPTY]
      only.slice(0, 4).split('').forEach((d, k) => (next[k] = d))
      const joined = commit(next)
      refs.current[Math.min(only.length, 3)]?.focus()
      if (joined.length === 4) onComplete?.()
      return
    }

    const next = [...cells]
    next[i] = only.slice(-1)
    const joined = commit(next)
    if (i < 3) refs.current[i + 1]?.focus()
    else if (joined.length === 4) onComplete?.()
  }

  const handleKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !cells[i] && i > 0) {
      e.preventDefault()
      const next = [...cells]
      next[i - 1] = ''
      commit(next)
      refs.current[i - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < 3) refs.current[i + 1]?.focus()
    if (e.key === 'Enter') onComplete?.()
  }

  return (
    <div className="flex gap-2.5" role="group" aria-label="4桁のパスコード">
      {cells.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          value={d}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          aria-label={`パスコード ${i + 1}桁目`}
          className="u-num h-[68px] w-full flex-1 rounded-[14px] border border-line bg-paper-sunken text-center font-mono text-[30px] font-semibold text-ink outline-none transition-all duration-300 ease-apple focus:border-ai focus:bg-white focus:shadow-[0_0_0_4px_rgba(39,64,107,0.10)]"
        />
      ))}
    </div>
  )
}
