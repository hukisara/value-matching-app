'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { QUESTIONS, COLUMNS, DEVELOPER_THOUGHTS } from '@/lib/questions'
import { calculateResults } from '@/lib/matching'
import type { Room, Participant } from '@/types/database'
import {
  cx,
  Screen,
  Button,
  Card,
  Eyebrow,
  SectionHead,
  Divider,
  Avatar,
  TextField,
  Notice,
  Spinner,
  ProgressRing,
  ScoreDial,
  Mark,
} from './components/ui'
import { Modal } from './components/Modal'
import { PasscodeInput } from './components/PasscodeInput'
import { ValueMap, type MapPoint, type MapLink } from './components/ValueMap'

/* ==================================================================
   小さなヘルパー
   ================================================================== */
/** 「あきら(Bot)」→「あきら」 */
const clean = (name: string) => name.replace('(Bot)', '').trim()
const isBot = (name: string) => name.includes('(Bot)')
/** 「開放性（新奇性の探求 vs 保守性）」→「開放性」 */
const shortDim = (dim: string) => dim.split('（')[0]

interface MappedPoint {
  id: string
  name: string
  x: number
  y: number
  nx: number
  ny: number
  title: string
  isMe: boolean
}

type View = 'NAME_INPUT' | 'ROOM_SELECT' | 'LOBBY' | 'PLAYING' | 'WAITING' | 'CALCULATING' | 'RESULT'


/* ==================================================================
   画面をまたいで使う部品
   コンポーネント本体の中で定義すると毎レンダーで再マウントされ、
   入力フォーカスやアニメーションが飛ぶため、必ずトップレベルに置く。
   ================================================================== */

/** 上部の細いバー。ルーム内のどの画面でも位置が変わらない拠り所になる */
function AppBar({
  title,
  right,
}: {
  title?: string
  right?: React.ReactNode
}) {
  return (
    <div className="u-blur-bar sticky top-0 z-30 border-b border-line/80">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Mark size={22} />
          <span className="truncate text-[13px] font-semibold tracking-[0.02em] text-ink">
            {title ?? '価値観マッチング'}
          </span>
        </div>
        {right}
      </div>
    </div>
  )
}

/** 4桁のパスコードを1桁ずつのタイルで見せる（入力欄と同じ形にして対応づける） */
function PinTiles({ code }: { code: string }) {
  return (
    <div className="flex justify-center gap-2.5">
      {code.split('').map((d, i) => (
        <span
          key={i}
          className="u-num flex h-[74px] w-[58px] items-center justify-center rounded-[14px] border border-line bg-paper-raised font-mono text-[34px] font-semibold tracking-tight text-ink shadow-[0_1px_2px_rgba(20,18,16,0.04)]"
        >
          {d}
        </span>
      ))}
    </div>
  )
}

/** 名前 + BOTバッジ */
function NameTag({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <span className={cx('inline-flex items-baseline gap-1.5', className)}>
      <span className="truncate">{clean(name)}</span>
      {isBot(name) && (
        <span className="translate-y-[-1px] rounded-[4px] border border-line px-1 py-[1px] text-[9px] font-bold tracking-[0.08em] text-ink-faint">
          BOT
        </span>
      )}
    </span>
  )
}

/** 価値観の項目をチップで並べる */
function DimChips({ dims, tone }: { dims: string[]; tone: 'ai' | 'shu' }) {
  if (dims.length === 0) return null
  return (
    <ul className="flex flex-wrap justify-center gap-1.5">
      {dims.map((d, i) => (
        <li
          key={i}
          className={cx(
            'rounded-full border px-2.5 py-1 text-[11px] font-semibold',
            tone === 'ai'
              ? 'border-ai-line bg-ai-soft text-ai'
              : 'border-shu-line bg-shu-soft text-shu'
          )}
        >
          {shortDim(d)}
        </li>
      ))}
    </ul>
  )
}

/** 退出リンク。目立たせず、しかし常に同じ場所に置く */
function ExitLink({ onClick }: { onClick: () => void }) {
  return (
    <div className="pb-10 pt-12 text-center">
      <button
        onClick={onClick}
        className="u-press rounded-full px-4 py-2 text-[12px] font-semibold text-ink-faint hover:bg-[rgba(20,18,16,0.05)] hover:text-ink-muted"
      >
        最初からやり直す（退出）
      </button>
    </div>
  )
}

/** フッターのクレジット */
function Credit({
  onMethodology,
  onAlgorithm,
}: {
  onMethodology: () => void
  onAlgorithm: () => void
}) {
  return (
    <footer className="pb-10 pt-14">
      <div className="u-rule mb-7" />
      <div className="flex flex-col items-center gap-5">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={onMethodology}
            className="u-press rounded-full border border-line bg-paper-raised px-4 py-2 text-[12px] font-semibold text-ink-soft hover:border-line-strong hover:text-ink"
          >
            開発者の想い
          </button>
          <button
            onClick={onAlgorithm}
            className="u-press rounded-full border border-line bg-paper-raised px-4 py-2 text-[12px] font-semibold text-ink-soft hover:border-line-strong hover:text-ink"
          >
            アルゴリズムと理論
          </button>
        </div>
        <div className="flex items-center gap-2 opacity-70 transition-opacity duration-300 hover:opacity-100">
          <img
            src="/icon-dt.png"
            alt=""
            className="h-5 w-5 rounded-full object-cover grayscale"
          />
          <span className="u-eyebrow">Algorithm by D.T.</span>
        </div>
      </div>
    </footer>
  )
}

export default function Home() {
  const [userId, setUserId] = useState<string | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])

  const [currentView, setCurrentView] = useState<View>('NAME_INPUT')
  const [roomCode, setRoomCode] = useState('')
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [userName, setUserName] = useState('')
  const [isHost, setIsHost] = useState(false)

  const [currentQIdx, setCurrentQIdx] = useState(0)
  const [localAnswers, setLocalAnswers] = useState<number[]>([])

  const [errorMsg, setErrorMsg] = useState('')
  const [showMethodology, setShowMethodology] = useState(false)
  const [showAlgorithm, setShowAlgorithm] = useState(false)
  const [copySuccess, setCopySuccess] = useState('')
  const [isRestoring, setIsRestoring] = useState(true)
  const [columnIdx, setColumnIdx] = useState(0)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const roomParam = params.get('room')
      if (roomParam) {
        setJoinCodeInput(roomParam)
      }
    }
  }, [])

  useEffect(() => {
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) { setUserId(session.user.id); return }
      const { data, error } = await supabase.auth.signInAnonymously()
      if (error) { console.error('Auth error:', error); return }
      setUserId(data.user?.id ?? null)
    }
    initAuth()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) return
    let mounted = true
    
    const fetchInitial = async () => {
      const [roomsRes, partsRes] = await Promise.all([
        supabase.from('rooms').select('*'),
        supabase.from('participants').select('*'),
      ])
      if (!mounted) return

      const fetchedRooms = roomsRes.data ?? []
      const fetchedParts = partsRes.data ?? []
      
      setRooms(fetchedRooms)
      setParticipants(fetchedParts)

      if (isRestoring) {
        const myParts = fetchedParts
          .filter((p) => p.user_id === userId)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        const myLatestPart = myParts[0]
        
        const isRecent = myLatestPart && (Date.now() - new Date(myLatestPart.created_at).getTime() < 12 * 60 * 60 * 1000)

        if (isRecent) {
          const relatedRoom = fetchedRooms.find((r) => r.code === myLatestPart.room_code)
          if (relatedRoom && relatedRoom.status !== 'result' && relatedRoom.status !== 'finished_completely') {
            setRoomCode(myLatestPart.room_code)
            setUserName(myLatestPart.name)
            setIsHost(relatedRoom.host_id === userId)
            if (myLatestPart.is_finished) {
              setCurrentView('WAITING')
            } else {
              const answers = (myLatestPart.answers as number[]) ?? []
              setLocalAnswers(answers)
              setCurrentQIdx(answers.length)
              setCurrentView('LOBBY')
            }
          }
        }
        setIsRestoring(false)
      }
    }
    fetchInitial()
    return () => { mounted = false }
  }, [userId, isRestoring]) 

  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('app-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, (payload) => {
        setRooms((prev) => {
          if (payload.eventType === 'INSERT') {
            if (prev.some(r => r.id === payload.new.id)) return prev;
            return [...prev, payload.new as Room]
          }
          if (payload.eventType === 'UPDATE') return prev.map((r) => r.id === payload.new.id ? payload.new as Room : r)
          if (payload.eventType === 'DELETE') return prev.filter((r) => r.id !== payload.old.id)
          return prev
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, (payload) => {
        setParticipants((prev) => {
          if (payload.eventType === 'INSERT') {
            if (prev.some(p => p.id === payload.new.id)) return prev;
            return [...prev, payload.new as Participant]
          }
          if (payload.eventType === 'UPDATE') return prev.map((p) => p.id === payload.new.id ? payload.new as Participant : p)
          if (payload.eventType === 'DELETE') return prev.filter((p) => p.id !== payload.old.id)
          return prev
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  useEffect(() => {
    if (!roomCode) return;
    let isFetching = false;
    
    const syncRoomData = async () => {
      if (isFetching) return;
      isFetching = true;
      try {
        const { data: roomData } = await supabase.from('rooms').select('*').eq('code', roomCode).single();
        if (roomData) {
          setRooms(prev => {
            const existing = prev.find(r => r.id === roomData.id);
            if (!existing || existing.status !== roomData.status) {
              return prev.map(r => r.id === roomData.id ? roomData as Room : r);
            }
            return prev;
          });
        }
        
        const { data: partsData } = await supabase.from('participants').select('*').eq('room_code', roomCode);
        if (partsData) {
          setParticipants(prev => {
            let updated = false;
            let newParts = [...prev];
            partsData.forEach(newP => {
              const idx = newParts.findIndex(p => p.id === newP.id);
              if (idx === -1) {
                newParts.push(newP as Participant);
                updated = true;
              } else {
                const currentP = newParts[idx];
                if (currentP.is_finished !== newP.is_finished || JSON.stringify(currentP.answers) !== JSON.stringify(newP.answers)) {
                  newParts[idx] = newP as Participant;
                  updated = true;
                }
              }
            });
            return updated ? newParts : prev;
          });
        }
      } catch (err) {
        console.error("Sync error:", err);
      } finally {
        isFetching = false;
      }
    };

    const intervalId = setInterval(syncRoomData, 3000); 
    return () => clearInterval(intervalId);
  }, [roomCode]);

  const currentRoom = useMemo(() => rooms.find((r) => r.code === roomCode), [rooms, roomCode])
  const roomParticipants = useMemo(() => participants.filter((p) => p.room_code === roomCode), [participants, roomCode])
  const me = useMemo(() => roomParticipants.find((p) => p.user_id === userId), [roomParticipants, userId])
  const allFinished = useMemo(() => roomParticipants.length > 0 && roomParticipants.every((p) => p.is_finished), [roomParticipants])

  useEffect(() => {
    if (!currentRoom) return
    if (currentRoom.status === 'playing' && currentView === 'LOBBY') setCurrentView('PLAYING')
    else if (currentRoom.status === 'calculating' && (currentView === 'WAITING' || currentView === 'PLAYING')) {
      setCurrentView('CALCULATING')
      setTimeout(() => setCurrentView('RESULT'), 1500)
    } else if (currentRoom.status === 'result' && currentView !== 'RESULT') setCurrentView('RESULT')
  }, [currentRoom?.status, currentView])

  useEffect(() => {
    if (currentView !== 'WAITING') return
    const interval = setInterval(() => setColumnIdx((prev) => (prev + 1) % COLUMNS.length), 5000)
    return () => clearInterval(interval)
  }, [currentView])

  const handleNextToRoomSelect = useCallback(() => {
    if (!userName.trim()) { setErrorMsg('ニックネームを入力してください。'); return }
    setErrorMsg('')
    setCurrentView('ROOM_SELECT')
  }, [userName])

  const handleCreateRoom = useCallback(async () => {
    const code = Math.floor(1000 + Math.random() * 9000).toString()
    try {
      const { data: roomData, error: roomError } = await supabase.from('rooms').insert({ code, status: 'waiting', host_id: userId! }).select().single()
      if (roomError) throw roomError
      
      const { data: partData, error: partError } = await supabase.from('participants').insert({ user_id: userId!, room_code: code, name: userName, answers: [], is_finished: false }).select().single()
      if (partError) throw partError

      setRooms(prev => {
        if (prev.some(r => r.id === roomData.id)) return prev;
        return [...prev, roomData as Room];
      })
      setParticipants(prev => {
        if (prev.some(p => p.id === partData.id)) return prev;
        return [...prev, partData as Participant];
      })

      setRoomCode(code); setIsHost(true); setCurrentView('LOBBY'); setErrorMsg('')
    } catch (err) { 
      console.error(err)
      setErrorMsg('通信エラーが発生しました。') 
    }
  }, [userName, userId])

  const handleJoinRoom = useCallback(async () => {
    if (!joinCodeInput.trim()) { setErrorMsg('パスコードを入力してください。'); return }
    const room = rooms.find((r) => r.code === joinCodeInput)
    if (!room) { setErrorMsg('パスコードが間違っています。'); return }
    if (room.status !== 'waiting') { setErrorMsg('すでに診断が始まっています。'); return }
    try {
      const existing = participants.find((p) => p.room_code === joinCodeInput && p.user_id === userId)
      if (!existing) {
        const { data: partData, error } = await supabase.from('participants').insert({ user_id: userId!, room_code: joinCodeInput, name: userName, answers: [], is_finished: false }).select().single()
        if (error) throw error
        setParticipants(prev => {
          if (prev.some(p => p.id === partData.id)) return prev;
          return [...prev, partData as Participant];
        })
      }
      setRoomCode(joinCodeInput); setIsHost(false); setCurrentView('LOBBY'); setErrorMsg('')
    } catch { setErrorMsg('通信エラーが発生しました。') }
  }, [userName, joinCodeInput, rooms, participants, userId])

  const copyInviteText = useCallback(() => {
    const baseUrl = window.location.href.split('?')[0].split('#')[0]
    const inviteUrl = `${baseUrl}?room=${roomCode}`
    const text = `価値観マッチングに参加しよう！\nURL: ${inviteUrl}\nパスコード: ${roomCode}`
    const el = document.createElement('textarea')
    el.value = text; el.style.position = 'absolute'; el.style.left = '-999999px'
    document.body.appendChild(el); el.select()
    try { document.execCommand('copy'); setCopySuccess('コピーしました！LINE等で共有してください'); setTimeout(() => setCopySuccess(''), 3000) }
    catch { setCopySuccess('コピーに失敗しました。手動でパスコードを伝えてください。') }
    finally { el.remove() }
  }, [roomCode])

  const addDummyUsers = useCallback(async () => {
    if (!currentRoom) return
    const dummies = ['あきら(Bot)', 'サヤカ(Bot)', 'ケンジ(Bot)', 'マイ(Bot)'].map((name) => {
      const randomStr = typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 9) : Math.random().toString(36).substring(2, 11);
      return {
        user_id: `dummy-${randomStr}`,
        room_code: currentRoom.code, 
        name,
        answers: QUESTIONS.map(() => (Math.random() > 0.5 ? 1 : -1)),
        is_finished: true,
      };
    })
    
    const { data, error } = await supabase.from('participants').insert(dummies).select()
    if (!error && data) {
      setParticipants(prev => {
        const newParts = [...prev];
        data.forEach(d => {
          if (!newParts.some(p => p.id === d.id)) newParts.push(d as Participant);
        });
        return newParts;
      });
    }
  }, [currentRoom])

  const startGame = useCallback(async () => {
    if (!currentRoom) return
    setRooms(prev => prev.map(r => r.id === currentRoom.id ? { ...r, status: 'playing' } : r))
    await supabase.from('rooms').update({ status: 'playing' }).eq('id', currentRoom.id)
  }, [currentRoom])

  const handleAnswer = useCallback(async (value: number) => {
    const newAnswers = [...localAnswers, value]
    setLocalAnswers(newAnswers)
    if (newAnswers.length < QUESTIONS.length) {
      setCurrentQIdx((idx) => idx + 1)
      if (me) {
        setParticipants(prev => prev.map(p => p.id === me.id ? { ...p, answers: newAnswers } : p))
        supabase.from('participants').update({ answers: newAnswers }).eq('id', me.id).then()
      }
    } else {
      setCurrentView('WAITING')
      if (me) {
        setParticipants(prev => prev.map(p => p.id === me.id ? { ...p, answers: newAnswers, is_finished: true } : p))
        await supabase.from('participants').update({ answers: newAnswers, is_finished: true }).eq('id', me.id)
      }
    }
  }, [localAnswers, me])

  const handleBack = useCallback(async () => {
    if (currentQIdx === 0) return
    const newAnswers = localAnswers.slice(0, -1)
    setLocalAnswers(newAnswers)
    setCurrentQIdx((idx) => idx - 1)
    if (me) {
      setParticipants(prev => prev.map(p => p.id === me.id ? { ...p, answers: newAnswers } : p))
      supabase.from('participants').update({ answers: newAnswers }).eq('id', me.id).then()
    }
  }, [currentQIdx, localAnswers, me])

  const triggerCalculation = useCallback(async () => {
    if (!currentRoom) return
    setRooms(prev => prev.map(r => r.id === currentRoom.id ? { ...r, status: 'calculating' } : r))
    await supabase.from('rooms').update({ status: 'calculating' }).eq('id', currentRoom.id)
  }, [currentRoom])

  const completelyResetGame = useCallback(async () => {
    setRoomCode(''); setJoinCodeInput(''); setLocalAnswers([]); setCurrentQIdx(0)
    setIsHost(false); setUserName(''); setCurrentView('NAME_INPUT'); setShowMethodology(false); setShowAlgorithm(false); setIsRestoring(false)
    
    await supabase.auth.signOut()
    const { data } = await supabase.auth.signInAnonymously()
    setUserId(data.user?.id ?? null)
    
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, document.title, window.location.pathname)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [])

  const calculateEnhancedResults = useCallback(() => {
    const res = calculateResults(roomParticipants);
    if (!res || !res.best?.p1) return null;

    const finishedPlayers = roomParticipants.filter(p => p.is_finished && Array.isArray(p.answers) && p.answers.length === QUESTIONS.length);
    let centroid = Array(QUESTIONS.length).fill(0);
    finishedPlayers.forEach(p => {
      (p.answers as number[]).forEach((ans, idx) => centroid[idx] += ans);
    });
    centroid = centroid.map(val => val / finishedPlayers.length);

    const groupRules: string[] = [];
    const groupWeaknesses: string[] = [];

    const ruleDict = [
      { a: "常に新しい刺激を求める「ノリと勢い」重視", aW: "飽きっぽく、継続力に欠ける", b: "安心安全の「いつもの定番」重視", bW: "変化を極端に恐れ、新しい挑戦を嫌う" },
      { a: "計画性ゼロ。その場のフィーリングで動く", aW: "締め切りやルールが基本守られない", b: "ルールと計画は絶対。ガチガチの「軍隊」", bW: "想定外のトラブルが起きるとフリーズする" },
      { a: "沈黙は悪。常に誰かといたい「さみしがりや」", aW: "一人で静かに集中する時間が取れない", b: "全員が「自分の世界」を持つ、個人主義", bW: "連携やコミュニケーションが圧倒的に不足する" },
      { a: "全員が「自分の意見」を曲げない、バチバチ集団", aW: "意見が割れると、一生まとまらない", b: "空気を読みすぎる「波風立てない」集団", bW: "本音を言えないため、不満が水面下で溜まる" },
      { a: "石橋を叩き割るほど慎重な「心配性」", aW: "リスクを恐れるあまり、行動が遅い", b: "「なんとかなる」精神が強すぎる「楽観的」", bW: "見通しが甘く、重大なミスを見落としがち" },
      { a: "不満はその場でぶちまける、感情爆発集団", aW: "ヒートアップしすぎて、大火事になりやすい", b: "喧嘩は一旦寝かせる「冷却・事勿れ」集団", bW: "根本的な問題解決が先送りされがち" },
      { a: "ハイリスク・ハイリターンを狙う「ギャンブラー」", aW: "一発逆転を狙いすぎて、足元をすくわれる", b: "絶対に損したくない「超・堅実派」", bW: "大きなチャンスが来ても、見逃してしまう" },
      { a: "親しき中にも礼儀あり。「心のATフィールド」展開", aW: "お互いの深い悩みや秘密は共有されない", b: "隠し事は一切なし。プライバシー皆無の「オープン」", bW: "距離感が近すぎて、干渉しすぎてしまう" }
    ];

    centroid.forEach((val, idx) => {
      if (val >= 0.4) { 
        groupRules.push(ruleDict[idx].a);
        groupWeaknesses.push(ruleDict[idx].aW);
      } else if (val <= -0.4) {
        groupRules.push(ruleDict[idx].b);
        groupWeaknesses.push(ruleDict[idx].bW);
      }
    });

    return { ...res, groupRules, groupWeaknesses, allPairs: res.allPairs };
  }, [roomParticipants]);

  /** 8次元の回答を「革新⇔保守」×「規律⇔柔軟」の2軸に落とし込む */
  const generate2DMapData = useCallback((parts: Participant[]): MappedPoint[] => {
    const weights = [
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 1 },
      { x: 1, y: -1 },
      { x: 1, y: 0 },
      { x: -1, y: 1 },
    ]

    let maxAbs = 0.1
    const finishedParts = parts.filter(
      (p) => p.is_finished && Array.isArray(p.answers) && p.answers.length === QUESTIONS.length
    )

    const mapped: MappedPoint[] = finishedParts.map((p) => {
      let x = 0
      let y = 0
      ;(p.answers as number[]).forEach((ans, i) => {
        x += ans * weights[i].x
        y += weights[i].y ? ans * weights[i].y : 0
      })
      maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y))

      let title = ''
      if (x > 0 && y > 0) title = '論理的イノベーター'
      else if (x > 0 && y <= 0) title = '情熱的チャレンジャー'
      else if (x <= 0 && y > 0) title = '堅実なる守護者'
      else title = '心優しきバランサー'

      const distance = Math.sqrt(x * x + y * y)
      if (distance > 3) title = `絶対的・${title}`
      else if (distance < 1) title = `マイルドな${title}`

      return { id: p.id, name: p.name, x, y, title, isMe: p.user_id === userId, nx: 0, ny: 0 }
    })

    // 正規化（重なりを避けるため、ごくわずかに散らす）
    mapped.forEach((p) => {
      p.nx = (p.x / maxAbs) * 100 + (Math.random() - 0.5) * 8
      p.ny = (p.y / maxAbs) * 100 + (Math.random() - 0.5) * 8
    })

    // 反発シミュレーション：点同士が一定距離まで離れるまで押し合う
    for (let iter = 0; iter < 30; iter++) {
      for (let i = 0; i < mapped.length; i++) {
        for (let j = i + 1; j < mapped.length; j++) {
          const dx = mapped[i].nx - mapped[j].nx
          const dy = mapped[i].ny - mapped[j].ny
          let dist = Math.sqrt(dx * dx + dy * dy)

          if (dist === 0) {
            mapped[i].nx += 1
            dist = 1
          }

          const minDist = 26
          if (dist < minDist) {
            const force = ((minDist - dist) / dist) * 0.4
            mapped[i].nx += dx * force
            mapped[i].ny += dy * force
            mapped[j].nx -= dx * force
            mapped[j].ny -= dy * force
          }
        }
      }
    }

    mapped.forEach((p) => {
      p.nx = Math.max(-85, Math.min(85, p.nx))
      p.ny = Math.max(-85, Math.min(85, p.ny))
    })

    return mapped
  }, [userId])

  // 設問画面はキーボードでも答えられるようにする（PC で一気に進めたい人向け）
  useEffect(() => {
    if (currentView !== 'PLAYING') return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === '1' || k === 'a' || k === 'arrowleft') { e.preventDefault(); handleAnswer(1) }
      else if (k === '2' || k === 'b' || k === 'arrowright') { e.preventDefault(); handleAnswer(-1) }
      else if (k === 'backspace') { e.preventDefault(); handleBack() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentView, handleAnswer, handleBack])

  if (!userId || isRestoring)
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-6">
        <Spinner size={44} />
        <Eyebrow>Loading</Eyebrow>
      </div>
    )

  /* ================================================================
     モーダル（どの画面からでも同じものが開く）
     ================================================================ */
  const modals = (
    <>
      <Modal
        open={showMethodology}
        onClose={() => setShowMethodology(false)}
        eyebrow="Why we built this"
        title="開発者の想い"
      >
        <div className="mb-7 flex items-center gap-3 rounded-[16px] border border-line bg-paper-sunken px-4 py-3.5">
          <img
            src="/icon-dt.png"
            alt=""
            className="h-10 w-10 rounded-full object-cover grayscale"
          />
          <div>
            <p className="text-[13px] font-semibold text-ink">D.T.</p>
            <p className="text-[11px] text-ink-muted">設問設計・アルゴリズム</p>
          </div>
        </div>
        <div className="u-body space-y-5 text-[14px] text-ink-soft">
          {DEVELOPER_THOUGHTS.map((text, i) => {
            if (text.includes('最高のパートナー')) {
              const parts = text.split('最高のパートナー')
              return (
                <p key={i}>
                  {parts[0]}
                  <strong className="font-semibold text-ink [box-shadow:inset_0_-0.5em_0_rgba(39,64,107,0.10)]">
                    最高のパートナー
                  </strong>
                  {parts[1]}
                </p>
              )
            }
            return <p key={i}>{text}</p>
          })}
        </div>
      </Modal>

      <Modal
        open={showAlgorithm}
        onClose={() => setShowAlgorithm(false)}
        eyebrow="Logic & Science"
        title="アルゴリズムと理論"
      >
        <div className="space-y-px overflow-hidden rounded-[16px] border border-line">
          {COLUMNS.map((col, idx) => (
            <article
              key={idx}
              className="bg-paper-raised px-5 py-5 [&+&]:border-t [&+&]:border-line"
            >
              <div className="mb-2 flex items-center gap-3">
                <span className="u-num font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-faint">
                  {(idx + 1).toString().padStart(2, '0')}
                </span>
                <span className="h-px w-4 bg-line-strong" />
                <h4 className="text-[14px] font-bold tracking-[0.01em] text-ink">
                  {col.title}
                </h4>
              </div>
              <p className="u-body text-[13px] text-ink-muted">{col.text}</p>
            </article>
          ))}
        </div>
      </Modal>
    </>
  )

  /* ================================================================
     1. 名前を入れる（トップ画面）
     ================================================================ */
  if (currentView === 'NAME_INPUT')
    return (
      <>
        <Screen width="sm" className="flex flex-col">
          <div className="flex flex-1 flex-col justify-center py-14">
            <header className="mb-9 text-center u-stagger">
              <div className="flex justify-center">
                <Mark size={38} />
              </div>
              <Eyebrow className="mt-6">Value Matching</Eyebrow>
              <h1 className="u-display mt-4 text-[clamp(2.15rem,9.5vw,2.75rem)] text-ink">
                価値観
                <br />
                マッチング
              </h1>
              <p className="u-body mt-5 text-[14px] text-ink-soft">
                8つの問いに、直感で答えるだけ。
              </p>
            </header>

            <div className="animate-rise [animation-delay:0.2s]">
              <Card>
                {errorMsg && <Notice>{errorMsg}</Notice>}
                <TextField
                  label="ニックネーム"
                  hint="10文字まで"
                  value={userName}
                  onChange={setUserName}
                  onEnter={handleNextToRoomSelect}
                  placeholder="例：アキラ"
                  maxLength={10}
                />
                <div className="mt-5">
                  <Button size="lg" full onClick={handleNextToRoomSelect}>
                    はじめる
                  </Button>
                </div>
                <p className="mt-4 text-center text-[11px] text-ink-faint">
                  登録不要・匿名で参加できます
                </p>
              </Card>
            </div>

            {/* 色の意味をここで教える。以降の画面はこの2色だけで説明される */}
            <section className="mt-8 animate-rise [animation-delay:0.3s]">
              <Card padded={false}>
                <div className="px-6 pb-5 pt-5 sm:px-7">
                  <Eyebrow className="mb-4">2つの発見</Eyebrow>
                  <div className="flex items-start gap-3.5">
                    <span className="mt-[5px] h-3 w-3 flex-none rounded-full bg-ai" />
                    <div>
                      <p className="text-[15px] font-bold tracking-[0.01em] text-ink">
                        最高の理解者
                      </p>
                      <p className="u-body mt-1 text-[12.5px] text-ink-muted">
                        価値観が重なり、一緒にいて自然体でいられる人。
                      </p>
                      <p className="mt-1 text-[11px] text-ink-faint">類似性の法則</p>
                    </div>
                  </div>
                </div>
                <div className="mx-6 h-px bg-line sm:mx-7" />
                <div className="px-6 pb-6 pt-5 sm:px-7">
                  <div className="flex items-start gap-3.5">
                    <span className="mt-[5px] h-3 w-3 flex-none rounded-full bg-shu" />
                    <div>
                      <p className="text-[15px] font-bold tracking-[0.01em] text-ink">
                        最強の相棒
                      </p>
                      <p className="u-body mt-1 text-[12.5px] text-ink-muted">
                        自分にない視点をくれ、弱点を補い合える人。
                      </p>
                      <p className="mt-1 text-[11px] text-ink-faint">相補性の法則</p>
                    </div>
                  </div>
                </div>
              </Card>
            </section>

            {/* 所要時間と手順を先に示して、心理的な負担を下げる */}
            <section className="mt-8 animate-rise [animation-delay:0.38s]">
              <Eyebrow className="mb-3.5 text-center">3 Steps · 約2分</Eyebrow>
              <ol className="grid grid-cols-3 gap-2 text-center">
                {[
                  ['01', '集まる', 'パスコードで合流'],
                  ['02', '答える', '8つの二択に直感で'],
                  ['03', '見る', '相性とマップが出る'],
                ].map(([n, t, d]) => (
                  <li
                    key={n}
                    className="rounded-[14px] border border-line/80 bg-paper-raised/60 px-2 py-4"
                  >
                    <span className="u-num font-mono text-[10px] font-semibold tracking-[0.14em] text-ink-faint">
                      {n}
                    </span>
                    <p className="mt-1.5 text-[13px] font-bold text-ink">{t}</p>
                    <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">{d}</p>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <Credit
            onMethodology={() => setShowMethodology(true)}
            onAlgorithm={() => setShowAlgorithm(true)}
          />
        </Screen>
        {modals}
      </>
    )

  /* ================================================================
     2. ルームを作る / 参加する
     ================================================================ */
  if (currentView === 'ROOM_SELECT')
    return (
      <>
        <Screen width="sm" className="flex flex-col">
          <div className="flex flex-1 flex-col justify-center py-10">
            <div className="mb-6">
              <button
                onClick={() => setCurrentView('NAME_INPUT')}
                className="u-press -ml-2 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold text-ink-muted hover:bg-[rgba(20,18,16,0.05)] hover:text-ink"
              >
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M7.5 1.5L3 6l4.5 4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                もどる
              </button>
            </div>

            <header className="mb-7 animate-rise">
              <Eyebrow className="mb-3">Room</Eyebrow>
              <h1 className="u-display text-[30px] text-ink">
                {userName ? `${userName}さん、` : ''}
                <br className="sm:hidden" />
                どちらで参加しますか
              </h1>
            </header>

            <div className="animate-rise [animation-delay:0.1s]">
              <Card>
                {errorMsg && <Notice>{errorMsg}</Notice>}

                <div>
                  <div className="mb-3 flex items-baseline justify-between">
                    <span className="text-[13px] font-bold tracking-[0.02em] text-ink">
                      新しく始める
                    </span>
                    <span className="text-[11px] text-ink-faint">幹事の方</span>
                  </div>
                  <Button size="lg" full onClick={handleCreateRoom}>
                    ルームをつくる
                  </Button>
                  <p className="mt-2.5 text-center text-[11px] text-ink-faint">
                    4桁のパスコードが発行されます
                  </p>
                </div>

                <Divider label="or" />

                <div>
                  <div className="mb-3 flex items-baseline justify-between">
                    <span className="text-[13px] font-bold tracking-[0.02em] text-ink">
                      招待されたルームに入る
                    </span>
                    <span className="text-[11px] text-ink-faint">参加者の方</span>
                  </div>
                  <PasscodeInput
                    value={joinCodeInput}
                    onChange={setJoinCodeInput}
                    onComplete={handleJoinRoom}
                  />
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      size="lg"
                      full
                      onClick={handleJoinRoom}
                      disabled={joinCodeInput.length < 4}
                    >
                      参加する
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <Credit
            onMethodology={() => setShowMethodology(true)}
            onAlgorithm={() => setShowAlgorithm(true)}
          />
        </Screen>
        {modals}
      </>
    )

  /* ================================================================
     3. ロビー（人を待つ）
     ================================================================ */
  if (currentView === 'LOBBY')
    return (
      <>
        <div className="min-h-[100dvh]">
          <AppBar
            title="ルーム"
            right={
              <span className="u-num rounded-full border border-line bg-paper-raised px-3 py-1 text-[12px] font-semibold text-ink-muted">
                {roomParticipants.length}人
              </span>
            }
          />
          <Screen width="sm" minH={false} className="flex flex-col">
            <div className="py-10 u-stagger">
              <div className="text-center">
                <Eyebrow className="mb-4">Passcode</Eyebrow>
                <PinTiles code={roomCode} />
                <p className="mt-4 text-[12px] text-ink-muted">
                  この番号を伝えるだけで、誰でも参加できます
                </p>
              </div>

              <div className="mt-6 text-center">
                <Button variant="outline" size="md" onClick={copyInviteText}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <rect x="5.25" y="5.25" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" />
                    <path
                      d="M10.75 3.4V3.25a2 2 0 00-2-2h-4a2 2 0 00-2 2v4a2 2 0 002 2h.15"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                  招待リンクをコピー
                </Button>
                <p
                  className={cx(
                    'mt-3 text-[11.5px] font-medium transition-opacity duration-300',
                    copySuccess ? 'text-matcha opacity-100' : 'opacity-0'
                  )}
                >
                  {copySuccess || '　'}
                </p>
              </div>

              <Card padded={false} className="mt-4">
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                  <Eyebrow>Members</Eyebrow>
                  <span className="u-num text-[12px] font-semibold text-ink-muted">
                    {roomParticipants.length}
                  </span>
                </div>
                <ul>
                  {roomParticipants.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 px-6 py-3.5 [&+&]:border-t [&+&]:border-line/70"
                    >
                      <Avatar name={p.name} isMe={p.user_id === userId} size={30} />
                      <NameTag
                        name={p.name}
                        className="min-w-0 flex-1 text-[14px] font-semibold text-ink"
                      />
                      {p.user_id === userId && (
                        <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-ink-muted">
                          YOU
                        </span>
                      )}
                    </li>
                  ))}
                  {roomParticipants.length === 0 && (
                    <li className="px-6 py-8 text-center text-[12px] text-ink-faint">
                      まだ誰もいません
                    </li>
                  )}
                </ul>
                <div className="border-t border-line px-6 py-3">
                  <button
                    onClick={addDummyUsers}
                    className="u-press w-full rounded-[10px] py-2 text-[11.5px] font-semibold text-ink-faint hover:bg-paper-sunken hover:text-ink-muted"
                  >
                    ＋ テスト用メンバーを追加
                  </button>
                </div>
              </Card>

              <div className="mt-7">
                <Button
                  size="lg"
                  full
                  onClick={startGame}
                  disabled={roomParticipants.length < 2}
                >
                  {roomParticipants.length < 2 ? 'あと1人以上を待っています' : '全員そろった、はじめる'}
                </Button>
                <p className="mt-3 text-center text-[11px] text-ink-faint">
                  参加者なら誰でも開始できます
                </p>
              </div>
            </div>

            <ExitLink onClick={completelyResetGame} />
          </Screen>
        </div>
        {modals}
      </>
    )

  /* ================================================================
     4. 設問に答える
     ================================================================ */
  if (currentView === 'PLAYING') {
    const q = QUESTIONS[currentQIdx]
    return (
      <div className="flex min-h-[100dvh] flex-col">
        {/* 進捗は8本の目盛りで示す。あと何問かが一目でわかる */}
        <div className="u-blur-bar sticky top-0 z-30 border-b border-line/80">
          <div className="mx-auto flex h-14 max-w-2xl items-center gap-4 px-5 sm:px-6">
            <button
              onClick={handleBack}
              disabled={currentQIdx === 0}
              aria-label="前の問いへ"
              className="u-press -ml-2 flex h-9 w-9 flex-none items-center justify-center rounded-full text-ink-muted hover:bg-[rgba(20,18,16,0.05)] hover:text-ink disabled:pointer-events-none disabled:opacity-25"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M10 3l-5 5 5 5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <div className="flex flex-1 items-center gap-1">
              {QUESTIONS.map((_, i) => (
                <span
                  key={i}
                  className={cx(
                    'h-[3px] flex-1 rounded-full transition-colors duration-500 ease-apple',
                    i < currentQIdx ? 'bg-ink' : i === currentQIdx ? 'bg-ai' : 'bg-line-strong/60'
                  )}
                />
              ))}
            </div>

            <span className="u-num flex-none font-mono text-[12px] font-semibold tracking-[0.06em] text-ink-muted">
              {String(currentQIdx + 1).padStart(2, '0')}
              <span className="text-ink-faint">/{QUESTIONS.length}</span>
            </span>
          </div>
        </div>

        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-10 sm:px-6">
          <div key={currentQIdx} className="animate-rise">
            <div className="mb-8 text-center">
              <span className="inline-block rounded-full border border-line bg-paper-raised px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.04em] text-ink-muted">
                {q.dim}
              </span>
              <h1 className="u-display mx-auto mt-6 max-w-xl text-[clamp(1.5rem,5.2vw,2.05rem)] leading-[1.5] text-ink">
                {q.text}
              </h1>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[
                { key: 'A', text: q.a, value: 1, tone: 'ai' as const },
                { key: 'B', text: q.b, value: -1, tone: 'shu' as const },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => handleAnswer(opt.value)}
                  className={cx(
                    'u-press group relative flex min-h-[132px] flex-col items-start gap-3 rounded-[18px] border bg-paper-raised p-5 text-left sm:p-6',
                    'border-line shadow-[0_1px_2px_rgba(20,18,16,0.04)]',
                    opt.tone === 'ai'
                      ? 'hover:border-ai/50 hover:shadow-[0_2px_4px_rgba(27,46,78,0.06),0_18px_36px_-24px_rgba(27,46,78,0.55)]'
                      : 'hover:border-shu/50 hover:shadow-[0_2px_4px_rgba(130,62,39,0.06),0_18px_36px_-24px_rgba(130,62,39,0.55)]'
                  )}
                >
                  <span
                    className={cx(
                      'flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold transition-colors duration-300',
                      opt.tone === 'ai'
                        ? 'bg-ai-soft text-ai group-hover:bg-ai group-hover:text-white'
                        : 'bg-shu-soft text-shu group-hover:bg-shu group-hover:text-white'
                    )}
                  >
                    {opt.key}
                  </span>
                  <span className="u-body text-[15px] font-semibold text-ink sm:text-[16px]">
                    {opt.text}
                  </span>
                </button>
              ))}
            </div>

            <p className="mt-6 hidden text-center text-[11px] text-ink-faint md:block">
              キーボードの <kbd className="font-mono">A</kbd> /{' '}
              <kbd className="font-mono">B</kbd> でも回答できます
            </p>
          </div>
        </main>

        <ExitLink onClick={completelyResetGame} />
      </div>
    )
  }

  /* ================================================================
     5. 全員を待つ
     ================================================================ */
  if (currentView === 'WAITING') {
    const col = COLUMNS[columnIdx]
    const done = roomParticipants.filter((p) => p.is_finished).length
    return (
      <>
        <div className="min-h-[100dvh]">
          <AppBar title="回答完了" />
          <Screen width="sm" minH={false} className="flex flex-col">
            <div className="py-12 u-stagger">
              <div className="text-center">
                <div className="flex justify-center">
                  <ProgressRing value={done} total={roomParticipants.length} size={84} />
                </div>
                <h1 className="u-display mt-6 text-[26px] text-ink">回答ありがとう</h1>
                <p className="u-body mt-2.5 text-[13px] text-ink-muted">
                  {allFinished
                    ? '全員そろいました。解析をはじめられます。'
                    : 'ほかの人が答え終わるのを待っています。'}
                </p>
              </div>

              <Card padded={false} className="mt-8">
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                  <Eyebrow>Status</Eyebrow>
                  <span className="u-num text-[12px] font-semibold text-ink-muted">
                    {done} / {roomParticipants.length}
                  </span>
                </div>
                <ul>
                  {roomParticipants.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 px-6 py-3.5 [&+&]:border-t [&+&]:border-line/70"
                    >
                      <Avatar
                        name={p.name}
                        isMe={p.user_id === userId}
                        size={30}
                        className={p.is_finished ? '' : 'opacity-45'}
                      />
                      <NameTag
                        name={p.name}
                        className={cx(
                          'min-w-0 flex-1 text-[14px] font-semibold',
                          p.is_finished ? 'text-ink' : 'text-ink-faint'
                        )}
                      />
                      {p.is_finished ? (
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-matcha">
                          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" aria-hidden>
                            <path
                              d="M3 7.4l2.6 2.6L11 4.6"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          完了
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                          <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-ink-faint" />
                          回答中
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>

              {/* 待ち時間は「読みもの」に変える */}
              <section className="mt-5 rounded-[20px] border border-line bg-paper-sunken p-6">
                <div className="mb-3 flex items-center justify-between">
                  <Eyebrow>Column</Eyebrow>
                  <span className="flex gap-1.5">
                    {COLUMNS.map((_, i) => (
                      <span
                        key={i}
                        className={cx(
                          'h-1 rounded-full transition-all duration-500 ease-apple',
                          i === columnIdx ? 'w-4 bg-ink-muted' : 'w-1 bg-line-strong'
                        )}
                      />
                    ))}
                  </span>
                </div>
                <div key={columnIdx} className="animate-fade min-h-[132px]">
                  <h3 className="u-title text-[16px] text-ink">{col.title}</h3>
                  <p className="u-body mt-2 text-[12.5px] text-ink-muted">{col.text}</p>
                </div>
              </section>

              {allFinished && (
                <div className="mt-8 animate-rise">
                  <Button size="lg" full onClick={triggerCalculation}>
                    結果を解析する
                  </Button>
                </div>
              )}
            </div>

            <ExitLink onClick={completelyResetGame} />
          </Screen>
        </div>
        {modals}
      </>
    )
  }

  /* ================================================================
     6. 解析中
     ================================================================ */
  if (currentView === 'CALCULATING')
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
        <Spinner size={52} />
        <h1 className="u-display mt-8 text-[22px] text-ink">解析しています</h1>
        <p className="mt-2.5 text-[12px] text-ink-muted">
          8次元のベクトル空間で、全員の距離を測っています
        </p>
        <div className="mt-8 h-[2px] w-40 overflow-hidden rounded-full bg-line">
          <div className="h-full w-1/2 animate-sweep rounded-full bg-ink" />
        </div>
      </div>
    )

  /* ================================================================
     7. 結果
     ================================================================ */
  if (currentView === 'RESULT') {
    const results = calculateEnhancedResults()

    if (!results)
      return (
        <div className="flex min-h-[100dvh] items-center justify-center px-6">
          <Card className="w-full max-w-sm text-center">
            <p className="u-body text-[13px] text-ink-muted">
              計算に必要なデータが足りませんでした。
            </p>
            <div className="mt-6">
              <Button variant="outline" full onClick={completelyResetGame}>
                トップに戻る
              </Button>
            </div>
          </Card>
        </div>
      )

    const mapData = generate2DMapData(roomParticipants)
    const points: MapPoint[] = mapData.map((p) => ({
      id: p.id,
      name: p.name,
      nx: p.nx,
      ny: p.ny,
      title: p.title,
      isMe: p.isMe,
    }))
    const links: MapLink[] = results.allPairs
      .filter((p) => p.percent >= 60)
      .map((p) => ({ a: p.p1.id, b: p.p2.id, percent: p.percent }))

    const myAnswers = (me?.answers as number[]) ?? []

    return (
      <>
        <div className="min-h-[100dvh]">
          <AppBar
            title="診断結果"
            right={
              <button
                onClick={completelyResetGame}
                className="u-press rounded-full border border-line bg-paper-raised px-3.5 py-1.5 text-[12px] font-semibold text-ink-muted hover:border-line-strong hover:text-ink"
              >
                最初から
              </button>
            }
          />

          <Screen width="lg" minH={false}>
            {/* --- 表紙 --- */}
            <header className="py-16 text-center u-stagger">
              <Eyebrow>Analysis Report</Eyebrow>
              <h1 className="u-display mt-4 text-[clamp(2.25rem,9vw,3rem)] text-ink">
                診断結果
              </h1>
              <p className="mt-4 text-[12.5px] text-ink-muted">
                {roomParticipants.filter((p) => p.is_finished).length}名 ・ 全
                {QUESTIONS.length}問 ・ ルーム {roomCode}
              </p>
            </header>

            <div className="space-y-16 pb-4">
              {/* --- 01 最高の理解者 --- */}
              <section>
                <SectionHead
                  index="01"
                  eyebrow="類似性の法則"
                  title="最高の理解者"
                  lead="考え方のベクトルが最も近い2人です。言葉にしなくても伝わる、一緒にいて自然体でいられる関係。"
                  align="center"
                />
                <Card className="text-center">
                  <div className="flex items-center justify-center gap-4 sm:gap-6">
                    <div className="flex flex-col items-center gap-2.5">
                      <Avatar name={results.best.p1.name} size={52} />
                      <span className="u-title text-[17px] text-ink sm:text-[19px]">
                        {clean(results.best.p1.name)}
                      </span>
                    </div>
                    <span className="pb-7 text-[18px] font-light text-line-strong">×</span>
                    <div className="flex flex-col items-center gap-2.5">
                      <Avatar name={results.best.p2.name} size={52} />
                      <span className="u-title text-[17px] text-ink sm:text-[19px]">
                        {clean(results.best.p2.name)}
                      </span>
                    </div>
                  </div>

                  <div className="my-7 flex justify-center">
                    <ScoreDial percent={results.best.percent} caption="Match" tone="ai" />
                  </div>

                  {results.best.reasons.length > 0 && (
                    <>
                      <div className="u-rule mb-5" />
                      <Eyebrow className="mb-3">意見が一致した価値観</Eyebrow>
                      <DimChips dims={results.best.reasons} tone="ai" />
                    </>
                  )}
                </Card>
              </section>

              {/* --- 02 / 03 --- */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <section className="flex flex-col">
                  <SectionHead
                    index="02"
                    eyebrow="相補性の法則"
                    title="最強の相棒"
                    lead="価値観が最も遠い2人。だからこそ、互いの弱点を補い合える組み合わせです。"
                  />
                  <Card className="flex-1">
                    <div className="flex items-center gap-3">
                      <Avatar name={results.worst.p1.name} size={38} />
                      <Avatar name={results.worst.p2.name} size={38} className="-ml-4" />
                      <span className="u-title ml-1 min-w-0 flex-1 truncate text-[16px] text-ink">
                        {clean(results.worst.p1.name)} × {clean(results.worst.p2.name)}
                      </span>
                    </div>
                    <div className="mt-5 flex items-baseline gap-2 rounded-[14px] bg-shu-soft px-4 py-3">
                      <Eyebrow className="!text-shu/70">一致度</Eyebrow>
                      <span className="u-num ml-auto text-[26px] font-semibold tracking-[-0.03em] text-shu">
                        {results.worst.percent}
                        <span className="text-[13px]">%</span>
                      </span>
                    </div>
                    {results.worst.reasons.length > 0 && (
                      <div className="mt-5">
                        <Eyebrow className="mb-2.5">意見が割れた価値観</Eyebrow>
                        <div className="flex justify-start">
                          <DimChips dims={results.worst.reasons} tone="shu" />
                        </div>
                      </div>
                    )}
                  </Card>
                </section>

                <section className="flex flex-col">
                  <SectionHead
                    index="03"
                    eyebrow="Uniqueness"
                    title="唯一無二の視点"
                    lead="グループの平均から最も離れた感性の持ち主。集団のマンネリを防ぐ、貴重な存在です。"
                  />
                  <Card className="flex flex-1 flex-col justify-center">
                    <div className="flex items-center gap-3">
                      <Avatar name={results.minority.name} size={44} />
                      <span className="u-title text-[18px] text-ink">
                        {clean(results.minority.name)}
                      </span>
                    </div>
                    <div className="mt-6">
                      <div className="mb-2 flex items-baseline justify-between">
                        <Eyebrow>独自性スコア</Eyebrow>
                        <span className="u-num text-[26px] font-semibold tracking-[-0.03em] text-ink">
                          {results.minority.uniquenessScore}
                          <span className="text-[13px] text-ink-faint">%</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-paper-deep">
                        <div
                          className="h-full rounded-full bg-ink transition-[width] duration-[1200ms] ease-quint"
                          style={{ width: `${results.minority.uniquenessScore}%` }}
                        />
                      </div>
                    </div>
                  </Card>
                </section>
              </div>

              {/* --- 04 全員のベストパートナー --- */}
              <section>
                <SectionHead
                  index="04"
                  eyebrow="Everyone"
                  title="全員のベストパートナー"
                  lead="一人ひとりにとって、最も価値観が近かった相手です。"
                />
                <Card padded={false}>
                  <ul>
                    {results.personalBests.map((pb, i) => {
                      const title = mapData.find((m) => m.id === pb.me.id)?.title ?? ''
                      return (
                        <li
                          key={i}
                          className="flex items-center gap-3 px-5 py-4 sm:px-6 [&+&]:border-t [&+&]:border-line/70"
                        >
                          <Avatar
                            name={pb.me.name}
                            isMe={pb.me.user_id === userId}
                            size={36}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-bold text-ink">
                              {clean(pb.me.name)}
                            </p>
                            {title && (
                              <p className="mt-0.5 truncate text-[10.5px] font-semibold tracking-[0.06em] text-ink-faint">
                                {title}
                              </p>
                            )}
                          </div>
                          <svg
                            className="h-3 w-3 flex-none text-line-strong"
                            viewBox="0 0 12 12"
                            fill="none"
                            aria-hidden
                          >
                            <path
                              d="M2 6h8M7 3l3 3-3 3"
                              stroke="currentColor"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <div className="min-w-0 max-w-[34%] text-right">
                            <p className="truncate text-[14px] font-bold text-ink">
                              {clean(pb.partner.name)}
                            </p>
                          </div>
                          <span className="u-num w-[52px] flex-none rounded-[8px] bg-ai-soft py-1 text-center text-[12px] font-bold text-ai">
                            {pb.percent}%
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </Card>
              </section>

              {/* --- 05 価値観マップ --- */}
              <section>
                <SectionHead
                  index="05"
                  eyebrow="2D Map"
                  title="価値観マップ"
                  lead="8次元の回答を2軸に圧縮した散布図です。線は、シンクロ率60%以上でつながっている関係を表します。"
                  align="center"
                />
                <Card>
                  <ValueMap points={points} links={links} />
                </Card>
              </section>

              {/* --- 06 隠れた掟 --- */}
              <section>
                <SectionHead
                  index="06"
                  eyebrow="Group Norms"
                  title="このグループの「隠れた掟」"
                  lead="全員の回答の偏りから、無意識に共有している暗黙のルールと、その裏返しの弱点を取り出します。"
                  align="center"
                />
                <Card>
                  {results.groupRules.length > 0 ? (
                    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                      <div>
                        <div className="mb-4 flex items-center gap-2.5">
                          <span className="h-2 w-2 rounded-full bg-ai" />
                          <h4 className="text-[13px] font-bold tracking-[0.02em] text-ink">
                            支配的なルール
                          </h4>
                        </div>
                        <ul className="space-y-3">
                          {results.groupRules.map((rule, i) => (
                            <li
                              key={i}
                              className="u-body flex gap-2.5 text-[13px] font-medium text-ink-soft"
                            >
                              <span className="mt-[9px] h-px w-3 flex-none bg-ai-line" />
                              <span>{rule}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="border-t border-line pt-8 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0">
                        <div className="mb-4 flex items-center gap-2.5">
                          <span className="h-2 w-2 rounded-full bg-shu" />
                          <h4 className="text-[13px] font-bold tracking-[0.02em] text-ink">
                            裏に潜む弱点
                          </h4>
                        </div>
                        <ul className="space-y-3">
                          {results.groupWeaknesses.map((weak, i) => (
                            <li
                              key={i}
                              className="u-body flex gap-2.5 text-[13px] font-medium text-ink-muted"
                            >
                              <span className="mt-[9px] h-px w-3 flex-none bg-shu-line" />
                              <span>{weak}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <div className="py-6 text-center">
                      <h4 className="u-title text-[19px] text-ink">究極のバランス型集団</h4>
                      <p className="u-body mx-auto mt-3 max-w-sm text-[13px] text-ink-muted">
                        突出して偏ったルールがなく、多様な価値観が共存しています。
                        意見が割れても、どこかに着地できるグループです。
                      </p>
                    </div>
                  )}
                </Card>
              </section>

              {/* --- 07 回答分布 --- */}
              <section>
                <SectionHead
                  index="07"
                  eyebrow="Distribution"
                  title="みんなの回答"
                  lead="どちらの選択肢に、どれだけ票が集まったか。あなたの回答には印がついています。"
                  align="center"
                />
                <Card padded={false}>
                  {QUESTIONS.map((q, idx) => {
                    const stats = results.questionStats[idx]
                    const mine = myAnswers[idx]
                    return (
                      <article
                        key={idx}
                        className="px-5 py-7 sm:px-8 [&+&]:border-t [&+&]:border-line/70"
                      >
                        <div className="mb-4 flex items-baseline gap-3">
                          <span className="u-num font-mono text-[11px] font-semibold text-ink-faint">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <h4 className="u-body text-[14px] font-bold text-ink">{q.text}</h4>
                        </div>

                        {/* 1本のバーで A と B の比を見せる */}
                        <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-paper-deep">
                          <div
                            className="h-full bg-ai transition-[width] duration-[1200ms] ease-quint"
                            style={{ width: `${stats.aPercent}%` }}
                          />
                          <div
                            className="h-full bg-shu transition-[width] duration-[1200ms] ease-quint"
                            style={{ width: `${stats.bPercent}%` }}
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {[
                            { key: 'A', text: q.a, pct: stats.aPercent, tone: 'ai' as const, on: mine === 1 },
                            { key: 'B', text: q.b, pct: stats.bPercent, tone: 'shu' as const, on: mine === -1 },
                          ].map((o) => (
                            <div
                              key={o.key}
                              className={cx(
                                'flex items-start gap-2.5 rounded-[12px] p-2.5 transition-colors',
                                o.on
                                  ? o.tone === 'ai'
                                    ? 'bg-ai-soft'
                                    : 'bg-shu-soft'
                                  : 'bg-transparent'
                              )}
                            >
                              <span
                                className={cx(
                                  'mt-[1px] flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-bold',
                                  o.tone === 'ai' ? 'bg-ai text-white' : 'bg-shu text-white'
                                )}
                              >
                                {o.key}
                              </span>
                              <p className="u-body min-w-0 flex-1 text-[12px] text-ink-soft">
                                {o.text}
                                {o.on && (
                                  <span
                                    className={cx(
                                      'ml-1.5 whitespace-nowrap rounded-full px-1.5 py-[1px] text-[9px] font-bold tracking-[0.06em]',
                                      o.tone === 'ai' ? 'bg-ai text-white' : 'bg-shu text-white'
                                    )}
                                  >
                                    あなた
                                  </span>
                                )}
                              </p>
                              <span
                                className={cx(
                                  'u-num flex-none text-[13px] font-bold',
                                  o.tone === 'ai' ? 'text-ai' : 'text-shu'
                                )}
                              >
                                {o.pct}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </article>
                    )
                  })}
                </Card>
              </section>
            </div>

            <div className="mx-auto mt-16 max-w-sm">
              <Button size="lg" full onClick={completelyResetGame}>
                最初からもう一度あそぶ
              </Button>
            </div>

            <Credit
              onMethodology={() => setShowMethodology(true)}
              onAlgorithm={() => setShowAlgorithm(true)}
            />
          </Screen>
        </div>
        {modals}
      </>
    )
  }

  return null
}
