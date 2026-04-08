'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { QUESTIONS, COLUMNS } from '@/lib/questions'
import { calculateResults } from '@/lib/matching'
import type { Room, Participant } from '@/types/database'

type View = 'NAME_INPUT' | 'ROOM_SELECT' | 'LOBBY' | 'PLAYING' | 'WAITING' | 'CALCULATING' | 'RESULT'

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
  }, [userId, isRestoring])

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

      setRooms(prev => [...prev, roomData as Room])
      setParticipants(prev => [...prev, partData as Participant])

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
        setParticipants(prev => [...prev, partData as Participant])
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

  const completelyResetGame = useCallback(() => {
    setRoomCode(''); setJoinCodeInput(''); setLocalAnswers([]); setCurrentQIdx(0)
    setIsHost(false); setUserName(''); setCurrentView('NAME_INPUT'); setShowMethodology(false); setIsRestoring(false)
  }, [])

  if (!userId || isRestoring) return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center gap-5">
      <div className="relative flex justify-center items-center">
        <div className="w-12 h-12 border-4 border-indigo-100 rounded-full"></div>
        <div className="w-12 h-12 border-4 border-indigo-500 rounded-full border-t-transparent animate-spin absolute"></div>
      </div>
      <p className="text-sm font-bold text-slate-400 tracking-wider">データを読み込んでいます...</p>
    </div>
  )

  // --- UI Components ---
  const ResetButton = () => (
    <div className="mt-12 text-center pb-6">
      <button onClick={completelyResetGame} className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors bg-white px-4 py-2 rounded-full shadow-sm border border-slate-100">
        最初からやり直す（退出）
      </button>
    </div>
  )

  const MethodologyModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-[2rem] max-w-lg w-full relative my-8 p-6 sm:p-8 shadow-2xl">
        <button onClick={() => setShowMethodology(false)} className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition-colors">✕</button>
        
        <div className="text-center mb-6 mt-2">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full border-4 border-white shadow-lg overflow-hidden bg-slate-100">
             <img src="/icon-dt.jpg" alt="Developer" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.src = 'https://via.placeholder.com/150?text=Dog' }} />
          </div>
          <h3 className="text-2xl font-black text-slate-800 tracking-tight">開発者の想いと裏側</h3>
        </div>

        <div className="space-y-5 text-sm text-slate-600 leading-relaxed max-h-[50vh] overflow-y-auto pr-3">
          <p className="font-bold text-slate-800 text-base">「気が合う」という感覚は、科学できる。</p>
          <p>友人同士の集まりや、新しいチームでの出会いにおいて、「気が合うね」と感じる直感は、実は心理学的・統計学的に裏付け可能な事象です。</p>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <h4 className="font-bold text-indigo-600 mb-1">1. コサイン類似度（Cosine Similarity）</h4>
            <p>全員の回答を多次元ベクトルに変換し、その「方向性の近さ」を角度として計算します。</p>
          </div>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <h4 className="font-bold text-rose-500 mb-1">2. 相互補完性（Complementarity Theory）</h4>
            <p>「価値観が真逆＝相性が悪い」とは限りません。異なる特性を持つペアがチームとして強固な関係を築く「相補性」が確認されています。</p>
          </div>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <h4 className="font-bold text-amber-500 mb-1">3. 情報エントロピーと特異度判定</h4>
            <p>参加者全員の「価値観の重心（平均値）」を計算し、そこから最も離れている人物を「マイノリティ・レポート」として抽出しています。</p>
          </div>
          <p className="mt-8 pb-4 text-xs font-bold text-slate-400 text-center tracking-wider">
            このアプリが、皆様の深い対話のきっかけになれば幸いです。
          </p>
        </div>
      </div>
    </div>
  )

  if (currentView === 'NAME_INPUT') return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col justify-center py-8 px-4">
      <div className="max-w-md w-full mx-auto">
        <div className="mb-10 text-center">
          <h1 className="text-4xl md:text-5xl font-black mb-3 tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-rose-500">
            価値観マッチング
          </h1>
          <p className="text-slate-500 font-medium tracking-wide">直感で答える、理論に基づく相性診断</p>
        </div>
        <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-xl shadow-slate-200/50 border border-slate-100 mb-6">
          {errorMsg && <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl mb-6 text-sm font-bold text-center border border-rose-100">{errorMsg}</div>}
          <div className="mb-6">
            <label className="block text-sm font-bold text-slate-700 mb-3 ml-1">まずはニックネームを入力</label>
            <input type="text" placeholder="例：たろう" value={userName} onChange={(e) => setUserName(e.target.value)}
              className="w-full p-4 rounded-2xl bg-slate-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-lg font-medium" maxLength={10} />
          </div>
          <button onClick={handleNextToRoomSelect} className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-lg hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-200 active:scale-[0.98] transition-all">
            次へ進む
          </button>
        </div>
        <div className="text-center mt-8">
          <button onClick={() => setShowMethodology(true)} className="text-sm font-bold text-slate-400 hover:text-indigo-500 transition-colors flex items-center justify-center gap-2 mx-auto">
            <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-xs text-white">i</span>
            開発者の想いとアルゴリズム
          </button>
        </div>
      </div>
      {showMethodology && <MethodologyModal />}
    </div>
  )

  if (currentView === 'ROOM_SELECT') return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col justify-center py-8 px-4">
      <div className="max-w-md w-full mx-auto">
        <div className="mb-6">
          <button onClick={() => setCurrentView('NAME_INPUT')} className="text-sm font-bold text-slate-400 hover:text-slate-600 flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-sm border border-slate-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
            名前変更に戻る
          </button>
        </div>
        <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-xl shadow-slate-200/50 border border-slate-100 mb-6">
          {errorMsg && <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl mb-6 text-sm font-bold text-center border border-rose-100">{errorMsg}</div>}
          <div className="space-y-8">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-3 ml-1">A. 新しく始める（幹事用）</label>
              <button onClick={handleCreateRoom} className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-lg hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-200 active:scale-[0.98] transition-all">新しくルームを作る</button>
            </div>
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
              <div className="relative flex justify-center"><span className="px-4 bg-white text-xs font-bold tracking-widest text-slate-400 uppercase">OR</span></div>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-3 ml-1">B. 招待されたルームに参加</label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input type="text" placeholder="4桁のパスコード" value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value)}
                  className="flex-1 p-4 rounded-2xl bg-slate-50 text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono text-slate-700" maxLength={4} />
                <button onClick={handleJoinRoom} className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-slate-800 text-white font-bold hover:bg-slate-900 hover:shadow-lg active:scale-[0.98] transition-all">参加する</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (currentView === 'LOBBY') return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col py-8 px-4 relative">
      <div className="max-w-md w-full mx-auto flex flex-col items-center flex-grow justify-center">
        <span className="text-sm font-bold text-slate-400 mb-2 tracking-widest uppercase">Room PIN</span>
        <div className="text-6xl sm:text-7xl font-black tracking-widest text-indigo-600 mb-6 font-mono drop-shadow-sm">{roomCode}</div>
        {isHost && (
          <div className="mb-10 w-full text-center">
            <button onClick={copyInviteText} className="inline-flex items-center gap-2 bg-white text-slate-600 font-bold py-3 px-6 rounded-full shadow-sm border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-all text-sm active:scale-95">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              招待テキストとURLをコピー
            </button>
            {copySuccess && <p className="text-xs text-emerald-500 font-bold mt-3 animate-pulse">{copySuccess}</p>}
          </div>
        )}
        <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-xl shadow-slate-200/50 border border-slate-100 w-full mb-8">
          <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-4">
            <h3 className="text-base font-bold text-slate-800">参加メンバー</h3>
            <span className="bg-indigo-50 text-indigo-600 text-sm font-bold px-3 py-1 rounded-full">{roomParticipants.length} 人</span>
          </div>
          <ul className="space-y-3 mb-2">
            {roomParticipants.map((p) => (
              <li key={p.id} className="flex items-center text-slate-700 font-bold p-3 bg-slate-50 rounded-2xl">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-3 shadow-sm" />{p.name}
                {p.user_id === userId && <span className="ml-auto text-[10px] font-black text-indigo-600 bg-indigo-100 px-2 py-1 rounded-md uppercase tracking-wider">You</span>}
              </li>
            ))}
          </ul>
          {isHost && <button onClick={addDummyUsers} className="w-full py-4 mt-6 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 text-sm font-bold hover:bg-slate-50 hover:text-indigo-500 hover:border-indigo-200 transition-colors">+ テスト用メンバーを追加</button>}
        </div>
        {isHost ? (
          <button onClick={startGame} disabled={roomParticipants.length < 2}
            className={`w-full py-5 rounded-2xl font-bold text-lg transition-all active:scale-[0.98] ${roomParticipants.length < 2 ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-200'}`}>
            {roomParticipants.length < 2 ? '2人以上で開始できます' : '診断をスタート'}
          </button>
        ) : (
          <div className="w-full py-5 text-center text-slate-500 font-bold bg-white rounded-2xl shadow-sm border border-slate-100 flex justify-center items-center gap-3">
            <div className="w-5 h-5 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" />幹事のスタートを待っています...
          </div>
        )}
      </div>
      <ResetButton />
    </div>
  )

  if (currentView === 'PLAYING') {
    const q = QUESTIONS[currentQIdx]
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col py-8 px-4 relative">
        <div className="max-w-2xl w-full mx-auto flex-grow flex flex-col justify-center">
          <div className="flex flex-col md:flex-row justify-between md:items-end mb-8 gap-4 px-2">
            <div>
              <span className="text-slate-400 text-xs font-black uppercase tracking-widest block mb-2">Question {currentQIdx + 1} / {QUESTIONS.length}</span>
              <span className="inline-block bg-white text-indigo-600 border border-indigo-100 text-sm font-bold px-4 py-1.5 rounded-full shadow-sm">{q.dim}</span>
            </div>
            <div className="w-full md:w-1/3 bg-slate-200 rounded-full h-2 overflow-hidden">
              <div className="bg-gradient-to-r from-indigo-500 to-rose-400 h-full transition-all duration-500 ease-out" style={{ width: `${(currentQIdx / QUESTIONS.length) * 100}%` }} />
            </div>
          </div>
          <div className="bg-white rounded-[2rem] p-8 sm:p-10 shadow-xl shadow-slate-200/50 border border-slate-100 mb-8 min-h-[200px] flex items-center justify-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-rose-400" />
            <h2 className="text-2xl md:text-3xl font-bold text-slate-800 leading-relaxed text-center">{q.text}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button onClick={() => handleAnswer(1)} className="p-6 rounded-[1.5rem] bg-white border border-slate-200 text-xl font-bold text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 active:scale-95 transition-all shadow-sm">{q.a}</button>
            <button onClick={() => handleAnswer(-1)} className="p-6 rounded-[1.5rem] bg-white border border-slate-200 text-xl font-bold text-slate-700 hover:border-rose-400 hover:bg-rose-50 hover:text-rose-700 active:scale-95 transition-all shadow-sm">{q.b}</button>
          </div>
        </div>
        <ResetButton />
      </div>
    )
  }

  if (currentView === 'WAITING') {
    const col = COLUMNS[columnIdx]
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col py-8 px-4 relative">
        <div className="max-w-md w-full mx-auto text-center flex-grow flex flex-col justify-center">
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-100 border border-slate-100">
            <svg className="w-12 h-12 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h2 className="text-3xl font-black text-slate-800 mb-2">回答完了</h2>
          <p className="text-slate-500 font-medium mb-8">全員が答え終わるのを待っています...</p>
          <div className="bg-white rounded-[2rem] p-6 shadow-xl shadow-slate-200/50 border border-slate-100 text-left mb-6">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-sm font-bold text-slate-600">進行状況</h3>
              <span className="text-indigo-600 font-black text-xl font-mono">{roomParticipants.filter((p) => p.is_finished).length} / {roomParticipants.length}</span>
            </div>
            <ul className="space-y-3">
              {roomParticipants.map((p) => (
                <li key={p.id} className="flex justify-between items-center text-sm font-bold p-3 rounded-2xl bg-slate-50">
                  <span className={p.is_finished ? 'text-slate-800' : 'text-slate-400'}>{p.name}</span>
                  {p.is_finished ? <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs">完了</span>
                    : <span className="text-slate-400 text-xs flex items-center gap-2"><span className="w-2 h-2 bg-slate-300 rounded-full animate-pulse" />考え中</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-indigo-50/50 rounded-[2rem] p-6 text-left min-h-[140px] flex flex-col justify-center border border-indigo-100/50">
            <span className="text-xs font-black text-indigo-400 mb-2 block uppercase tracking-wider">Column</span>
            <h4 className="font-bold text-slate-800 mb-2">{col.title}</h4>
            <p className="text-xs text-slate-600 leading-relaxed">{col.text}</p>
          </div>
          {isHost && allFinished && (
            <button onClick={triggerCalculation} className="mt-10 w-full py-5 rounded-2xl bg-gradient-to-r from-indigo-600 to-rose-500 text-white font-bold text-xl hover:shadow-lg hover:shadow-rose-200 active:scale-[0.98] transition-all">結果を解析する</button>
          )}
        </div>
        <ResetButton />
      </div>
    )
  }

  if (currentView === 'CALCULATING') return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center">
      <div className="relative w-24 h-24 mb-8 flex justify-center items-center">
        <div className="absolute inset-0 border-4 border-slate-200 rounded-full" />
        <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin" />
        <span className="text-2xl animate-pulse">🧠</span>
      </div>
      <h2 className="text-2xl font-black text-slate-800 mb-2 tracking-widest">解析中...</h2>
      <p className="text-sm text-slate-500 font-medium">多次元ベクトル空間での距離を測定しています</p>
    </div>
  )

  if (currentView === 'RESULT') {
    const results = calculateResults(roomParticipants)
    if (!results) return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center">
        <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 text-center max-w-md w-full mx-4">
          <p className="mb-6 font-bold text-gray-600">計算に必要なデータが足りません。</p>
          <button onClick={completelyResetGame} className="w-full py-4 bg-slate-100 rounded-2xl font-bold text-slate-600 hover:bg-slate-200">トップに戻る</button>
        </div>
      </div>
    )
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans py-10 px-4">
        {showMethodology && <MethodologyModal />}
        <div className="max-w-3xl w-full mx-auto pb-10">
          <div className="text-center mb-12">
            <span className="text-xs font-black text-indigo-500 tracking-[0.2em] uppercase mb-3 block">Analysis Result</span>
            <h1 className="text-4xl md:text-5xl font-black text-slate-800 tracking-tight">診断結果</h1>
          </div>
          <div className="space-y-10">
            <section>
              <div className="mb-4 text-center">
                <h3 className="font-black text-slate-800 text-2xl tracking-tight">最も価値観が近い2人</h3>
                <p className="text-sm text-slate-500 mt-2 font-medium">考え方のベクトルが似ているため、一緒にいて自然体でいられる関係です。</p>
              </div>
              <div className="bg-white rounded-[2rem] p-8 md:p-10 shadow-xl shadow-slate-200/50 border border-slate-100 text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 to-rose-400" />
                <div className="flex items-center justify-center gap-4 mb-8 mt-2">
                  <span className="text-3xl md:text-4xl font-black text-slate-800">{results.best.p1.name.replace('(Bot)', '')}</span>
                  <span className="text-slate-300 text-3xl font-light">×</span>
                  <span className="text-3xl md:text-4xl font-black text-slate-800">{results.best.p2.name.replace('(Bot)', '')}</span>
                </div>
                <div className="inline-flex items-baseline bg-slate-50 px-8 py-4 rounded-[2rem] border border-slate-100">
                  <span className="text-sm font-black text-slate-400 mr-5 uppercase tracking-wider">Sync</span>
                  <span className="text-6xl font-black text-indigo-600 tracking-tighter">{results.best.percent}</span>
                  <span className="text-2xl font-bold text-indigo-400 ml-1">%</span>
                </div>
              </div>
            </section>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <section>
                <div className="bg-white rounded-[2rem] p-8 shadow-xl shadow-slate-200/50 border border-slate-100 h-full flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg mb-2">最も価値観が遠い2人</h3>
                    <p className="text-xs text-slate-500 font-medium mb-6 leading-relaxed">考え方が違うため、お互いの弱点をカバーし合えるチームになれる関係です。</p>
                  </div>
                  <div className="bg-rose-50/50 rounded-2xl p-5 border border-rose-100/50">
                    <div className="text-xl font-black text-slate-700 mb-3 text-center">{results.worst.p1.name.replace('(Bot)', '')} <span className="text-slate-300 font-normal mx-1">vs</span> {results.worst.p2.name.replace('(Bot)', '')}</div>
                    <div className="text-center"><span className="text-xs font-bold text-rose-400 mr-2">類似度</span><span className="font-black text-2xl text-rose-500">{results.worst.percent}%</span></div>
                  </div>
                </div>
              </section>
              <section>
                <div className="bg-white rounded-[2rem] p-8 shadow-xl shadow-slate-200/50 border border-slate-100 h-full flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg mb-2">最も独自路線を行く人</h3>
                    <p className="text-xs text-slate-500 font-medium mb-6 leading-relaxed">グループの平均値から最も外れた独自の感性を持つ、貴重な存在です。</p>
                  </div>
                  <div className="bg-amber-50/50 rounded-2xl p-5 border border-amber-100/50 text-center">
                    <div className="text-2xl font-black text-slate-700 mb-2">{results.minority.name.replace('(Bot)', '')}</div>
                    <div><span className="text-xs font-bold text-amber-500 mr-2">独自性スコア</span><span className="font-black text-2xl text-amber-500">{results.minority.uniquenessScore}%</span></div>
                  </div>
                </div>
              </section>
            </div>

            <section>
              <h3 className="text-lg font-black text-slate-800 border-b-2 border-slate-200 pb-3 mb-5 mt-4">参加者ごとのベストマッチ</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {results.personalBests.map((pb, i) => (
                  <div key={i} className="flex justify-between items-center p-5 bg-white rounded-2xl border border-slate-100 shadow-sm">
                    <div className="font-bold text-slate-700 text-sm">{pb.me.name.replace('(Bot)', '')} <span className="text-slate-400 font-medium text-xs mx-2">の相手</span> <span className="text-indigo-600">{pb.partner.name.replace('(Bot)', '')}</span></div>
                    <div className="text-sm font-black text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">{pb.percent}%</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="pt-10 border-t-2 border-dashed border-slate-200">
              <div className="mb-10 text-center">
                <h3 className="font-black text-slate-800 text-2xl tracking-tight">グループの回答分布</h3>
                <p className="text-sm text-slate-500 mt-2 font-medium">みんながどちらの回答を選んだかの割合データです。</p>
              </div>
              <div className="bg-white rounded-[2rem] p-6 sm:p-10 shadow-xl shadow-slate-200/50 border border-slate-100 space-y-8">
                {QUESTIONS.map((q, idx) => {
                  const stats = results.questionStats[idx]
                  return (
                    <div key={idx}>
                      <p className="text-sm font-bold text-slate-800 mb-4 leading-relaxed">{q.text}</p>
                      <div className="flex justify-between text-xs font-black text-slate-500 mb-3 px-1">
                        <span>{q.a} <span className="text-indigo-500">({stats.aPercent}%)</span></span>
                        <span><span className="text-rose-400">({stats.bPercent}%)</span> {q.b}</span>
                      </div>
                      <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
                        <div style={{ width: `${stats.aPercent}%` }} className="bg-indigo-500 h-full transition-all duration-1000" />
                        <div style={{ width: `${stats.bPercent}%` }} className="bg-rose-400 h-full transition-all duration-1000" />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>

          <div className="mt-16 flex flex-col gap-5 max-w-sm mx-auto">
            <button onClick={() => setShowMethodology(true)} className="text-sm font-bold text-slate-400 hover:text-indigo-500 transition-colors flex items-center justify-center gap-2 mx-auto">
              <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-xs text-white">i</span>
              開発者の想いとアルゴリズム
            </button>
            <button onClick={completelyResetGame} className="w-full py-5 bg-slate-800 text-white rounded-2xl font-bold text-lg hover:bg-slate-900 active:scale-[0.98] transition-all shadow-lg">最初からもう一度遊ぶ</button>
          </div>
        </div>
      </div>
    )
  }

  return null
}