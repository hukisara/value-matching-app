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
  }, [userId]) 

  useEffect(() => {
    if (!userId) return
    // 修正: チャンネル名にタイムスタンプを入れて完全にユニークにし、通信の競合や切断バグを防ぐ
    const channel = supabase
      .channel(`sync-${userId}-${Date.now()}`)
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
    const text = `価値観マッチングに参加しよう！\nURL: ${inviteUrl}\nパスコード: 【 ${roomCode} 】`
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
    // 修正: ボタンを押した瞬間にローカルの画面を切り替える（爆速UX）
    setRooms(prev => prev.map(r => r.id === currentRoom.id ? { ...r, status: 'playing' } : r))
    await supabase.from('rooms').update({ status: 'playing' }).eq('id', currentRoom.id)
  }, [currentRoom])

  const handleAnswer = useCallback(async (value: number) => {
    const newAnswers = [...localAnswers, value]
    setLocalAnswers(newAnswers)
    if (newAnswers.length < QUESTIONS.length) {
      setCurrentQIdx((idx) => idx + 1)
      if (me) {
        // ローカルの状態を瞬時に更新
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

  const triggerCalculation = useCallback(async () => {
    if (!currentRoom) return
    // 修正: 計算開始もローカルで即座に反映させる
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

    let allPairs = [];
    for (let i = 0; i < finishedPlayers.length; i++) {
      for (let j = i + 1; j < finishedPlayers.length; j++) {
        const p1 = finishedPlayers[i]; const p2 = finishedPlayers[j];
        let dotProduct = 0; let normA = 0; let normB = 0;
        for (let k = 0; k < QUESTIONS.length; k++) {
          const a1 = (p1.answers as number[])[k]; const a2 = (p2.answers as number[])[k];
          dotProduct += a1 * a2; normA += a1 ** 2; normB += a2 ** 2;
        }
        const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        const percent = Math.round(((similarity + 1) / 2) * 100);
        allPairs.push({ p1, p2, percent });
      }
    }

    return { ...res, groupRules, groupWeaknesses, allPairs };
  }, [roomParticipants]);

  const generate2DMapData = useCallback((parts: Participant[]) => {
    const weights = [
      { x: 1, y: 0 },    
      { x: 0, y: -1 },   
      { x: 1, y: 0 },    
      { x: 0, y: 1 },    
      { x: -1, y: 1 },   
      { x: 1, y: -1 },   
      { x: 1, y: 0 },    
      { x: -1, y: 1 },   
    ];

    let maxAbs = 0.1; 
    const finishedParts = parts.filter(p => p.is_finished && Array.isArray(p.answers) && p.answers.length === QUESTIONS.length);
    
    let mapped = finishedParts.map(p => {
      let x = 0; let y = 0;
      (p.answers as number[]).forEach((ans, i) => {
        x += ans * weights[i].x;
        y += weights[i].y ? ans * weights[i].y : 0;
      });
      maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));

      let title = "";
      if (x > 0 && y > 0) title = "論理的イノベーター";
      else if (x > 0 && y <= 0) title = "情熱的チャレンジャー";
      else if (x <= 0 && y > 0) title = "堅実なる守護者";
      else title = "心優しきバランサー";

      const distance = Math.sqrt(x*x + y*y);
      if (distance > 3) title = `絶対的・${title}`;
      else if (distance < 1) title = `マイルドな${title}`;

      return { id: p.id, name: p.name, x, y, title, isMe: p.user_id === userId, labelOffsetY: 18 };
    });

    mapped = mapped.map(p => ({
      ...p,
      nx: (p.x / maxAbs) * 100 + (Math.random() - 0.5) * 8, 
      ny: (p.y / maxAbs) * 100 + (Math.random() - 0.5) * 8
    }));

    for (let iter = 0; iter < 30; iter++) {
      for (let i = 0; i < mapped.length; i++) {
        for (let j = i + 1; j < mapped.length; j++) {
          const dx = mapped[i].nx - mapped[j].nx;
          const dy = mapped[i].ny - mapped[j].ny;
          let dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist === 0) {
            mapped[i].nx += 1;
            dist = 1;
          }
          
          const minDist = 20;
          if (dist < minDist) {
            const force = (minDist - dist) / dist * 0.4;
            mapped[i].nx += dx * force;
            mapped[i].ny += dy * force;
            mapped[j].nx -= dx * force;
            mapped[j].ny -= dy * force;
          }
        }
      }
    }

    mapped.forEach(p => {
      p.nx = Math.max(-85, Math.min(85, p.nx));
      p.ny = Math.max(-85, Math.min(85, p.ny));
    });

    return mapped;
  }, [userId]);

  if (!userId || isRestoring) return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center gap-5">
      <div className="relative flex justify-center items-center">
        <div className="w-12 h-12 border-4 border-indigo-100 rounded-full"></div>
        <div className="w-12 h-12 border-4 border-indigo-500 rounded-full border-t-transparent animate-spin absolute"></div>
      </div>
      <p className="text-sm font-bold text-slate-400 tracking-wider">データを読み込んでいます...</p>
    </div>
  )

  const ResetButton = () => (
    <div className="mt-12 text-center pb-6">
      <button onClick={completelyResetGame} className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors bg-white px-4 py-2 rounded-full shadow-sm border border-slate-100">
        最初からやり直す（退出）
      </button>
    </div>
  )

  const DeveloperCredit = () => (
    <div className="text-center mt-10 flex flex-col items-center gap-5 pb-8">
      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={() => setShowMethodology(true)} className="text-sm font-bold text-slate-400 hover:text-indigo-500 transition-colors flex items-center justify-center gap-2">
          <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-xs text-white">i</span>
          開発者の想い
        </button>
        <button onClick={() => setShowAlgorithm(true)} className="text-sm font-bold text-slate-400 hover:text-indigo-500 transition-colors flex items-center justify-center gap-2">
          <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-xs text-white">⚙️</span>
          アルゴリズムと理論
        </button>
      </div>
      <div className="flex items-center justify-center gap-2 mt-2 opacity-70 hover:opacity-100 transition-opacity">
        <div className="w-5 h-5 rounded-full overflow-hidden shadow-sm border border-slate-200">
          <img src="/icon-dt.png" alt="D.T." className="w-full h-full object-cover" />
        </div>
        <p className="text-[10px] font-black text-slate-500 tracking-[0.2em] uppercase">
          Algorithm by D.T.
        </p>
      </div>
    </div>
  )

  const MethodologyModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-[2rem] max-w-lg w-full relative my-8 p-6 sm:p-8 shadow-2xl">
        <button onClick={() => setShowMethodology(false)} className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition-colors">✕</button>
        
        <div className="text-center mb-8 mt-2">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full border-4 border-white shadow-lg overflow-hidden bg-slate-100">
             <img src="/icon-dt.png" alt="Developer" className="w-full h-full object-cover"/>
          </div>
          <h3 className="text-2xl font-black text-slate-800 tracking-tight">開発者の想い</h3>
          <p className="text-xs font-bold text-slate-400 mt-2 tracking-widest uppercase">By D.T.</p>
        </div>

        <div className="space-y-6 text-sm text-slate-600 leading-relaxed max-h-[50vh] overflow-y-auto pr-3">
          <div className="space-y-4">
            <p>友人同士の集まりや新しいチームで、「なんとなく気が合う」「なんだか合わない」と感じることってありませんか？これを言語化しようと思い、心理学や統計学で分析するアプリを作りました。</p>
            <p>「価値観が違う＝相性が悪い」とネガティブに捉えられがちですが、実は違うと思うんです。</p>
            <p>自分とは真逆の考えを持つ人は、自分にない視点を提供してくれる<strong className="text-indigo-600">最高のパートナー</strong>になる可能性を秘めています。</p>
            <p>みんなの違いを「優劣」ではなく「面白さ」として可視化できたら、もっと会話が弾むんじゃないか。そんな想いでこのアプリを開発しました。</p>
          </div>
        </div>
      </div>
    </div>
  )

  const AlgorithmModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-[2rem] max-w-lg w-full relative my-8 p-6 sm:p-8 shadow-2xl">
        <button onClick={() => setShowAlgorithm(false)} className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition-colors">✕</button>
        
        <div className="text-center mb-8 mt-2">
          <h3 className="text-2xl font-black text-slate-800 tracking-tight">アルゴリズムと理論</h3>
        </div>

        <div className="space-y-6 text-sm text-slate-600 leading-relaxed max-h-[60vh] overflow-y-auto pr-3">
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
            <h4 className="font-bold text-slate-800 mb-5 flex items-center gap-2 border-b border-slate-200 pb-4">
              <span className="text-xl">💡</span> 心理学とアルゴリズムの裏側
            </h4>
            <ul className="space-y-6">
              <li>
                <strong className="text-indigo-600 block mb-1">ビッグファイブ理論</strong>
                心理学において最も信頼性が高いとされる性格分析理論です。「開放性・誠実性・外向性・協調性・神経症的傾向」の5つの次元から、人間の性格を科学的に浮き彫りにします。
              </li>
              <li>
                <strong className="text-rose-500 block mb-1">ゴットマンのコンフリクト理論</strong>
                夫婦やカップルの破局を予測する研究で知られる理論です。喧嘩の「原因」ではなく、「解決スタイル（その場で話し合うか、時間を置くか）」が一致しているかが、関係の長続きには重要とされています。
              </li>
              <li>
                <strong className="text-slate-800 block mb-1">多次元ベクトルとコサイン類似度</strong>
                単なる「一致数」ではなく、全員の回答を多次元空間のベクトル（矢印）に見立て、その向きの近さを「コサイン類似度」という計算式で弾き出しています。
              </li>
              <li>
                <strong className="text-amber-500 block mb-1">相互補完性と独自性</strong>
                考え方が一番かけ離れているペアはお互いの弱点を補い合える「最強の相互補完ペア」に。また、グループ全員の平均値から一番遠い回答をした人は「独自路線を行く人」として評価します。
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )

  if (currentView === 'NAME_INPUT') return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col justify-center py-8 px-4">
      <div className="max-w-md w-full mx-auto relative mt-4">
        <div className="mb-12 text-center">
          <p className="text-slate-400 font-bold tracking-[0.2em] text-xs mb-3 uppercase">
            Psychology & Math
          </p>
          <h1 className="text-4xl md:text-5xl font-black mb-6 tracking-tight text-slate-900">
            価値観マッチング
          </h1>
          
          <div className="text-slate-600 text-sm leading-relaxed max-w-sm mx-auto font-medium">
            <p className="mb-2">たった8つの質問に直感で答えるだけ。</p>
            <p>
              グループ内で最も価値観が近い相手や、<br/>
              自分にない視点をもたらす<strong className="text-slate-900">「最高のパートナー」</strong>を見つけ出します。
            </p>
            <p className="mt-5 text-[10px] font-black text-slate-400 tracking-widest uppercase border border-slate-200 rounded-full px-3 py-1 inline-block">
              飲み会やチームの話題作りに
            </p>
          </div>
        </div>

        <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-xl shadow-slate-200/40 border border-slate-100 mb-8">
          {errorMsg && <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl mb-6 text-sm font-bold text-center border border-rose-100">{errorMsg}</div>}
          <div className="mb-8 text-center">
            <label className="block text-sm font-bold text-slate-700 mb-3">ニックネームを入力して開始</label>
            <input type="text" placeholder="例：アキラ" value={userName} onChange={(e) => setUserName(e.target.value)}
              className="w-full p-4 rounded-2xl bg-slate-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all text-lg font-bold text-center border border-slate-100" maxLength={10} />
          </div>
          <button onClick={handleNextToRoomSelect} className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-lg hover:bg-indigo-700 active:scale-[0.98] transition-all shadow-md shadow-indigo-200">
            次へ進む
          </button>
        </div>

        <DeveloperCredit />
      </div>
      {showMethodology && <MethodologyModal />}
      {showAlgorithm && <AlgorithmModal />}
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
              <label className="block text-sm font-bold text-slate-700 mb-3 ml-1">新しく始める（幹事用）</label>
              <button onClick={handleCreateRoom} className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-lg hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-200 active:scale-[0.98] transition-all">新しくルームを作る</button>
            </div>
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
              <div className="relative flex justify-center"><span className="px-4 bg-white text-xs font-bold tracking-widest text-slate-400 uppercase">OR</span></div>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-3 ml-1">招待されたルームに参加</label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input type="text" placeholder="4桁のパスコード" value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value)}
                  className="flex-1 p-4 rounded-2xl bg-slate-50 text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono text-slate-700" maxLength={4} />
                <button onClick={handleJoinRoom} className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-slate-800 text-white font-bold hover:bg-slate-900 hover:shadow-lg active:scale-[0.98] transition-all">参加する</button>
              </div>
            </div>
          </div>
        </div>
        <DeveloperCredit />
      </div>
      {showMethodology && <MethodologyModal />}
      {showAlgorithm && <AlgorithmModal />}
    </div>
  )

  if (currentView === 'LOBBY') return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col py-8 px-4 relative">
      <div className="max-w-md w-full mx-auto flex flex-col items-center flex-grow justify-center">
        <span className="text-sm font-bold text-slate-400 mb-2 tracking-widest uppercase">Room PIN</span>
        <div className="text-6xl sm:text-7xl font-black tracking-widest text-indigo-600 mb-6 font-mono drop-shadow-sm">{roomCode}</div>
        
        <div className="mb-10 w-full text-center">
          <button onClick={copyInviteText} className="inline-flex items-center gap-2 bg-white text-slate-600 font-bold py-3 px-6 rounded-full shadow-sm border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-all text-sm active:scale-95">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            招待テキストとURLをコピー
          </button>
          {copySuccess && <p className="text-xs text-emerald-500 font-bold mt-3 animate-pulse">{copySuccess}</p>}
        </div>
        
        <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-xl shadow-slate-200/50 border border-slate-100 w-full mb-8">
          <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-4">
            <h3 className="text-base font-bold text-slate-800">参加メンバー</h3>
            <span className="bg-indigo-50 text-indigo-600 text-sm font-bold px-3 py-1 rounded-full">{roomParticipants.length} 人</span>
          </div>
          <ul className="space-y-3 mb-2">
            {roomParticipants.map((p) => (
              <li key={p.id} className="flex items-center text-slate-700 font-bold p-3 bg-slate-50 rounded-2xl">
                {p.user_id === userId ? (
                  <div className="w-6 h-6 rounded-full border-2 border-white shadow-sm overflow-hidden bg-slate-100 mr-3 relative">
                     <img src="/icon-dt.png" alt="Me" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-3 shadow-sm mx-1.5" />
                )}
                {p.name}
                {p.user_id === userId && <span className="ml-auto text-[10px] font-black text-indigo-600 bg-indigo-100 px-2 py-1 rounded-md uppercase tracking-wider">You</span>}
              </li>
            ))}
          </ul>
          <button onClick={addDummyUsers} className="w-full py-4 mt-6 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 text-sm font-bold hover:bg-slate-50 hover:text-indigo-500 hover:border-indigo-200 transition-colors">+ テスト用メンバーを追加</button>
        </div>
        
        <button onClick={startGame} disabled={roomParticipants.length < 2}
          className={`w-full py-5 rounded-2xl font-bold text-lg transition-all active:scale-[0.98] ${roomParticipants.length < 2 ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-200'}`}>
          {roomParticipants.length < 2 ? '2人以上で開始できます' : '全員揃ったらスタート'}
        </button>
        <p className="text-xs font-bold text-slate-400 mt-3">※参加者なら誰でもスタートボタンを押せます</p>
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
              <span className="inline-block bg-white text-slate-800 border border-slate-200 text-sm font-bold px-4 py-1.5 rounded-full shadow-sm">{q.dim}</span>
            </div>
            <div className="w-full md:w-1/3 bg-slate-200 rounded-full h-2 overflow-hidden">
              <div className="bg-slate-800 h-full transition-all duration-500 ease-out" style={{ width: `${(currentQIdx / QUESTIONS.length) * 100}%` }} />
            </div>
          </div>
          <div className="bg-white rounded-[2rem] p-8 sm:p-10 shadow-xl shadow-slate-200/50 border border-slate-100 mb-8 min-h-[200px] flex items-center justify-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-slate-800" />
            <h2 className="text-2xl md:text-3xl font-bold text-slate-800 leading-relaxed text-center">{q.text}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button onClick={() => handleAnswer(1)} className="p-6 rounded-[1.5rem] bg-white border border-slate-200 text-xl font-bold text-slate-700 hover:border-slate-800 hover:bg-slate-50 hover:text-slate-900 active:scale-95 transition-all shadow-sm">{q.a}</button>
            <button onClick={() => handleAnswer(-1)} className="p-6 rounded-[1.5rem] bg-white border border-slate-200 text-xl font-bold text-slate-700 hover:border-slate-800 hover:bg-slate-50 hover:text-slate-900 active:scale-95 transition-all shadow-sm">{q.b}</button>
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
          
          {allFinished && (
            <button onClick={triggerCalculation} className="mt-10 w-full py-5 rounded-2xl bg-indigo-600 text-white font-bold text-xl hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-200 active:scale-[0.98] transition-all">結果を解析する</button>
          )}
        </div>
        <ResetButton />
      </div>
    )
  }

  if (currentView === 'CALCULATING') return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center">
      <div className="relative w-20 h-20 mb-8 flex justify-center items-center">
        <div className="absolute inset-0 border-4 border-indigo-100 rounded-full" />
        <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin" />
      </div>
      <h2 className="text-2xl font-black text-slate-800 mb-2 tracking-widest">解析中...</h2>
      <p className="text-sm text-slate-500 font-medium">多次元ベクトル空間での距離を測定しています</p>
    </div>
  )

  if (currentView === 'RESULT') {
    const results = calculateEnhancedResults();
    if (!results) return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center">
        <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 text-center max-w-md w-full mx-4">
          <p className="mb-6 font-bold text-gray-600">計算に必要なデータが足りません。</p>
          <button onClick={completelyResetGame} className="w-full py-4 bg-slate-100 rounded-2xl font-bold text-slate-600 hover:bg-slate-200">トップに戻る</button>
        </div>
      </div>
    )

    const mapData = generate2DMapData(roomParticipants);

    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans py-10 px-4">
        {showMethodology && <MethodologyModal />}
        {showAlgorithm && <AlgorithmModal />}
        <div className="max-w-3xl w-full mx-auto pb-10">
          <div className="text-center mb-12">
            <span className="text-xs font-black text-indigo-500 tracking-[0.2em] uppercase mb-3 block">Analysis Result</span>
            <h1 className="text-4xl md:text-5xl font-black text-slate-800 tracking-tight">診断結果</h1>
          </div>
          
          <div className="space-y-10">

            {/* 1. 一番盛り上がる: ベストペア */}
            <section>
              <div className="mb-4 text-center">
                <h3 className="font-black text-slate-800 text-2xl tracking-tight">最も価値観が近い2人</h3>
                <p className="text-sm text-slate-500 mt-2 font-medium">考え方のベクトルが似ているため、一緒にいて自然体でいられる関係です。</p>
              </div>
              <div className="bg-white rounded-[2rem] p-8 md:p-10 shadow-xl shadow-slate-200/50 border border-slate-100 text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-slate-800" />
                <div className="flex items-center justify-center gap-4 mb-8 mt-2">
                  <span className="text-3xl md:text-4xl font-black text-slate-800">{results.best.p1.name.replace('(Bot)', '')}</span>
                  <span className="text-slate-300 text-3xl font-light">×</span>
                  <span className="text-3xl md:text-4xl font-black text-slate-800">{results.best.p2.name.replace('(Bot)', '')}</span>
                </div>
                <div className="inline-flex items-baseline bg-slate-50 px-8 py-4 rounded-[2rem] border border-slate-100">
                  <span className="text-sm font-black text-slate-400 mr-5 uppercase tracking-wider">MATCH</span>
                  <span className="text-6xl font-black text-slate-800 tracking-tighter">{results.best.percent}</span>
                  <span className="text-2xl font-bold text-slate-400 ml-1">%</span>
                </div>
              </div>
            </section>
            
            {/* 2. グループ内のアクセント: ワーストペア & 独自路線 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <section>
                <div className="bg-white rounded-[2rem] p-8 shadow-xl shadow-slate-200/50 border border-slate-100 h-full flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg mb-2">最も価値観が遠い2人</h3>
                    <p className="text-xs text-slate-500 font-medium mb-6 leading-relaxed">考え方が違うため、お互いの弱点をカバーし合えるチームになれる関係です。</p>
                  </div>
                  <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 text-center">
                    <div className="text-xl font-black text-slate-800 mb-3">{results.worst.p1.name.replace('(Bot)', '')} <span className="text-slate-300 font-normal mx-1">vs</span> {results.worst.p2.name.replace('(Bot)', '')}</div>
                    <div><span className="text-xs font-bold text-slate-400 mr-2">類似度</span><span className="font-black text-2xl text-slate-800">{results.worst.percent}%</span></div>
                  </div>
                </div>
              </section>
              <section>
                <div className="bg-white rounded-[2rem] p-8 shadow-xl shadow-slate-200/50 border border-slate-100 h-full flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg mb-2">最も独自路線を行く人</h3>
                    <p className="text-xs text-slate-500 font-medium mb-6 leading-relaxed">グループの平均値から最も外れた独自の感性を持つ、貴重な存在です。</p>
                  </div>
                  <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 text-center">
                    <div className="text-2xl font-black text-slate-800 mb-2">{results.minority.name.replace('(Bot)', '')}</div>
                    <div><span className="text-xs font-bold text-slate-400 mr-2">独自性スコア</span><span className="font-black text-2xl text-slate-800">{results.minority.uniquenessScore}%</span></div>
                  </div>
                </div>
              </section>
            </div>

            {/* 3. 全員が自分ごととして楽しめる: 各自のベストマッチ */}
            <section>
              <h3 className="text-lg font-black text-slate-800 border-b-2 border-slate-200 pb-3 mb-5 mt-4">参加者ごとのベストマッチ</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {results.personalBests.map((pb, i) => {
                   const personData = mapData.find(m => m.id === pb.me.id);
                   const title = personData ? personData.title : "";
                   
                   return (
                    <div key={i} className="flex flex-col p-5 bg-white rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full bg-indigo-400"></div>
                      <span className="text-[10px] font-black text-indigo-500 mb-1 ml-2">{title}</span>
                      <div className="flex justify-between items-center ml-2">
                        <div className="font-bold text-slate-700 text-sm">{pb.me.name.replace('(Bot)', '')} <span className="text-slate-400 font-medium text-xs mx-2">の相手</span> <span className="text-slate-900 text-base">{pb.partner.name.replace('(Bot)', '')}</span></div>
                        <div className="text-sm font-black text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">{pb.percent}%</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* 4. なぜそうなったのかの種明かし: 相関ネットワーク図（2Dマップ） */}
            <section className="pt-10 border-t-2 border-dashed border-slate-200">
              <div className="mb-4 text-center mt-4">
                <h3 className="font-black text-slate-800 text-2xl tracking-tight">相関ネットワーク図</h3>
                <p className="text-sm text-slate-500 mt-2 font-medium">8次元のデータを2次元に圧縮。誰と誰が繋がっているか（シンクロ率60%以上）を可視化しました。</p>
              </div>
              <div className="bg-white rounded-[2rem] p-6 shadow-xl shadow-slate-200/50 border border-slate-100 relative">
                <div className="relative w-full aspect-square max-w-md mx-auto bg-slate-50/50 rounded-xl border border-slate-200 overflow-hidden">
                  <div className="absolute top-1/2 left-0 w-full h-px bg-slate-200" />
                  <div className="absolute top-0 left-1/2 w-px h-full bg-slate-200" />
                  <div className="absolute top-1/2 left-1/2 w-full h-full border border-slate-100 rounded-full transform -translate-x-1/2 -translate-y-1/2" />
                  <div className="absolute top-1/2 left-1/2 w-1/2 h-1/2 border border-slate-100 rounded-full transform -translate-x-1/2 -translate-y-1/2" />
                  
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold text-slate-400 bg-white/80 px-2 rounded-full">規律・論理的</div>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-bold text-slate-400 bg-white/80 px-2 rounded-full">柔軟・共感的</div>
                  <div className="absolute top-1/2 left-3 -translate-y-1/2 text-[10px] font-bold text-slate-400 bg-white/80 px-2 rounded-full">保守・パッシブ</div>
                  <div className="absolute top-1/2 right-3 -translate-y-1/2 text-[10px] font-bold text-slate-400 bg-white/80 px-2 rounded-full">革新・アクティブ</div>

                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    {results.allPairs.filter(p => p.percent >= 60).map((conn, i) => {
                      const p1 = mapData.find(m => m.id === conn.p1.id);
                      const p2 = mapData.find(m => m.id === conn.p2.id);
                      if(!p1 || !p2) return null;
                      return (
                        <line 
                          key={i} 
                          x1={`${50 + p1.nx * 0.4}%`} 
                          y1={`${50 - p1.ny * 0.4}%`} 
                          x2={`${50 + p2.nx * 0.4}%`} 
                          y2={`${50 - p2.ny * 0.4}%`} 
                          stroke={conn.percent >= 80 ? "#818cf8" : "#cbd5e1"} 
                          strokeWidth={conn.percent >= 80 ? 3 : 1.5}
                          strokeDasharray={conn.percent >= 80 ? "0" : "4 4"}
                          className="transition-all duration-1000 ease-out"
                        />
                      )
                    })}
                  </svg>

                  {mapData.map(p => (
                    <div
                      key={p.id}
                      className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center transition-all duration-1000 ease-out"
                      style={{ left: `${50 + p.nx * 0.4}%`, top: `${50 - p.ny * 0.4}%` }}
                    >
                      <div className={`rounded-full border-2 shadow-sm ${p.isMe ? 'bg-indigo-500 border-white w-5 h-5 z-20 ring-2 ring-indigo-200' : 'bg-emerald-400 border-white w-4 h-4 z-10'}`} />
                      <span 
                        className={`text-[10px] font-bold mt-1 px-2 py-0.5 rounded shadow-sm whitespace-nowrap absolute border ${p.isMe ? 'bg-indigo-600 text-white border-indigo-500 z-30' : 'bg-white/95 backdrop-blur-sm text-slate-700 border-slate-200 z-20'}`}
                        style={{ top: `${p.labelOffsetY}px` }}
                      >
                        {p.name.replace('(Bot)', '')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* 5. マップからの流れ: このグループの「隠れた掟」 */}
            <section className="pt-10 border-t-2 border-dashed border-slate-200">
              <div className="mb-4 text-center mt-4">
                <h3 className="font-black text-slate-800 text-2xl tracking-tight">このグループの「隠れた掟」</h3>
                <p className="text-sm text-slate-500 mt-2 font-medium">全員の回答の偏りから、この集団の暗黙のルールと致命的な弱点をあぶり出します。</p>
              </div>
              <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-xl shadow-slate-200/50 border border-slate-100">
                {results.groupRules.length > 0 ? (
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-sm font-bold text-indigo-500 mb-3 uppercase tracking-widest flex items-center gap-2">
                        <span>📜</span> 支配的なルール
                      </h4>
                      <ul className="space-y-2">
                        {results.groupRules.map((rule, i) => (
                          <li key={i} className="text-slate-800 font-bold bg-indigo-50 px-4 py-3 rounded-xl border border-indigo-100 flex items-start gap-2">
                            <span className="text-indigo-400 mt-0.5">✔</span> {rule}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-rose-400 mb-3 uppercase tracking-widest flex items-center gap-2">
                        <span>⚠️</span> 致命的な弱点
                      </h4>
                      <ul className="space-y-2">
                        {results.groupWeaknesses.map((weak, i) => (
                          <li key={i} className="text-slate-700 font-bold bg-rose-50 px-4 py-3 rounded-xl border border-rose-100 flex items-start gap-2">
                            <span className="text-rose-400 mt-0.5">!</span> {weak}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <span className="text-4xl mb-3 block">⚖️</span>
                    <p className="text-slate-800 font-bold text-lg">究極のバランス型集団</p>
                    <p className="text-sm text-slate-500 mt-2">突出して偏ったルールがなく、多様な価値観が美しく共存している奇跡のグループです。</p>
                  </div>
                )}
              </div>
            </section>
            
            {/* 6. おまけ: 詳細なグループの回答分布 */}
            <section className="pt-10 border-t-2 border-dashed border-slate-200">
              <div className="mb-10 text-center">
                <h3 className="font-black text-slate-800 text-2xl tracking-tight">グループの回答分布</h3>
                <p className="text-sm text-slate-500 mt-2 font-medium">みんながどちらの回答を選んだかの割合データです。</p>
              </div>
              <div className="bg-white rounded-[2rem] p-6 sm:p-10 shadow-xl shadow-slate-200/50 border border-slate-100 space-y-10">
                {QUESTIONS.map((q, idx) => {
                  const stats = results.questionStats[idx]
                  return (
                    <div key={idx} className="border-b border-slate-100 pb-8 last:border-0 last:pb-0">
                      <p className="text-sm font-bold text-slate-800 mb-4 leading-relaxed">{q.text}</p>
                      
                      <div className="flex flex-col gap-2 mb-4">
                        <div className="flex justify-between items-center text-xs bg-indigo-50/50 p-2 rounded-lg">
                          <span className="w-4/5 pr-3 text-slate-700 font-medium leading-snug">{q.a}</span>
                          <span className="font-black text-indigo-600 text-sm">{stats.aPercent}%</span>
                        </div>
                        <div className="flex justify-between items-center text-xs bg-rose-50/50 p-2 rounded-lg">
                          <span className="w-4/5 pr-3 text-slate-700 font-medium leading-snug">{q.b}</span>
                          <span className="font-black text-rose-500 text-sm">{stats.bPercent}%</span>
                        </div>
                      </div>

                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
                        <div style={{ width: `${stats.aPercent}%` }} className="bg-indigo-500 h-full transition-all duration-1000" />
                        <div style={{ width: `${stats.bPercent}%` }} className="bg-rose-400 h-full transition-all duration-1000" />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

          </div>

          <div className="mt-16 flex flex-col gap-5 max-w-sm mx-auto pb-8">
            <button onClick={completelyResetGame} className="w-full py-5 bg-slate-800 text-white rounded-2xl font-bold text-lg hover:bg-slate-900 active:scale-[0.98] transition-all shadow-lg">最初からもう一度遊ぶ</button>
          </div>
        </div>
        <DeveloperCredit />
      </div>
    )
  }

  return null
}