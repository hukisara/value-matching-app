'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { QUESTIONS } from '@/lib/questions'
import { calculateResults } from '@/lib/matching'
import type { Room, Participant } from '@/types/database'

type View = 'JOIN' | 'LOBBY' | 'PLAYING' | 'WAITING' | 'CALCULATING' | 'RESULT'

export default function Home() {
  // --- Auth ---
  const [userId, setUserId] = useState<string | null>(null)

  // --- Realtime Data ---
  const [rooms, setRooms] = useState<Room[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])

  // --- Local State ---
  const [currentView, setCurrentView] = useState<View>('JOIN')
  const [roomCode, setRoomCode] = useState('')
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [userName, setUserName] = useState('')
  const [isHost, setIsHost] = useState(false)

  // --- Playing State ---
  const [currentQIdx, setCurrentQIdx] = useState(0)
  const [localAnswers, setLocalAnswers] = useState<number[]>([])

  // --- UI State ---
  const [errorMsg, setErrorMsg] = useState('')
  const [showMethodology, setShowMethodology] = useState(false)

  // =============================================
  // 1. Supabase 匿名認証
  // =============================================
  useEffect(() => {
    const initAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session?.user) {
        setUserId(session.user.id)
      } else {
        const { data, error } = await supabase.auth.signInAnonymously()
        if (error) {
          console.error('Auth error:', error)
          return
        }
        setUserId(data.user?.id ?? null)
      }
    }

    initAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  // =============================================
  // 2. Realtime Subscriptions
  // =============================================
  useEffect(() => {
    if (!userId) return

    // 初回データ取得
    const fetchInitial = async () => {
      const [roomsRes, partsRes] = await Promise.all([
        supabase.from('rooms').select('*'),
        supabase.from('participants').select('*'),
      ])
      if (roomsRes.data) setRooms(roomsRes.data)
      if (partsRes.data) setParticipants(partsRes.data)
    }
    fetchInitial()

    // Realtime チャンネル
    const channel = supabase
      .channel('app-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms' },
        (payload) => {
          setRooms((prev) => {
            if (payload.eventType === 'INSERT') {
              return [...prev, payload.new as Room]
            }
            if (payload.eventType === 'UPDATE') {
              return prev.map((r) =>
                r.id === (payload.new as Room).id ? (payload.new as Room) : r
              )
            }
            if (payload.eventType === 'DELETE') {
              return prev.filter((r) => r.id !== (payload.old as Room).id)
            }
            return prev
          })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants' },
        (payload) => {
          setParticipants((prev) => {
            if (payload.eventType === 'INSERT') {
              return [...prev, payload.new as Participant]
            }
            if (payload.eventType === 'UPDATE') {
              return prev.map((p) =>
                p.id === (payload.new as Participant).id
                  ? (payload.new as Participant)
                  : p
              )
            }
            if (payload.eventType === 'DELETE') {
              return prev.filter(
                (p) => p.id !== (payload.old as Participant).id
              )
            }
            return prev
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  // =============================================
  // 3. Derived State
  // =============================================
  const currentRoom = useMemo(
    () => rooms.find((r) => r.code === roomCode),
    [rooms, roomCode]
  )
  const roomParticipants = useMemo(
    () => participants.filter((p) => p.room_code === roomCode),
    [participants, roomCode]
  )
  const me = useMemo(
    () => roomParticipants.find((p) => p.user_id === userId),
    [roomParticipants, userId]
  )
  const allFinished = useMemo(
    () =>
      roomParticipants.length > 0 &&
      roomParticipants.every((p) => p.is_finished),
    [roomParticipants]
  )

  // =============================================
  // 4. View の自動遷移
  // =============================================
  useEffect(() => {
    if (!currentRoom) return
    if (currentRoom.status === 'playing' && currentView === 'LOBBY')
      setCurrentView('PLAYING')
    else if (
      currentRoom.status === 'calculating' &&
      (currentView === 'WAITING' || currentView === 'PLAYING')
    ) {
      setCurrentView('CALCULATING')
      setTimeout(() => setCurrentView('RESULT'), 3000)
    } else if (currentRoom.status === 'result' && currentView !== 'RESULT')
      setCurrentView('RESULT')
  }, [currentRoom?.status, currentView])

  // =============================================
  // 5. Actions
  // =============================================
  const handleCreateRoom = useCallback(async () => {
    if (!userName.trim()) {
      setErrorMsg('ニックネームを入力してください。')
      return
    }
    const code = Math.floor(1000 + Math.random() * 9000).toString()
    try {
      const { error: roomError } = await supabase
        .from('rooms')
        .insert({ code, status: 'waiting', host_id: userId! })

      if (roomError) throw roomError

      const { error: partError } = await supabase
        .from('participants')
        .insert({
          user_id: userId!,
          room_code: code,
          name: userName,
          answers: [],
          is_finished: false,
        })

      if (partError) throw partError

      setRoomCode(code)
      setIsHost(true)
      setCurrentView('LOBBY')
      setErrorMsg('')
    } catch {
      setErrorMsg('通信エラーが発生しました。')
    }
  }, [userName, userId])

  const handleJoinRoom = useCallback(async () => {
    if (!userName.trim() || !joinCodeInput.trim()) {
      setErrorMsg('ニックネームとパスコードを入力してください。')
      return
    }
    const room = rooms.find((r) => r.code === joinCodeInput)
    if (!room) {
      setErrorMsg('パスコードが間違っています。')
      return
    }
    if (room.status !== 'waiting') {
      setErrorMsg('すでに診断が始まっています。')
      return
    }

    try {
      const existing = participants.find(
        (p) => p.room_code === joinCodeInput && p.user_id === userId
      )
      if (!existing) {
        const { error } = await supabase.from('participants').insert({
          user_id: userId!,
          room_code: joinCodeInput,
          name: userName,
          answers: [],
          is_finished: false,
        })
        if (error) throw error
      }
      setRoomCode(joinCodeInput)
      setIsHost(false)
      setCurrentView('LOBBY')
      setErrorMsg('')
    } catch {
      setErrorMsg('通信エラーが発生しました。')
    }
  }, [userName, joinCodeInput, rooms, participants, userId])

  const addDummyUsers = useCallback(async () => {
    if (!currentRoom) return
    const dummyNames = ['あきら(Bot)', 'サヤカ(Bot)', 'ケンジ(Bot)']
    try {
      const dummies = dummyNames.map((name) => ({
        user_id: `dummy-${crypto.randomUUID().slice(0, 9)}`,
        room_code: currentRoom.code,
        name,
        answers: QUESTIONS.map(() => (Math.random() > 0.5 ? 1 : -1)),
        is_finished: true,
      }))
      await supabase.from('participants').insert(dummies)
    } catch (err) {
      console.error(err)
    }
  }, [currentRoom])

  const startGame = useCallback(async () => {
    if (!isHost || !currentRoom) return
    await supabase
      .from('rooms')
      .update({ status: 'playing' })
      .eq('id', currentRoom.id)
  }, [isHost, currentRoom])

  const handleAnswer = useCallback(
    async (value: number) => {
      const newAnswers = [...localAnswers, value]
      setLocalAnswers(newAnswers)

      if (newAnswers.length < QUESTIONS.length) {
        setCurrentQIdx((idx) => idx + 1)
      } else {
        setCurrentView('WAITING')
        if (me) {
          await supabase
            .from('participants')
            .update({ answers: newAnswers, is_finished: true })
            .eq('id', me.id)
        }
      }
    },
    [localAnswers, me]
  )

  const triggerCalculation = useCallback(async () => {
    if (!isHost || !currentRoom) return
    await supabase
      .from('rooms')
      .update({ status: 'calculating' })
      .eq('id', currentRoom.id)
  }, [isHost, currentRoom])

  const resetGame = useCallback(() => {
    setRoomCode('')
    setJoinCodeInput('')
    setLocalAnswers([])
    setCurrentQIdx(0)
    setIsHost(false)
    setCurrentView('JOIN')
    setShowMethodology(false)
  }, [])

  // =============================================
  // 6. UI Components
  // =============================================
  if (!userId) {
    return (
      <div className="min-h-screen bg-gray-50 flex justify-center items-center">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  // --- JOIN ---
  if (currentView === 'JOIN') {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col justify-center py-8 px-4">
        <div className="max-w-md w-full mx-auto">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              価値観マッチング
            </h1>
            <p className="text-gray-500 text-sm">
              直感で答える、理論に基づく相性診断
            </p>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
            {errorMsg && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 text-sm font-medium text-center">
                {errorMsg}
              </div>
            )}
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ニックネーム
                </label>
                <input
                  type="text"
                  placeholder="例：たろう"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full p-4 rounded-xl border-2 border-gray-200 bg-gray-50 text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-colors text-lg"
                  maxLength={10}
                />
              </div>
              <button
                onClick={handleCreateRoom}
                className="w-full py-4 rounded-xl bg-gray-900 text-white font-bold text-lg hover:bg-gray-800 active:scale-95 transition-transform"
              >
                新しくルームを作る
              </button>
              <div className="flex items-center justify-center py-2">
                <div className="h-px bg-gray-200 flex-grow" />
                <span className="text-sm font-medium text-gray-400 px-4">
                  または
                </span>
                <div className="h-px bg-gray-200 flex-grow" />
              </div>
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="4桁のパスコード"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                  className="flex-1 p-4 rounded-xl border-2 border-gray-200 bg-gray-50 text-center text-xl tracking-widest focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
                  maxLength={4}
                />
                <button
                  onClick={handleJoinRoom}
                  className="px-6 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 active:scale-95 transition-transform"
                >
                  参加する
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // --- LOBBY ---
  if (currentView === 'LOBBY') {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col justify-center py-8 px-4">
        <div className="max-w-md w-full mx-auto flex flex-col items-center">
          <span className="text-sm font-medium text-gray-500 mb-1">
            招待パスコード
          </span>
          <div className="text-5xl font-bold tracking-widest text-gray-900 mb-8 font-mono bg-white px-6 py-2 rounded-2xl shadow-sm border">
            {roomCode}
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 w-full mb-8">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
              <h3 className="text-base font-bold text-gray-800">参加メンバー</h3>
              <span className="bg-blue-100 text-blue-800 text-sm font-bold px-3 py-1 rounded-full">
                {roomParticipants.length} 人
              </span>
            </div>
            <ul className="space-y-2 mb-4">
              {roomParticipants.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center text-gray-800 font-medium p-2 bg-gray-50 rounded-lg"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 mr-3" />
                  {p.name}
                  {p.user_id === userId && (
                    <span className="ml-2 text-xs text-gray-400">
                      (あなた)
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {isHost && (
              <button
                onClick={addDummyUsers}
                className="w-full py-3 mt-4 rounded-lg border-2 border-dashed border-gray-300 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                + テスト用メンバーを追加（1人プレイ用）
              </button>
            )}
          </div>

          {isHost ? (
            <button
              onClick={startGame}
              disabled={roomParticipants.length < 2}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
                roomParticipants.length < 2
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 shadow-md'
              }`}
            >
              診断をスタート
            </button>
          ) : (
            <div className="w-full py-4 text-center text-gray-500 font-medium bg-white rounded-xl border border-gray-200 shadow-sm flex justify-center items-center gap-2">
              <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              幹事のスタートを待っています...
            </div>
          )}
        </div>
      </div>
    )
  }

  // --- PLAYING ---
  if (currentView === 'PLAYING') {
    const q = QUESTIONS[currentQIdx]
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col justify-center py-8 px-4">
        <div className="max-w-2xl w-full mx-auto">
          <div className="flex justify-between items-center mb-8">
            <span className="bg-gray-200 text-gray-700 text-xs font-bold px-3 py-1 rounded-full">
              {q.dim}
            </span>
            <span className="text-gray-500 font-medium">
              {currentQIdx + 1} / {QUESTIONS.length}
            </span>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 leading-snug mb-12 text-center">
            {q.text}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => handleAnswer(1)}
              className="p-6 rounded-2xl bg-white border-2 border-gray-200 text-xl font-bold text-gray-800 hover:border-blue-500 hover:bg-blue-50 active:scale-95 transition-all shadow-sm"
            >
              {q.a}
            </button>
            <button
              onClick={() => handleAnswer(-1)}
              className="p-6 rounded-2xl bg-white border-2 border-gray-200 text-xl font-bold text-gray-800 hover:border-pink-500 hover:bg-pink-50 active:scale-95 transition-all shadow-sm"
            >
              {q.b}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- WAITING ---
  if (currentView === 'WAITING') {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col justify-center py-8 px-4">
        <div className="max-w-md w-full mx-auto text-center">
          <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">回答完了！</h2>
          <p className="text-gray-500 mb-8">
            全員が答え終わるのを待っています...
          </p>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 text-left">
            <div className="flex justify-between items-center border-b pb-2 mb-4">
              <h3 className="text-sm font-bold text-gray-700">現在の状況</h3>
              <span className="text-blue-600 font-bold text-lg">
                {roomParticipants.filter((p) => p.is_finished).length} /{' '}
                {roomParticipants.length}
              </span>
            </div>
            <ul className="space-y-3">
              {roomParticipants.map((p) => (
                <li
                  key={p.id}
                  className="flex justify-between items-center text-sm font-medium"
                >
                  <span
                    className={
                      p.is_finished ? 'text-gray-900' : 'text-gray-400'
                    }
                  >
                    {p.name}
                  </span>
                  {p.is_finished ? (
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-bold">
                      完了
                    </span>
                  ) : (
                    <span className="text-gray-400 text-xs flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
                      考え中
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {isHost && allFinished && (
            <button
              onClick={triggerCalculation}
              className="mt-8 w-full py-4 rounded-xl bg-gray-900 text-white font-bold text-lg hover:bg-gray-800 active:scale-95 transition-transform shadow-md"
            >
              結果を見る
            </button>
          )}
        </div>
      </div>
    )
  }

  // --- CALCULATING ---
  if (currentView === 'CALCULATING') {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col justify-center py-8 px-4">
        <div className="max-w-md w-full mx-auto text-center flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin mb-6" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            相性を計算中...
          </h2>
          <p className="text-sm text-gray-500">
            価値観のベクトルを解析しています
          </p>
        </div>
      </div>
    )
  }

  // --- RESULT ---
  if (currentView === 'RESULT') {
    const results = calculateResults(roomParticipants)

    if (!results) {
      return (
        <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center">
          <p className="mb-6 text-gray-600">
            計算に必要なデータが足りません。
          </p>
          <button
            onClick={resetGame}
            className="px-6 py-3 bg-gray-200 rounded-xl font-bold text-gray-700"
          >
            トップに戻る
          </button>
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col justify-center py-8 px-4">
        {showMethodology && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-2xl max-w-lg w-full relative my-8 p-6 shadow-xl">
              <button
                onClick={() => setShowMethodology(false)}
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600"
              >
                x
              </button>
              <h3 className="text-xl font-bold mb-4 border-b pb-2">
                診断の裏側（アルゴリズム）
              </h3>
              <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
                <p>
                  この診断では、単に「同じ回答が多い」だけで相性を決めているわけではありません。
                </p>
                <p>
                  全員の回答データを多次元のベクトルに変換し、ベクトル同士の角度を測る
                  <strong>「コサイン類似度」</strong>
                  という数学的手法を用いて計算しています。
                </p>
                <div className="bg-gray-50 p-4 rounded-xl border text-center font-mono text-xs">
                  Similarity = (A . B) / (||A|| ||B||)
                </div>
                <p>
                  設問自体も、心理学の「ビッグ・ファイブ性格特性」や、パートナーシップの破局要因に関する研究データに基づいて作成されています。
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="max-w-xl w-full mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">診断結果</h1>
          </div>

          <div className="space-y-6">
            {/* Best Match */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border-2 border-blue-100 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-500" />
              <div className="text-center mb-6 mt-2">
                <span className="inline-block bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1 rounded-full mb-4">
                  最も価値観が近いペア
                </span>
                <div className="flex items-center justify-center gap-4">
                  <span className="text-2xl font-bold text-gray-900">
                    {results.best.p1.name.replace('(Bot)', '')}
                  </span>
                  <span className="text-gray-400">x</span>
                  <span className="text-2xl font-bold text-gray-900">
                    {results.best.p2.name.replace('(Bot)', '')}
                  </span>
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-6 text-center">
                <span className="text-sm font-bold text-gray-500 block mb-1">
                  相性スコア
                </span>
                <div className="flex items-baseline justify-center">
                  <span className="text-5xl font-black text-gray-900">
                    {results.best.percent}
                  </span>
                  <span className="text-xl font-bold text-gray-500 ml-1">
                    %
                  </span>
                </div>
              </div>
              <div className="mt-6">
                <p className="text-xs font-bold text-gray-500 mb-2">
                  共通している価値観
                </p>
                <div className="flex flex-wrap gap-2">
                  {results.best.reasons.length > 0 ? (
                    results.best.reasons.slice(0, 3).map((dim, i) => (
                      <span
                        key={i}
                        className="bg-gray-100 text-gray-700 text-xs font-medium px-2.5 py-1 rounded-md"
                      >
                        {dim}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-500">
                      特に強い共通点はありません
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Worst Match */}
            <div className="bg-gray-50 rounded-2xl p-6 shadow-sm border border-gray-200">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div>
                  <span className="text-xs font-bold text-gray-500 block mb-1">
                    価値観が真逆なペア
                  </span>
                  <div className="font-bold text-gray-800">
                    {results.worst.p1.name.replace('(Bot)', '')}{' '}
                    <span className="text-gray-400 font-normal mx-1">vs</span>{' '}
                    {results.worst.p2.name.replace('(Bot)', '')}
                  </div>
                </div>
                <div className="bg-white px-4 py-2 rounded-lg border font-bold text-xl text-gray-700 shadow-sm">
                  {results.worst.percent}
                  <span className="text-sm text-gray-400 ml-1">%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-3">
            <button
              onClick={resetGame}
              className="w-full py-4 bg-gray-900 text-white rounded-xl font-bold text-lg hover:bg-gray-800 active:scale-95 transition-transform"
            >
              もう一度遊ぶ
            </button>
            <button
              onClick={() => setShowMethodology(true)}
              className="w-full py-3 bg-white text-gray-600 rounded-xl font-bold text-sm border-2 border-gray-200 hover:bg-gray-50 transition-colors"
            >
              診断のアルゴリズムについて
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
