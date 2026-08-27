'use client'

import React from 'react'
import { cx } from './ui'

export interface MapPoint {
  id: string
  name: string
  nx: number
  ny: number
  title: string
  isMe: boolean
}

export interface MapLink {
  a: string
  b: string
  percent: number
}

/** 正規化座標(-100〜100) → プロット内のパーセント位置 */
const px = (nx: number) => 50 + nx * 0.4
const py = (ny: number) => 50 - ny * 0.4

/**
 * 価値観2Dマップ。
 * 8次元の回答を2軸に圧縮した散布図に、シンクロ率60%以上の線を重ねる。
 * ・軸ラベルはプロットの外側に置き、図の中を情報だけにする
 * ・人数が多いときは番号 + 凡例に切り替え、名前の重なりを避ける
 */
export function ValueMap({ points, links }: { points: MapPoint[]; links: MapLink[] }) {
  const useLegend = points.length > 6

  // 名前チップの上下配置を決める（近すぎるものは反対側へ逃がす）
  const placed: Array<{ x: number; y: number; below: boolean }> = []
  const sides = points.map((p) => {
    const x = px(p.nx)
    const y = py(p.ny)
    let below = y < 78 // 下端に近い点はラベルを上に出す
    const clash = placed.some(
      (q) => Math.abs(q.x - x) < 18 && Math.abs(q.y - y) < 8 && q.below === below
    )
    if (clash) below = !below
    placed.push({ x, y, below })
    return below
  })

  const AxisLabel = ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => (
    <span
      className={cx(
        'select-none text-[10px] font-semibold tracking-[0.14em] text-ink-faint',
        className
      )}
    >
      {children}
    </span>
  )

  const Quadrant = ({ label, className }: { label: string; className: string }) => (
    <span
      className={cx(
        'pointer-events-none absolute select-none text-[9px] font-semibold tracking-[0.08em] text-ink-faint/70',
        className
      )}
    >
      {label}
    </span>
  )

  return (
    <div>
      <div className="mx-auto max-w-[420px]">
        <AxisLabel className="mb-2 block text-center">規律・論理的 ↑</AxisLabel>

        {/* --- プロット本体 --- */}
        <div className="relative aspect-square w-full overflow-hidden rounded-[16px] border border-line bg-paper-sunken">
          {/* 基準線 */}
          <div className="absolute left-0 top-1/2 h-px w-full bg-line-strong/70" />
          <div className="absolute left-1/2 top-0 h-full w-px bg-line-strong/70" />
          <div className="absolute left-1/2 top-1/2 h-[78%] w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line" />
          <div className="absolute left-1/2 top-1/2 h-[40%] w-[40%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line" />

          <Quadrant label="堅実なる守護者" className="left-2.5 top-2.5" />
          <Quadrant label="論理的イノベーター" className="right-2.5 top-2.5" />
          <Quadrant label="心優しきバランサー" className="bottom-2.5 left-2.5" />
          <Quadrant label="情熱的チャレンジャー" className="bottom-2.5 right-2.5" />

          {/* 関係線 */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            {links.map((l, i) => {
              const p1 = points.find((p) => p.id === l.a)
              const p2 = points.find((p) => p.id === l.b)
              if (!p1 || !p2) return null
              const strong = l.percent >= 80
              return (
                <line
                  key={i}
                  x1={`${px(p1.nx)}%`}
                  y1={`${py(p1.ny)}%`}
                  x2={`${px(p2.nx)}%`}
                  y2={`${py(p2.ny)}%`}
                  stroke="#27406B"
                  strokeOpacity={strong ? 0.42 : 0.18}
                  strokeWidth={strong ? 1.6 : 1}
                  strokeDasharray={strong ? undefined : '3 4'}
                  strokeLinecap="round"
                />
              )
            })}
          </svg>

          {/* 参加者 */}
          {points.map((p, i) => (
            <div
              key={p.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${px(p.nx)}%`, top: `${py(p.ny)}%` }}
            >
              <span
                className={cx(
                  'block rounded-full transition-transform duration-700 ease-quint',
                  p.isMe
                    ? 'h-3.5 w-3.5 bg-ink shadow-[0_0_0_4px_rgba(20,18,16,0.10)]'
                    : 'h-2.5 w-2.5 border-[1.5px] border-ai bg-white'
                )}
              />
              {useLegend ? (
                <span
                  className={cx(
                    'u-num absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] font-bold',
                    p.isMe ? 'text-paper' : 'text-ai'
                  )}
                >
                  {i + 1}
                </span>
              ) : (
                <span
                  className={cx(
                    'pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[6px] border px-1.5 py-[3px] text-[10px] font-semibold shadow-[0_1px_2px_rgba(20,18,16,0.05)]',
                    sides[i] ? 'top-[calc(100%+5px)]' : 'bottom-[calc(100%+5px)]',
                    p.isMe
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line bg-white/92 text-ink-soft backdrop-blur-sm'
                  )}
                >
                  {p.name.replace('(Bot)', '')}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* 横軸は左右の端に置く。縦組みは環境によって崩れるため使わない */}
        <div className="mt-2 flex items-center justify-between">
          <AxisLabel>← 保守・受動</AxisLabel>
          <AxisLabel>革新・能動 →</AxisLabel>
        </div>
        <AxisLabel className="mt-1.5 block text-center">↓ 柔軟・共感的</AxisLabel>
      </div>

      {/* --- 凡例 --- */}
      {useLegend && (
        <ul className="mx-auto mt-6 grid max-w-[420px] grid-cols-2 gap-x-4 gap-y-2">
          {points.map((p, i) => (
            <li key={p.id} className="flex items-center gap-2 text-[12px]">
              <span
                className={cx(
                  'u-num flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[9px] font-bold',
                  p.isMe ? 'bg-ink text-paper' : 'border border-ai/40 text-ai'
                )}
              >
                {i + 1}
              </span>
              <span className="truncate font-semibold text-ink">
                {p.name.replace('(Bot)', '')}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-line pt-4 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-ink" />あなた
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ai bg-white" />ほかの参加者
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="20" height="6" aria-hidden>
            <line x1="0" y1="3" x2="20" y2="3" stroke="#27406B" strokeOpacity="0.42" strokeWidth="1.6" />
          </svg>
          80%以上
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="20" height="6" aria-hidden>
            <line x1="0" y1="3" x2="20" y2="3" stroke="#27406B" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="3 4" />
          </svg>
          60%以上
        </span>
      </div>
    </div>
  )
}
