'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { QUESTIONS, COLUMNS } from '@/lib/questions'
import { calculateResults } from '@/lib/matching'
import type { Room, Participant } from '@/types/database'

type View = 'JOIN' | 'LOBBY' | 'PLAYING' | 'WAITING' | 'CALCULATING' | 'RESULT'

export default function Home() {
  const [userId, setUserId] = useState<string | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])

  const [currentView, setCurrentView] = useState<View>('JOIN')
  const [roomCode, setRoomCode] = useState('')
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [userName, setUserName] = useState('')
  const [isHost, setIsHost] = useState(false)

  const [currentQIdx, setCurrentQIdx] = useState(0)
  const [localAnswers, setLocalAnswers] = useState<number[]>([])

  const [errorMsg, setErrorMsg] = useState('')
  const [showMethodology, setShowMethodology] = useState(false)
  const [copySuccess, setCopySuccess] = useState('')
  const [isRestoring, setIsRestoring] = useState(true)
  const [columnIdx, setColumnIdx] = useState(0)

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
    const fetchInitial = async () => {
      const [roomsRes, partsRes] = await Promise.all([
        supabase.from('rooms').select('*'),
        supabase.from('participants').select('*'),
      ])
      const fetchedRooms: Room[] = roomsRes.data ?? []
      const fetchedParts: Participant[] = partsRes.data ?? []
      setRooms(fetchedRooms)
      setParticipants(fetchedParts)

      if (isRestoring) {
        const myParts = fetchedParts
          .filter((p) => p.user_id === userId)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        const myLatestPart = myParts[0]
        if (myLatestPart) {
          const relatedRoom = fetchedRooms.find((r) => r.code === myLatestPart.room_code)
          if (relatedRoom && relatedRoom.status !== 'finished_completely') {
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

    const channel = supabase
      .channel('app-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, (payload) => {
        setRooms((prev) => {
          if (payload.eventType === 'INSERT') return [...prev, payload.new as Room]
          if (payload.eventType === 'UPDATE') return prev.map((r) => r.id === (payload.new as Room).id ? payload.new as Room : r)
          if (payload.eventType === 'DELETE') return prev.filter((r) => r.id !== (payload.old as Room).id)
          return prev
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, (payload) => {
        setParticipants((prev) => {
          if (payload.eventType === 'INSERT') return [...prev, payload.new as Participant]
          if (payload.eventType === 'UPDATE') return prev.map((p) => p.id === (payload.new as Participant).id ? payload.new as Participant : p)
          if (payload.eventType === 'DELETE') return prev.filter((p) => p.id !== (payload.old as Participant).id)
          return prev
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

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

  const handleCreateRoom = useCallback(async () => {
    if (!userName.trim()) { setErrorMsg('まずニックネームを入力してください。'); return }
    const code = Math.floor(1000 + Math.random() * 9000).toString()
    try {
      const { error: roomError } = await supabase.from('rooms').insert({ code, status: 'waiting', host_id: userId! })
      if (roomError) throw roomError
      const { error: partError } = await supabase.from('participants').insert({ user_id: userId!, room_code: code, name: userName, answers: [], is_finished: false })
      if (partError) throw partError
      setRoomCode(code); setIsHost(true); setCurrentView('LOBBY'); setErrorMsg('')
    } catch { setErrorMsg('通信エラーが発生しました。') }
  }, [userName, userId])

  const handleJoinRoom = useCallback(async () => {
    if (!userName.trim()) { setErrorMsg('まずニックネームを入力してください。'); return }
    if (!joinCodeInput.trim()) { setErrorMsg('パスコードを入力してください。'); return }
    const room = rooms.find((r) => r.code === joinCodeInput)
    if (!room) { setErrorMsg('パスコードが間違っています。'); return }
    if (room.status !== 'waiting') { setErrorMsg('すでに診断が始まっています。'); return }
    try {
      const existing = participants.find((p) => p.room_code === joinCodeInput && p.user_id === userId)
      if (!existing) {
        const { error } = await supabase.from('participants').insert({ user_id: userId!, room_code: joinCodeInput, name: userName, answers: [], is_finished: false })
        if (error) throw error
      }
      setRoomCode(joinCodeInput); setIsHost(false); setCurrentView('LOBBY'); setErrorMsg('')
    } catch { setErrorMsg('通信エラーが発生しました。') }
  }, [userName, joinCodeInput, rooms, participants, userId])

  const copyInviteText = useCallback(() => {
    const baseUrl = window.location.href.split('?')[0].split('#')[0]
    const text = `価値観マッチングに参加しよう！\nURL: ${baseUrl}\nパスコード: 【 ${roomCode} 】`
    const el = document.createElement('textarea')
    el.value = text; el.style.position = 'absolute'; el.style.left = '-999999px'
    document.body.appendChild(el); el.select()
    try { document.execCommand('copy'); setCopySuccess('コピーしました！LINE等で共有してください'); setTimeout(() => setCopySuccess(''), 3000) }
    catch { setCopySuccess('コピーに失敗しました。手動でパスコードを伝えてください。') }
    finally { el.remove() }
  }, [roomCode])

  const addDummyUsers = useCallback(async () => {
    if (!currentRoom) return
    const dummies = ['あきら(Bot)', 'サヤカ(Bot)', 'ケンジ(Bot)', 'マイ(Bot)'].map((name) => ({
      user_id: `dummy-${crypto.randomUUID().slice(0, 9)}`,
      room_code: currentRoom.code, name,
      answers: QUESTIONS.map(() => (Math.random() > 0.5 ? 1 : -1)),
      is_finished: true,
    }))
    await supabase.from('participants').insert(dummies)
  }, [currentRoom])

  const startGame = useCallback(async () => {
    if (!isHost || !currentRoom) return
    await supabase.from('rooms').update({ status: 'playing' }).eq('id', currentRoom.id)
  }, [isHost, currentRoom])

  const handleAnswer = useCallback(async (value: number) => {
    const newAnswers = [...localAnswers, value]
    setLocalAnswers(newAnswers)
    if (newAnswers.length < QUESTIONS.length) {
      setCurrentQIdx((idx) => idx + 1)
      if (me) supabase.from('participants').update({ answers: newAnswers }).eq('id', me.id).then()
    } else {
      setCurrentView('WAITING')
      if (me) await supabase.from('participants').update({ answers: newAnswers, is_finished: true }).eq('id', me.id)
    }
  }, [localAnswers, me])

  const triggerCalculation = useCallback(async () => {
    if (!isHost || !currentRoom) return
    await supabase.from('rooms').update({ status: 'calculating' }).eq('id', currentRoom.id)
  }, [isHost, currentRoom])

  const resetGame = useCallback(() => {
    setRoomCode(''); setJoinCodeInput(''); setLocalAnswers([]); setCurrentQIdx(0)
    setIsHost(false); setCurrentView('JOIN'); setShowMethodology(false); setIsRestoring(false)
  }, [])

  if (!userId || isRestoring) return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center gap-4">
      <div className="w-10 h-10 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
      <p className="text-sm font-bold text-gray-500">データを読み込んでいます...</p>
    </div>
  )

  const MethodologyModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full relative my-8 p-6 shadow-xl">
        <button onClick={() => setShowMethodology(false)} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold">✕</button>
        <h3 className="text-xl font-bold mb-4 border-b pb-2">開発者の想いとアルゴリズム</h3>
        <div className="space-y-4 text-sm text-gray-700 leading-relaxed max-h-[60vh] overflow-y-auto pr-2">
          <p className="font-bold">「気が合う」という感覚は、科学できる。</p>
          <p>友人同士の集まりや、新しいチームでの出会いにおいて、「気が合うね」と感じる直感は、実は心理学的・統計学的に裏付け可能な事象です。</p>
          <h4 className="font-bold text-gray-900 mt-6 bg-gray-100 px-2 py-1 rounded">1. コサイン類似度（Cosine Similarity）</h4>
          <p>全員の回答を多次元ベクトルに変換し、その「方向性の近さ」を角度として計算します。</p>
          <h4 className="font-bold text-gray-900 mt-4 bg-gray-100 px-2 py-1 rounded">2. 相互補完性（Complementarity Theory）</h4>
          <p>「価値観が真逆＝相性が悪い」とは限りません。異なる特性を持つペアがチームとして強固な関係を築く「相補性」が確認されています。</p>
          <h4 className="font-bold text-gray-900 mt-4 bg-gray-100 px-2 py-1 rounded">3. 情報エントロピーと特異度判定</h4>
          <p>参加者全員の「価値観の重心（平均値）」を計算し、そこから最も離れている人物を「マイノリティ・レポート」として抽出しています。</p>
          <p className="mt-6 text-xs text-gray-500 text-center">このアプリが、皆様の深い対話のきっかけになれば幸いです。</p>
        </div>
      </div>
    </div>
  )

  if (currentView === 'JOIN') return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col justify-center py-8 px-4">
      <div className="max-w-md w-full mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">価値観マッチング</h1>
          <p className="text-gray-500 text-sm font-medium">直感で答える、理論に基づく相性診断</p>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 mb-6">
          {errorMsg && <div className="bg-red-50 text-red-600 p-3 rounded-xl mb-6 text-sm font-medium text-center border border-red-200">{errorMsg}</div>}
          <div className="mb-6">
            <label className="block text-sm font-bold text-gray-700 mb-2">1. まずはニックネームを入力</label>
            <input type="text" placeholder="例：たろう" value={userName} onChange={(e) => setUserName(e.target.value)}
              className="w-full p-4 rounded-xl border-2 border-gray-200 bg-gray-50 text-gray-900 focus:outline-none focus:border-gray-800 focus:bg-white transition-colors text-lg" maxLength={10} />
          </div>
          <div className="h-px bg-gray-200 w-full mb-6" />
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">2-A. 新しく始める（幹事）</label>
              <button onClick={handleCreateRoom} className="w-full py-4 rounded-xl bg-gray-900 text-white font-bold text-lg hover:bg-gray-800 active:scale-95 transition-transform">新しくルームを作る</button>
            </div>
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
              <div className="relative flex justify-center"><span className="px-3 bg-white text-sm text-gray-400 font-bold">または</span></div>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">2-B. 招待されたルームに参加</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input type="text" placeholder="4桁のパスコード" value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value)}
                  className="flex-1 p-4 rounded-xl border-2 border-gray-200 bg-gray-50 text-center text-xl tracking-widest focus:outline-none focus:border-gray-800 focus:bg-white transition-colors" maxLength={4} />
                <button onClick={handleJoinRoom} className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gray-800 text-white font-bold hover:bg-gray-700 active:scale-95 transition-transform">参加する</button>
              </div>
            </div>
          </div>
        </div>
        <div className="text-center">
          <button onClick={() => setShowMethodology(true)} className="text-sm font-bold text-gray-400 hover:text-gray-600 underline underline-offset-4">開発者の想いとアルゴリズム</button>
        </div>
      </div>
      {showMethodology && <MethodologyModal />}
    </div>
  )

  if (currentView === 'LOBBY') return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col justify-center py-8 px-4">
      <div className="max-w-md w-full mx-auto flex flex-col items-center">
        <span className="text-sm font-bold text-gray-500 mb-2">招待パスコード</span>
        <div className="text-6xl font-black tracking-widest text-gray-900 mb-4 font-mono bg-white px-8 py-3 rounded-3xl shadow-sm border-2 border-gray-100">{roomCode}</div>
        {isHost && (
          <div className="mb-8 w-full text-center">
            <button onClick={copyInviteText} className="inline-flex items-center gap-2 bg-gray-100 text-gray-700 font-bold py-2 px-4 rounded-full border border-gray-300 hover:bg-gray-200 transition-colors text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              招待テキストとURLをコピー
            </button>
            {copySuccess && <p className="text-xs text-gray-600 font-bold mt-2">{copySuccess}</p>}
          </div>
        )}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 w-full mb-8 border-t-4 border-t-gray-900">
          <div className="flex justify-between items-center border-b pb-3 mb-4">
            <h3 className="text-base font-bold text-gray-800">参加メンバー</h3>
            <span className="bg-gray-100 text-gray-800 text-sm font-bold px-3 py-1 rounded-lg">{roomParticipants.length} 人</span>
          </div>
          <ul className="space-y-2 mb-4">
            {roomParticipants.map((p) => (
              <li key={p.id} className="flex items-center text-gray-800 font-medium p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="w-2 h-2 rounded-full bg-gray-400 mr-3" />{p.name}
                {p.user_id === userId && <span className="ml-auto text-xs font-bold text-gray-600 bg-gray-200 px-2 py-1 rounded">あなた</span>}
              </li>
            ))}
          </ul>
          {isHost && <button onClick={addDummyUsers} className="w-full py-3 mt-4 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 text-sm font-bold hover:bg-gray-50 transition-colors">+ テスト用メンバーを追加（1人プレイ用）</button>}
        </div>
        {isHost ? (
          <button onClick={startGame} disabled={roomParticipants.length < 2}
            className={`w-full py-5 rounded-2xl font-bold text-lg transition-all ${roomParticipants.length < 2 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-900 text-white hover:bg-gray-800 active:scale-95 shadow-md'}`}>
            {roomParticipants.length < 2 ? '2人以上で開始できます' : '診断をスタート'}
          </button>
        ) : (
          <div className="w-full py-5 text-center text-gray-600 font-bold bg-white rounded-2xl border-2 border-gray-200 flex justify-center items-center gap-3">
            <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />幹事のスタートを待っています...
          </div>
        )}
      </div>
    </div>
  )

  if (currentView === 'PLAYING') {
    const q = QUESTIONS[currentQIdx]
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col justify-center py-8 px-4">
        <div className="max-w-2xl w-full mx-auto">
          <div className="flex flex-col md:flex-row justify-between md:items-end mb-8 gap-4">
            <div>
              <span className="text-gray-400 text-xs font-bold uppercase tracking-wider block mb-1">Question {currentQIdx + 1} of {QUESTIONS.length}</span>
              <span className="inline-block bg-gray-100 text-gray-800 border border-gray-300 text-sm font-bold px-4 py-1.5 rounded-lg">{q.dim}</span>
            </div>
            <div className="w-full md:w-1/3 bg-gray-200 rounded-full h-2.5 overflow-hidden">
              <div className="bg-gray-900 h-2.5 rounded-full transition-all duration-300" style={{ width: `${(currentQIdx / QUESTIONS.length) * 100}%` }} />
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border-2 border-gray-900 shadow-[4px_4px_0_0_rgba(17,24,39,1)] mb-8 min-h-[160px] flex items-center justify-center">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 leading-relaxed text-center px-4">{q.text}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button onClick={() => handleAnswer(1)} className="p-6 rounded-2xl bg-white border-2 border-gray-200 text-xl font-bold text-gray-800 hover:border-gray-900 hover:bg-gray-50 active:scale-95 transition-all shadow-sm">{q.a}</button>
            <button onClick={() => handleAnswer(-1)} className="p-6 rounded-2xl bg-white border-2 border-gray-200 text-xl font-bold text-gray-800 hover:border-gray-900 hover:bg-gray-50 active:scale-95 transition-all shadow-sm">{q.b}</button>
          </div>
        </div>
      </div>
    )
  }

  if (currentView === 'WAITING') {
    const col = COLUMNS[columnIdx]
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col justify-center py-8 px-4">
        <div className="max-w-md w-full mx-auto text-center">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6 border-4 border-gray-200">
            <svg className="w-10 h-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h2 className="text-3xl font-black text-gray-900 mb-2">回答完了</h2>
          <p className="text-gray-500 font-medium mb-8">全員が答え終わるのを待っています...</p>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 text-left border-t-4 border-t-gray-400 mb-6">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
              <h3 className="text-sm font-bold text-gray-700">現在の状況</h3>
              <span className="text-gray-900 font-black text-xl font-mono">{roomParticipants.filter((p) => p.is_finished).length} / {roomParticipants.length}</span>
            </div>
            <ul className="space-y-3">
              {roomParticipants.map((p) => (
                <li key={p.id} className="flex justify-between items-center text-sm font-bold p-2 rounded-lg bg-gray-50">
                  <span className={p.is_finished ? 'text-gray-900' : 'text-gray-400'}>{p.name}</span>
                  {p.is_finished ? <span className="px-2.5 py-1 bg-gray-200 text-gray-800 rounded-md text-xs">完了</span>
                    : <span className="text-gray-400 text-xs flex items-center gap-1.5"><span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" />考え中</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-4 text-left min-h-[140px] flex flex-col justify-center">
            <span className="text-xs font-bold text-gray-500 mb-1 block">待ち時間コラム</span>
            <h4 className="font-bold text-gray-800 mb-2">{col.title}</h4>
            <p className="text-xs text-gray-600 leading-relaxed">{col.text}</p>
          </div>
          {isHost && allFinished && (
            <button onClick={triggerCalculation} className="mt-8 w-full py-5 rounded-2xl bg-gray-900 text-white font-bold text-xl hover:bg-gray-800 active:scale-95 transition-transform shadow-[4px_4px_0_0_rgba(156,163,175,1)]">結果を解析する</button>
          )}
        </div>
      </div>
    )
  }

  if (currentView === 'CALCULATING') return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center">
      <div className="relative w-20 h-20 mb-8">
        <div className="absolute inset-0 border-4 border-gray-200 rounded-full" />
        <div className="absolute inset-0 border-4 border-gray-900 rounded-full border-t-transparent animate-spin" />
      </div>
      <h2 className="text-2xl font-black text-gray-900 mb-2">解析中...</h2>
      <p className="text-sm text-gray-500 font-medium">多次元ベクトル空間での距離を測定しています</p>
    </div>
  )

  if (currentView === 'RESULT') {
    const results = calculateResults(roomParticipants)
    if (!results) return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 text-center max-w-md w-full mx-4">
          <p className="mb-6 font-bold text-gray-600">計算に必要なデータが足りません。</p>
          <button onClick={resetGame} className="w-full py-3 bg-gray-200 rounded-xl font-bold text-gray-700 hover:bg-gray-300">トップに戻る</button>
        </div>
      </div>
    )
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans py-8 px-4">
        {showMethodology && <MethodologyModal />}
        <div className="max-w-3xl w-full mx-auto pb-10">
          <div className="text-center mb-10">
            <span className="text-xs font-bold text-gray-500 tracking-widest uppercase border-b-2 border-gray-900 inline-block pb-1 mb-2">Analysis Result</span>
            <h1 className="text-4xl font-black text-gray-900 mt-2">診断結果</h1>
          </div>
          <div className="space-y-12">
            <section>
              <h3 className="font-black text-gray-900 text-xl mb-1">最も価値観が近い2人</h3>
              <p className="text-sm text-gray-600 mb-3">考え方のベクトルが似ているため、一緒にいて自然体でいられる関係です。</p>
              <div className="bg-white rounded-2xl p-8 border-2 border-gray-900 shadow-[8px_8px_0_0_rgba(17,24,39,1)] text-center">
                <div className="flex items-center justify-center gap-4 mb-6">
                  <span className="text-3xl font-black">{results.best.p1.name.replace('(Bot)', '')}</span>
                  <span className="text-gray-300 text-2xl">×</span>
                  <span className="text-3xl font-black">{results.best.p2.name.replace('(Bot)', '')}</span>
                </div>
                <div className="inline-flex items-baseline bg-gray-100 px-8 py-3 rounded-2xl border border-gray-200">
                  <span className="text-sm font-bold text-gray-600 mr-4">シンクロ率</span>
                  <span className="text-5xl font-black text-gray-900">{results.best.percent}</span>
                  <span className="text-xl font-bold ml-1">%</span>
                </div>
              </div>
            </section>
            <section>
              <h3 className="font-bold text-gray-900 text-lg mb-1">最も価値観が遠い2人</h3>
              <p className="text-sm text-gray-600 mb-3">考え方が違うため、お互いの弱点をカバーし合えるチームになれる関係です。</p>
              <div className="bg-gray-50 rounded-2xl p-6 border-2 border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="text-2xl font-black text-gray-800">{results.worst.p1.name.replace('(Bot)', '')} <span className="text-gray-400 font-normal text-sm mx-2">vs</span> {results.worst.p2.name.replace('(Bot)', '')}</div>
                <div className="bg-white px-4 py-2 rounded-xl border border-gray-300 font-bold text-xl text-gray-700 shadow-sm whitespace-nowrap">類似度 {results.worst.percent}<span className="text-sm ml-1">%</span></div>
              </div>
            </section>
            <section>
              <h3 className="font-bold text-gray-900 text-lg mb-1">最も独自路線を行く人</h3>
              <p className="text-sm text-gray-600 mb-3">グループの平均値から最も外れた独自の感性を持つ、貴重な存在です。</p>
              <div className="bg-gray-50 rounded-2xl p-6 border-2 border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="text-2xl font-black text-gray-800">{results.minority.name.replace('(Bot)', '')}</div>
                <div className="text-right">
                  <span className="text-xs font-bold text-gray-500 block mb-1">独自性スコア</span>
                  <div className="bg-white px-4 py-2 rounded-xl border border-gray-300 font-bold text-xl text-gray-700 shadow-sm inline-block">{results.minority.uniquenessScore}<span className="text-sm ml-1">%</span></div>
                </div>
              </div>
            </section>
            <section>
              <h3 className="text-lg font-bold text-gray-900 border-b-2 border-gray-200 pb-2 mb-4">参加者ごとのベストマッチ</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {results.personalBests.map((pb, i) => (
                  <div key={i} className="flex justify-between items-center p-4 bg-white rounded-xl border-2 border-gray-100 shadow-sm">
                    <div className="font-bold text-gray-800 text-sm">{pb.me.name.replace('(Bot)', '')} <span className="text-gray-400 font-normal text-xs mx-1">の相手</span> <span className="border-b border-gray-900">{pb.partner.name.replace('(Bot)', '')}</span></div>
                    <div className="text-sm font-black text-gray-600 bg-gray-100 px-2.5 py-1 rounded-md ml-2 whitespace-nowrap">{pb.percent}%</div>
                  </div>
                ))}
              </div>
            </section>
            <section className="pt-8 border-t-2 border-dashed border-gray-300">
              <div className="mb-8 text-center">
                <h3 className="font-black text-gray-900 text-2xl">グループの回答分布</h3>
                <p className="text-sm text-gray-600 mt-2">みんながどちらの回答を選んだかの割合データです。</p>
              </div>
              <div className="bg-gray-50 rounded-2xl p-6 border border-gray-200 space-y-6">
                {QUESTIONS.map((q, idx) => {
                  const stats = results.questionStats[idx]
                  return (
                    <div key={idx} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                      <p className="text-sm font-bold text-gray-900 mb-3 leading-relaxed">{q.text}</p>
                      <div className="flex justify-between text-xs font-bold text-gray-600 mb-2 px-1">
                        <span>{q.a} <span className="text-gray-900">({stats.aPercent}%)</span></span>
                        <span><span className="text-gray-900">({stats.bPercent}%)</span> {q.b}</span>
                      </div>
                      <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden flex border border-gray-300">
                        <div style={{ width: `${stats.aPercent}%` }} className="bg-gray-800 h-full transition-all duration-1000" />
                        <div style={{ width: `${stats.bPercent}%` }} className="bg-gray-300 h-full transition-all duration-1000" />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
          <div className="mt-16 flex flex-col gap-4 max-w-sm mx-auto">
            <button onClick={() => setShowMethodology(true)} className="text-sm font-bold text-gray-500 hover:text-gray-800 underline underline-offset-4 text-center">開発者の想いとアルゴリズムの裏側を見る</button>
            <button onClick={resetGame} className="w-full py-5 bg-gray-900 text-white rounded-2xl font-bold text-lg hover:bg-gray-800 active:scale-95 transition-transform shadow-[4px_4px_0_0_rgba(156,163,175,1)]">最初からもう一度遊ぶ</button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
