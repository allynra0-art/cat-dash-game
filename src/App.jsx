import './App.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, configured } from './supabase';

const CATS = ['orange', 'white', 'black', 'gray'];
const LABELS = { orange: 'Oren', white: 'Putih', black: 'Hitam', gray: 'Abu-abu' };

const blank = () => ({ 
  prompt: '', 
  type: 'pg', 
  options: ['', '', '', ''], 
  correct_index: 0, 
  correct_text: '' 
});
const msg = (e) => e?.message || String(e);

const formatTime = (ms) => {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const minutes = String(Math.floor(total / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((total % 60000) / 1000)).padStart(2, '0');
  const centis = String(Math.floor((total % 1000) / 10)).padStart(2, '0');
  return `${minutes}:${seconds}.${centis}`;
};

let audioCtx = null;
function getAudioCtx() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  return audioCtx;
}

function sound(type, enabled) {
  if (!enabled) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const notes = { click: [520, 680], correct: [523, 659, 784], wrong: [240, 190], finish: [523, 659, 784, 1046], start: [392, 587] }[type] || [500];
    notes.forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + i * 0.09;
      osc.type = type === 'click' || type === 'start' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(hz, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.035, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  } catch {}
}

function Cat({ cat = 'orange', action = 'idle', size = 88 }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [cat, action]);
  const src = `/assets/characters/cat_${cat}_${action}.png`;

  return failed ? (
    <span className="catMissing" style={{ width: size, height: size }} aria-label="Sprite tidak ditemukan" />
  ) : (
    <img className="cat" src={src} alt={`Kucing ${LABELS[cat]}`} width={size} height={size} style={{ width: size, height: size }} draggable="false" onError={() => setFailed(true)} />
  );
}

export default function App() {
  const [uid, setUid] = useState(null);
  const [screen, setScreen] = useState('home');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [isGuest, setIsGuest] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [authMode, setAuthMode] = useState('login'); 
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  // Sound State (BGM & SFX)
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('catdash_sound') !== 'off');
  
  // DUA REF UNTUK DUA BGM
  const menuBgmRef = useRef(null); 
  const raceBgmRef = useRef(null);

  const [name, setName] = useState(() => localStorage.getItem('catdash_name') || '');
  const [cat, setCat] = useState('orange');

  const [quizzes, setQuizzes] = useState([]);
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState([blank()]);
  const [selectedQuiz, setSelectedQuiz] = useState('');
  const [joinCode, setJoinCode] = useState('');
  
  const [aiTopic, setAiTopic] = useState('');
  const [aiLevel, setAiLevel] = useState('Sedang');
  const [aiCount, setAiCount] = useState(5);
  const [aiLoading, setAiLoading] = useState(false);

  const [botCount, setBotCount] = useState(3);
  const [timeLimit, setTimeLimit] = useState(15);
  const [localBots, setLocalBots] = useState([]);

  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);

  const [sprinting, setSprinting] = useState(false);
  const [stepHint, setStepHint] = useState('Tekan D atau klik LARI untuk berlari!');

  const [raceStartTime, setRaceStartTime] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [question, setQuestion] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [quizSeconds, setQuizSeconds] = useState(15);
  const [showResults, setShowResults] = useState(false);
  const [shortAnswerInput, setShortAnswerInput] = useState('');
  
  const [isShaking, setIsShaking] = useState(false);
  const [reviewData, setReviewData] = useState(null);

  const moveRef = useRef({ sprinting: false, sendingStep: false, pendingStep: false });
  const quizKey = useRef('');
  const finishedRef = useRef(false);
  const busyRef = useRef(false);
  const answerRef = useRef(null);
  const quizTimeoutRef = useRef(false);

  const allPlayersRaw = [...players, ...localBots];
  const rankedPlayers = [...allPlayersRaw].sort((a, b) => {
    const af = a.finished_at ? new Date(a.finished_at).getTime() : Infinity;
    const bf = b.finished_at ? new Date(b.finished_at).getTime() : Infinity;
    if (af !== bf) return af - bf;
    return Number(b.distance) - Number(a.distance);
  });

  const lanePlayers = [...allPlayersRaw].sort((a, b) => {
    if (a.user_id === uid) return 1;
    if (b.user_id === uid) return -1;
    return a.id.localeCompare(b.id);
  });

  const me = rankedPlayers.find((p) => p.user_id === uid);
  const isHost = room?.host_id === uid;
  const myEnergy = Math.max(0, Math.min(100, Number(me?.energy || 0)));
  const energyClass = myEnergy <= 0 ? 'empty' : myEnergy < 25 ? 'low' : myEnergy < 50 ? 'mid' : '';
  const myPosition = Math.max(1, rankedPlayers.findIndex((p) => p.user_id === uid) + 1);

  const fx = (type) => sound(type, soundOn);
  const rpc = async (fn, args) => {
    const { data, error: e } = await supabase.rpc(fn, args);
    if (e) throw e;
    return data;
  };

  const run = async (fn) => {
    setError(''); busyRef.current = true; setBusy(true);
    try { await fn(); } catch (e) { setError(msg(e)); } 
    finally { busyRef.current = false; setBusy(false); }
  };

  // ===== LOGIKA PEMUTAR MUSIK (BGM) =====
  useEffect(() => {
    const isRacing = screen === 'room' && room?.status === 'racing';

    // Selalu matikan (pause) kedua musik terlebih dahulu
    if (menuBgmRef.current) menuBgmRef.current.pause();
    if (raceBgmRef.current) raceBgmRef.current.pause();

    if (soundOn) {
      if (isRacing) {
        // Volume Musik Balapan
        if (raceBgmRef.current) {
          raceBgmRef.current.volume = 0.2;
          raceBgmRef.current.play().catch(() => {});
        }
      } else {
        // Volume Musik Menu
        if (menuBgmRef.current) {
          menuBgmRef.current.volume = 0.15;
          menuBgmRef.current.play().catch(() => {});
        }
      }
    }
  }, [screen, room?.status, soundOn]);

  // Listener klik pertama untuk mengizinkan autoplay BGM
  useEffect(() => {
    const handleFirstClick = () => {
      if (soundOn) {
        if (screen === 'room' && room?.status === 'racing') {
          raceBgmRef.current?.play().catch(() => {});
        } else {
          menuBgmRef.current?.play().catch(() => {});
        }
      }
      document.removeEventListener('click', handleFirstClick);
    };
    document.addEventListener('click', handleFirstClick);
    return () => document.removeEventListener('click', handleFirstClick);
  }, [soundOn, screen, room?.status]);

  const refreshQuizzes = useCallback(async () => {
    if (!supabase || !uid) return; 
    const { data, error: e } = await supabase.from('quizzes').select('id,title').eq('owner_id', uid).order('created_at', { ascending: false });
    if (e) throw e;
    setQuizzes(data || []);
  }, [uid]);

  const refreshRoom = useCallback(async (id) => {
    if (!supabase || !id) return;
    const [r, p] = await Promise.all([
      supabase.from('rooms').select('id,code,host_id,status,quiz_id,quiz_time_limit').eq('id', id).single(),
      supabase.from('room_players').select('*').eq('room_id', id).order('distance', { ascending: false }),
    ]);
    if (r.error) throw r.error;
    if (p.error) throw p.error;
    
    setRoom(r.data);
    
    setPlayers((prevPlayers) => {
      const serverPlayers = p.data || [];
      return serverPlayers.map(sp => {
        const lp = prevPlayers.find(x => x.id === sp.id);
        if (lp && lp.distance > sp.distance && !sp.finished_at) {
          return { ...sp, distance: lp.distance, energy: lp.energy, needs_quiz: lp.needs_quiz }; 
        }
        return sp;
      });
    });
  }, []);

  const advancePlayer = async () => {
    if (!room?.id || room.status !== 'racing' || !me || Number(me.energy) <= 0 || me.needs_quiz || me.finished_at || showResults) return;

    const step = moveRef.current.sprinting ? 15 : 6;
    const cost = moveRef.current.sprinting ? 35 : 20; 

    setPlayers((prev) => prev.map((p) => {
      if (p.user_id === uid) {
        const nextDist = Math.min(300, Number(p.distance) + step);
        const nextEnergy = Math.max(0, Number(p.energy) - cost);
        return { 
          ...p, distance: nextDist, energy: nextEnergy, 
          needs_quiz: nextEnergy <= 0 && nextDist < 300,
          finished_at: nextDist >= 300 ? (p.finished_at || new Date().toISOString()) : p.finished_at
        };
      }
      return p;
    }));

    if (moveRef.current.sendingStep) { moveRef.current.pendingStep = true; return; }
    moveRef.current.sendingStep = true;

    try {
      await rpc('move_cat', { p_room: room.id, p_sprint: moveRef.current.sprinting });
    } catch (e) { } finally {
      moveRef.current.sendingStep = false;
      if (moveRef.current.pendingStep) { moveRef.current.pendingStep = false; advancePlayer(); }
    }
  };

  const pressRunKey = () => {
    if (screen !== 'room' || room?.status !== 'racing' || me?.needs_quiz || me?.finished_at || showResults || Number(me?.energy) <= 0) return;
    advancePlayer();
  };

  useEffect(() => {
    if (room?.status !== 'racing' || localBots.length === 0 || showResults) return;
    const interval = setInterval(() => {
      setLocalBots((prev) => prev.map((b) => {
        if (b.finished_at) return b;
        if (b.needs_quiz) {
          if (Math.random() > 0.4) return { ...b, needs_quiz: false, energy: 100, correct_count: b.correct_count + 1 };
          return b;
        }
        const step = Math.random() * 10 + 4;
        const nextDist = Math.min(300, Number(b.distance) + step);
        const nextEnergy = Math.max(0, Number(b.energy) - (Math.random() * 20 + 15));
        return {
          ...b, distance: nextDist, energy: nextEnergy,
          needs_quiz: nextEnergy <= 0 && nextDist < 300 && Math.random() > 0.5,
          finished_at: nextDist >= 300 ? (b.finished_at || new Date().toISOString()) : b.finished_at
        };
      }));
    }, 1200);
    return () => clearInterval(interval);
  }, [room?.status, localBots.length, showResults]);

  useEffect(() => {
    if (room?.status === 'racing' && me?.finished_at) {
      setShowResults(true);
      if (!finishedRef.current) { fx('finish'); finishedRef.current = true; }
    }
  }, [me?.finished_at, room?.status, soundOn]);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUid(session.user.id); setUserEmail(session.user.email || '');
        setIsGuest(session.user.is_anonymous || false);
        if (session.user.user_metadata?.name) setName(session.user.user_metadata.name);
        refreshQuizzes(); setScreen('home');
      } else { setUid(null); setScreen('auth'); }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setUid(session.user.id); setUserEmail(session.user.email || '');
        setIsGuest(session.user.is_anonymous || false);
        if (session.user.user_metadata?.name) setName(session.user.user_metadata.name);
        refreshQuizzes(); setScreen('home');
      } else { setUid(null); setUserEmail(''); setIsGuest(false); setScreen('auth'); }
    });
    return () => subscription.unsubscribe();
  }, [refreshQuizzes]);

  const handleAuth = async (e) => {
    e.preventDefault();
    if (!emailInput || !passwordInput) return setError('Email dan Password wajib diisi.');
    return run(async () => {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: emailInput, password: passwordInput });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email: emailInput, password: passwordInput, options: { data: { name: emailInput.split('@')[0] } } });
        if (error) throw error;
        if (data.session === null) {
          setFeedback('Pendaftaran berhasil! Silakan cek email verifikasi.'); setAuthMode('login'); setEmailInput(''); setPasswordInput('');
        } else { setFeedback('Pendaftaran berhasil!'); }
      }
      fx('correct');
    });
  };

  const handleGuest = () => run(async () => {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error; fx('click');
  });

  const handleLogout = () => run(async () => { await supabase.auth.signOut(); home(); fx('click'); });

  useEffect(() => {
    if (!room?.id || !supabase) return;
    const id = room.id; let active = true;
    const channel = supabase.channel(`catdash-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${id}` }, () => active && refreshRoom(id).catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${id}` }, () => active && refreshRoom(id).catch(() => {}))
      .subscribe();
    const timer = setInterval(() => active && refreshRoom(id).catch(() => {}), 1800);
    return () => { active = false; clearInterval(timer); supabase.removeChannel(channel); };
  }, [room?.id, refreshRoom]);

  useEffect(() => {
    if (!room || !me?.needs_quiz || room.status !== 'racing' || showResults) { setQuestion(null); quizKey.current = ''; return; }
    const key = `${room.id}-${me.correct_count}-${me.wrong_count}`;
    if (quizKey.current === key) return;
    quizKey.current = key;

    rpc('current_game_question', { p_room: room.id })
      .then((q) => {
        if (q && q.prompt && Array.isArray(q.options)) setQuestion(q);
        else setQuestion({ number: 1, type: 'pg', prompt: "Soal tidak ditemukan. Berapakah 5 + 5?", options: ["8", "9", "10", "11"] });
      })
      .catch((e) => { setError(msg(e)); setQuestion({ number: 1, type: 'pg', prompt: "Gagal memuat. Berapakah 2 x 3?", options: ["4", "5", "6", "7"] }); });
  }, [room?.id, room?.status, me?.needs_quiz, me?.correct_count, me?.wrong_count, showResults]);

  useEffect(() => {
    if (room?.status !== 'racing') { setRaceStartTime(null); setElapsedMs(0); return; }
    setRaceStartTime((old) => old ?? Date.now());
  }, [room?.status]);

  useEffect(() => {
    if (!raceStartTime || room?.status !== 'racing' || showResults) return;
    const tick = () => setElapsedMs(Date.now() - raceStartTime);
    tick(); const id = setInterval(tick, 37); return () => clearInterval(id);
  }, [raceStartTime, room?.status, showResults]);

  useEffect(() => {
    if (!(room?.status === 'racing' && me?.needs_quiz && question && !showResults)) { 
      setQuizSeconds(room?.quiz_time_limit || 15); 
      quizTimeoutRef.current = false; 
      return; 
    }
    setQuizSeconds(room?.quiz_time_limit || 15); 
    quizTimeoutRef.current = false;
    const id = setInterval(() => setQuizSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [room?.status, me?.needs_quiz, question?.number, showResults, room?.quiz_time_limit]);

  useEffect(() => {
    if (quizSeconds === 0 && question && !quizTimeoutRef.current && !busyRef.current && !showResults) {
      quizTimeoutRef.current = true;
      answerRef.current?.("WAKTU_HABIS");
    }
  }, [quizSeconds, question, showResults]);

  useEffect(() => {
    const down = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      if (['d', 'arrowright', 'shift'].includes(k)) e.preventDefault();
      if (screen !== 'room' || room?.status !== 'racing' || showResults) return;
      if ((k === 'd' || k === 'arrowright') && !e.repeat) pressRunKey();
      if (k === 'shift' && !moveRef.current.sprinting) { moveRef.current.sprinting = true; setSprinting(true); }
    };
    const up = (e) => { if (e.key.toLowerCase() === 'shift') { moveRef.current.sprinting = false; setSprinting(false); } };
    const stop = () => { moveRef.current.sprinting = false; setSprinting(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', stop);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', stop); };
  }, [screen, room?.status, room?.id, me?.needs_quiz, me?.finished_at, showResults, me?.energy]);

  const enterRoom = async (id) => {
    await refreshRoom(id); setStepHint('Tekan D atau klik LARI untuk berlari!');
    setScreen('room'); setFeedback('');
  };

  const generateAIQuiz = async () => {
    if (!aiTopic.trim()) return setError("Ketik topik kuis terlebih dahulu.");
    setAiLoading(true); setError('');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        signal: controller.signal,
        body: JSON.stringify({ topic: aiTopic, level: aiLevel, count: aiCount }),
      });
      clearTimeout(timeoutId);
      const responseText = await response.text();
      if (!response.ok) throw new Error(responseText || `HTTP error! status: ${response.status}`);
      const data = JSON.parse(responseText);
      if (data && data.questions && data.questions.length > 0) {
        const formattedQuestions = data.questions.map(q => ({ ...blank(), prompt: q.prompt, type: 'pg', options: q.options, correct_index: q.correct_index }));
        setQuestions(formattedQuestions);
        if (!title) setTitle(`Kuis AI: ${aiTopic} (${aiLevel})`);
        fx('correct'); setFeedback('Kuis AI berhasil dibuat!');
      } else { throw new Error("AI tidak mengembalikan soal yang valid."); }
    } catch (err) {
      const errMsg = err.name === 'AbortError' ? 'Waktu habis, server terlalu lambat. Coba lagi.' : err.message;
      setError(`Gagal AI: ${errMsg}`);
    } finally { setAiLoading(false); }
  };

  const saveQuiz = () => run(async () => {
    if (!title.trim()) throw Error('Isi judul kuis.');
    if (!questions.length || questions.length > 50) throw Error('Jumlah soal 1-50.');
    questions.forEach((q, i) => { 
      if (!q.prompt.trim()) throw Error(`Soal nomor ${i + 1} belum ada pertanyaannya.`);
      if (q.type === 'isian' && !q.correct_text.trim()) throw Error(`Kunci jawaban isian untuk soal nomor ${i + 1} belum diisi.`);
      else if (q.type !== 'isian' && q.options.some((o) => !o.trim())) throw Error(`Lengkapi semua pilihan ganda soal nomor ${i + 1}.`);
    });

    const { data, error: e } = await supabase.from('quizzes').insert({ owner_id: uid, title: title.trim() }).select('id').single();
    if (e) throw e;

    const { error: qe } = await supabase.from('quiz_questions').insert(questions.map((q, i) => {
      let finalOptions = q.options;
      if (q.type === 'isian') finalOptions = [q.correct_text];
      if (q.type === 'tf') finalOptions = ['Benar', 'Salah'];
      return { quiz_id: data.id, position: i, prompt: q.prompt.trim(), type: q.type, options: finalOptions.map((o) => o.trim()), correct_index: Number(q.correct_index) };
    }));
    
    if (qe) { await supabase.from('quizzes').delete().eq('id', data.id); throw qe; }
    await refreshQuizzes(); setSelectedQuiz(data.id); setTitle(''); setQuestions([blank()]); setScreen('host');
    setFeedback('Kuis tersimpan!'); fx('correct');
  });

  const makeRoom = () => run(async () => {
    if (!uid || !name.trim() || !selectedQuiz) throw Error('Lengkapi nama dan pilih kuis.');
    localStorage.setItem('catdash_name', name.trim());
    const code = await rpc('create_game_room', { p_quiz: selectedQuiz, p_name: name.trim(), p_cat: cat, p_time_limit: timeLimit });
    const { data, error: e } = await supabase.from('rooms').select('id').eq('code', code).single();
    if (e) throw e;
    await enterRoom(data.id); fx('start');
  });

  const joinRoom = () => run(async () => {
    if (!uid || !name.trim()) throw Error('Isi nama pemain.');
    if (!/^\d{6}$/.test(joinCode.trim())) throw Error('Kode room 6 digit.');
    localStorage.setItem('catdash_name', name.trim());
    const id = await rpc('join_game_room', { p_code: joinCode.trim(), p_name: name.trim(), p_cat: cat });
    await enterRoom(id); fx('click');
  });

  const startGame = () => run(async () => {
    await rpc('start_game_room', { p_room: room.id });
    if (botCount > 0) {
      const newBots = Array.from({ length: botCount }).map((_, i) => ({
        id: `bot-${i}`, user_id: `bot-${i}`, nickname: `Bot ${LABELS[CATS[i % 4]]}`,
        cat: CATS[i % 4], distance: 0, energy: 100, needs_quiz: false, correct_count: 0, wrong_count: 0, finished_at: null,
      }));
      setLocalBots(newBots);
    }
    await refreshRoom(room.id); fx('start');
  });

  const answer = (val) => {
    if (busyRef.current) return;
    setShortAnswerInput('');
    
    return run(async () => {
      try {
        const ok = await rpc('answer_game_question', { p_room: room.id, p_answer: String(val) });
        if (ok) {
          setFeedback('BENAR! Energi Penuh!'); fx('correct');
          setQuestion(null); quizKey.current = '';
          setPlayers(prev => prev.map(p => p.user_id === uid ? { ...p, needs_quiz: false, energy: 100, correct_count: p.correct_count + 1 } : p));
        } else {
          setIsShaking(true);
          setTimeout(() => setIsShaking(false), 500);

          setFeedback(val === "WAKTU_HABIS" ? 'WAKTU HABIS! Jawaban salah.' : 'SALAH! Coba soal baru.'); 
          fx('wrong');
          setQuestion(null); quizKey.current = ''; 
          setPlayers(prev => prev.map(p => p.user_id === uid ? { ...p, needs_quiz: true, energy: 0, wrong_count: p.wrong_count + 1 } : p));
        }
        await refreshRoom(room.id);
      } catch (e) { setFeedback('Terjadi kesalahan sistem.'); setError(msg(e)); }
    });
  };
  answerRef.current = answer;

  const handleSubmitShortAnswer = (e) => {
    e.preventDefault();
    if (!shortAnswerInput.trim()) return;
    answer(shortAnswerInput.trim());
  };

  const setQ = (i, field, value, option) => setQuestions((old) => old.map((q, j) => {
    if (i !== j) return q;
    return option === undefined ? { ...q, [field]: value } : { ...q, options: q.options.map((v, k) => (k === option ? value : v)) };
  }));

  const openReview = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.from('quiz_questions').select('*').eq('quiz_id', room.quiz_id).order('position');
      if (error) throw error;
      setReviewData(data);
      setScreen('review');
    } catch (e) { setError(msg(e)); } 
    finally { setBusy(false); }
  };

  const toggleSound = () => {
    setSoundOn((old) => { 
      localStorage.setItem('catdash_sound', old ? 'off' : 'on'); 
      return !old; 
    });
  };
  
  const home = () => {
    moveRef.current = { sprinting: false, sendingStep: false, pendingStep: false };
    setRoom(null); setPlayers([]); setLocalBots([]); setQuestion(null); setScreen('home'); setFeedback('');
    setShowResults(false); finishedRef.current = false; setShortAnswerInput(''); setReviewData(null);
  };

  if (!configured) return <main className="wrap"><section className="panel"><h1>CAT DASH</h1><h2>Hubungkan Supabase dulu</h2></section></main>;

  return (
    <main className={`wrap ${isShaking ? 'shake' : ''}`}>
      {/* ===== DUA AUDIO ELEMENT (MENU & RACE) ===== */}
      <audio 
        ref={menuBgmRef} 
        src="/audio/bgm_menu.mp3" 
        loop 
        onError={(e) => { 
          if(e.target.src.indexOf('pixabay') === -1) {
            e.target.src = "https://cdn.pixabay.com/audio/2022/03/15/audio_27dbd9d363.mp3"; // Fallback menu
            if(soundOn) e.target.play().catch(()=>{});
          }
        }} 
      />
      <audio 
        ref={raceBgmRef} 
        src="/audio/bgm_race.mp3" 
        loop 
        onError={(e) => { 
          if(e.target.src.indexOf('pixabay') === -1) {
            e.target.src = "https://cdn.pixabay.com/audio/2021/09/30/audio_3b01e7a2b6.mp3"; // Fallback race
            if(soundOn) e.target.play().catch(()=>{});
          }
        }} 
      />

      <header>
        <div><span className="brand">🐾 CAT DASH</span><small>MULTIPLAYER QUIZ RACE</small></div>
        <div className="headerRight">
          {uid ? (
            <>
              <span className="status" style={{ color: 'var(--text-dark)', fontWeight: 900 }}>
                {isGuest ? '👤 Tamu' : `👤 ${userEmail.split('@')[0]}`}
              </span>
              <button className="ghost soundButton" onClick={toggleSound}>{soundOn ? '🔊' : '🔇'}</button>
              {screen !== 'home' && screen !== 'review' && (
                <button className="ghost" onClick={home} style={{ fontWeight: 'bold' }}>MENU</button>
              )}
              <button className="ghost" onClick={handleLogout}>KELUAR</button>
            </>
          ) : (
             <span className="status">○ BELUM LOGIN</span>
          )}
        </div>
      </header>

      {error && <div className="alert">⚠ {error}<button onClick={() => setError('')}>×</button></div>}
      {feedback && <div className="notice" onClick={() => setFeedback('')}>{feedback} ×</div>}

      {/* ====== SCREEN AUTH ====== */}
      {screen === 'auth' && (
        <section className="panel center hero" style={{ maxWidth: '500px', margin: '0 auto' }}>
          <h1>CAT DASH</h1>
          <p className="hero-desc">Masuk untuk menyimpan progres dan bertanding dengan teman-temanmu.</p>
          <div className="questionEditor" style={{ marginTop: '20px', textAlign: 'left' }}>
            <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>{authMode === 'login' ? 'Masuk Akun' : 'Daftar Akun Baru'}</h2>
            <form onSubmit={handleAuth}>
              <label>Email<input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="kamu@email.com" required /></label>
              <label>Password<input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="••••••••" required /></label>
              <button type="submit" disabled={busy} style={{ width: '100%', marginTop: '15px' }}>{busy ? 'MEMPROSES...' : authMode === 'login' ? 'MASUK' : 'DAFTAR SEKARANG'}</button>
            </form>
            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <button className="linkBtn" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? 'Belum punya akun? Daftar di sini' : 'Sudah punya akun? Masuk di sini'}</button>
            </div>
          </div>
          <div className="actions" style={{ justifyContent: 'center', marginTop: '20px' }}>
            <button className="secondary" onClick={handleGuest} disabled={busy}>🎮 MAIN SEBAGAI TAMU</button>
          </div>
        </section>
      )}

      {/* ====== SCREEN HOME ====== */}
      {screen === 'home' && (
        <section className="panel center hero">
          <h1>CAT DASH</h1>
          <p className="hero-desc">Siap membuktikan siapa raja jalanan (atau jalur lari kucing) yang paling cerdas dan gesit? Cat Dash adalah game balap kucing multiplayer yang menggabungkan kecepatan jari dan ketajaman otak!</p>
          <div className="heroCats">{CATS.map((c) => <Cat key={c} cat={c} size={90} />)}</div>
          <div className="actions">
            <button onClick={() => { setScreen('create'); fx('click'); }}>✎ BUAT KUIS</button>
            <button onClick={() => { refreshQuizzes().catch((e) => setError(msg(e))); setScreen('host'); fx('click'); }}>📚 MAIN BERSAMA</button>
            <button onClick={() => { setScreen('join'); fx('click'); }}>⌨ GABUNG ROOM</button>
          </div>
        </section>
      )}

      {/* ====== SCREEN CREATE ====== */}
      {screen === 'create' && (
        <section className="panel">
          <h2>✎ Buat Kuis Sendiri</h2>
          <div className="questionEditor" style={{ background: 'var(--bg-almond)', borderColor: 'var(--pink-soft)' }}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>✨ Buat Kuis Otomatis dengan AI</h3>
            <p className="muted" style={{ fontSize: '14px' }}>Ketik topik, dan biarkan sistem membuatkan soalnya untukmu.</p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input style={{ flex: 2, minWidth: '200px' }} value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} placeholder="Topik (misal: Tata Surya, Sejarah)" />
              <select style={{ flex: 1, minWidth: '120px' }} value={aiLevel} onChange={(e) => setAiLevel(e.target.value)}>
                <option value="Mudah">Mudah</option><option value="Sedang">Sedang</option><option value="Sulit">Sulit</option>
              </select>
              <select style={{ flex: 1, minWidth: '100px' }} value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))}>
                <option value={3}>3 Soal</option><option value={5}>5 Soal</option><option value={10}>10 Soal</option>
              </select>
              <button onClick={generateAIQuiz} disabled={aiLoading} style={{ flex: 1, background: 'linear-gradient(180deg, #a3d9a5, var(--green-moss))', color: '#fff', boxShadow: '0 4px 0 #2d3f22' }}>{aiLoading ? 'MEMBUAT...' : '✨ GENERATE'}</button>
            </div>
          </div>

          <label>Judul kuis<input maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Misalnya: IPA Kelas 7" /></label>
          {questions.map((q, i) => (
            <div className="questionEditor" key={i}>
              <div className="between">
                <b>SOAL {i + 1}</b>
                <div>
                  <select value={q.type} onChange={(e) => setQ(i, 'type', e.target.value)} style={{ padding: '5px', marginRight: '10px', borderRadius: '8px' }}>
                    <option value="pg">Pilihan Ganda (4 Opsi)</option><option value="tf">Benar / Salah</option><option value="isian">Isian Singkat</option>
                  </select>
                  <button className="ghost danger" disabled={questions.length === 1} onClick={() => setQuestions((v) => v.filter((_, j) => j !== i))}>HAPUS</button>
                </div>
              </div>
              <textarea rows={2} value={q.prompt} onChange={(e) => setQ(i, 'prompt', e.target.value)} placeholder="Tulis pertanyaan..." />
              {q.type === 'pg' && (
                <div className="options">
                  {q.options.map((v, j) => (
                    <label className="optionEdit" key={j}>
                      <span>{'ABCD'[j]}</span>
                      <input value={v} onChange={(e) => setQ(i, 'options', e.target.value, j)} placeholder={`Pilihan ${'ABCD'[j]}`} />
                      <input type="radio" name={`correct-${i}`} checked={Number(q.correct_index) === j} onChange={() => setQ(i, 'correct_index', j)} />
                    </label>
                  ))}
                </div>
              )}
              {q.type === 'tf' && (
                <div className="options">
                  <label className="optionEdit"><span>Benar</span><input type="radio" name={`correct-${i}`} checked={Number(q.correct_index) === 0} onChange={() => setQ(i, 'correct_index', 0)} /></label>
                  <label className="optionEdit"><span>Salah</span><input type="radio" name={`correct-${i}`} checked={Number(q.correct_index) === 1} onChange={() => setQ(i, 'correct_index', 1)} /></label>
                </div>
              )}
              {q.type === 'isian' && (
                <div style={{ marginTop: '10px' }}>
                  <label>Kunci Jawaban (Ketik persis sama dengan jawaban pemain)</label>
                  <input value={q.correct_text} onChange={(e) => setQ(i, 'correct_text', e.target.value)} placeholder="Contoh: 12" />
                </div>
              )}
            </div>
          ))}
          <div className="actions">
            <button className="secondary" disabled={questions.length >= 50} onClick={() => setQuestions((v) => [...v, blank()])}>+ TAMBAH SOAL MANUAL</button>
            <button disabled={busy || !uid} onClick={saveQuiz}>{busy ? 'MENYIMPAN...' : '💾 SIMPAN KUIS'}</button>
          </div>
        </section>
      )}

      {/* ====== SCREEN HOST / JOIN ====== */}
      {(screen === 'host' || screen === 'join') && (
        <section className="panel">
          <h2>{screen === 'host' ? '📚 Kuis Saya' : '⌨ Gabung Room'}</h2>
          <label>Nama pemain<input maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama kamu" /></label>
          <h3>Pilih kucing</h3>
          <div className="catPicker">
            {CATS.map((c) => (
              <button key={c} className={`catOption ${cat === c ? 'chosen' : ''}`} onClick={() => setCat(c)}>
                <Cat cat={c} size={76} /><small>{LABELS[c]}</small>
              </button>
            ))}
          </div>
          {screen === 'host' ? (
            <>
              <label>Pilih kuis<select value={selectedQuiz} onChange={(e) => setSelectedQuiz(e.target.value)}><option value="">-- Pilih kuis --</option>{quizzes.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}</select></label>
              {quizzes.length === 0 && <p>Belum punya kuis. <button className="linkBtn" onClick={() => setScreen('create')}>Buat kuis dulu</button>.</p>}
              <label>Jumlah Bot (Lawan Sendiri)<input type="number" min="0" max="5" value={botCount} onChange={(e) => setBotCount(Number(e.target.value))} /></label>
              <label>Waktu per Soal (detik)<input type="number" min="5" max="60" value={timeLimit} onChange={(e) => setTimeLimit(Number(e.target.value))} /></label>
              <button disabled={busy || !uid} onClick={makeRoom}>{busy ? 'MEMBUAT...' : '🎮 BUAT KODE ROOM'}</button>
            </>
          ) : (
            <>
              <label>Kode room 6 digit<input inputMode="numeric" maxLength={6} value={joinCode} onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" /></label>
              <button disabled={busy || !uid} onClick={joinRoom}>GABUNG SEKARANG</button>
            </>
          )}
        </section>
      )}

      {/* ====== SCREEN ROOM (RACE & PODIUM) ====== */}
      {screen === 'room' && room && (
        <section className="panel">
          <div className="between roomHeading">
            <div>
              <h2>{room.status === 'lobby' ? 'LOBBY BALAPAN' : showResults ? 'BALAPAN SELESAI' : 'BALAPAN DIMULAI!'}</h2>
              <p className="muted">{room.status === 'lobby' ? 'Bagikan kode ini ke teman-teman.' : `Kode room: ${room.code}`}</p>
            </div>
            <button className="code" onClick={() => navigator.clipboard?.writeText(room.code)}>{room.code} ⧉</button>
          </div>

          {room.status === 'lobby' ? (
            <>
              <p>Pemain siap: <b>{players.length}/10</b></p>
              <div className="playerGrid">
                {players.map((p) => (
                  <div className="playerCard" key={p.id}>
                    <div className="lobbyCatFrame"><Cat cat={p.cat} size={96} /></div>
                    <b>{p.nickname}</b>
                    {p.user_id === room.host_id && <small>HOST</small>}
                    {p.user_id === uid && <small>KAMU</small>}
                  </div>
                ))}
              </div>
              {isHost ? <button disabled={busy || players.length < 1} onClick={startGame}>▶ MULAI BALAPAN</button> : <p className="muted">Menunggu host memulai...</p>}
            </>
          ) : showResults ? (
            <div className="results-container">
              <h2 className="podium-title">🏆 HASIL BALAPAN 🏆</h2>
              <div className="podium-wrapper">
                {rankedPlayers[1] && (
                  <div className="podium-step step-2">
                    <div className="podium-cat"><Cat cat={rankedPlayers[1].cat} size={64} /></div>
                    <div className="podium-info"><span className="medal">🥈</span><b>{rankedPlayers[1].nickname}</b><small>{Math.floor(rankedPlayers[1].distance)}m</small></div>
                  </div>
                )}
                {rankedPlayers[0] && (
                  <div className="podium-step step-1">
                    <div className="podium-cat"><Cat cat={rankedPlayers[0].cat} size={80} /></div>
                    <div className="podium-info"><span className="medal">🥇</span><b>{rankedPlayers[0].nickname}</b><small>{Math.floor(rankedPlayers[0].distance)}m</small></div>
                  </div>
                )}
                {rankedPlayers[2] && (
                  <div className="podium-step step-3">
                    <div className="podium-cat"><Cat cat={rankedPlayers[2].cat} size={56} /></div>
                    <div className="podium-info"><span className="medal">🥉</span><b>{rankedPlayers[2].nickname}</b><small>{Math.floor(rankedPlayers[2].distance)}m</small></div>
                  </div>
                )}
              </div>
              <div className="results-list">
                <h3>Peringkat Lainnya</h3>
                {rankedPlayers.slice(3).map((p, i) => (
                  <div className="result-row" key={p.id}>
                    <span>{i + 4}.</span><span>{p.nickname}</span><span>{Math.floor(p.distance)}m</span>
                  </div>
                ))}
                {rankedPlayers.length <= 3 && <p style={{textAlign: "center", color: "var(--text-muted)"}}>Tidak ada pemain lain.</p>}
              </div>
              <div className="podium-actions">
                <button className="secondary" onClick={openReview} disabled={busy}>{busy ? 'MEMUAT...' : '📖 LIHAT PEMBAHASAN'}</button>
                <button onClick={() => { home(); fx('click'); }}>KEMBALI KE MENU</button>
              </div>
            </div>
          ) : (
            <>
              <div className="raceStage">
                <div className="raceTopHud">
                  <div className="hudPill"><span className="hudIcon">🏆</span><b>{me?.correct_count || 0}</b><small>BENAR</small></div>
                  <div className="hudPill"><span className="hudIcon">🏁</span><b>300 m</b></div>
                  <div className="hudPill timerPill"><span className="hudIcon">◷</span><b>{formatTime(elapsedMs)}</b></div>
                  <div className="energyPill"><span>⚡</span><div className={`energyBar ${energyClass}`}><i style={{ width: `${myEnergy}%` }} /></div></div>
                  <div className="hudPill positionPill"><small>POSISI</small><b>{myPosition}/{rankedPlayers.length}</b></div>
                </div>

                <div className="raceScenery">
                  <div className="mountainRange" /><div className="sakuraTree treeOne">🌸</div><div className="sakuraTree treeTwo">🌸</div><div className="pagoda">🏯</div><div className="fenceLine" />
                  <div className="raceLanes">
                    {lanePlayers.map((p) => {
                      const mine = p.user_id === uid;
                      const progress = Math.min(88, Math.max(3, (Number(p.distance) / 300) * 88));
                      const moving = Number(p.distance) > 0;
                      const action = p.finished_at ? 'idle' : mine && sprinting && moving ? 'dash' : moving ? 'run_1' : 'idle';
                      return (
                        <div className={`raceLane runnerLane ${mine ? 'myRunnerLane' : ''}`} key={p.id}>
                          <div className="laneDecor" />
                          <span className="runnerTrackName">{mine ? 'LINTASAN KAMU' : p.nickname}</span>
                          <div className={`raceCat ${mine ? 'myRaceCat' : 'rivalCat'}`} style={{ left: `${progress}%` }}>
                            {mine ? <div className="youMarker"><b>KUCING KAMU</b><span>▼</span></div> : <div className="rivalName">{p.nickname}</div>}
                            <Cat cat={p.cat} action={action} size={mine ? 56 : 46} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="finishBanner">🏁</div>
                </div>

                <div className="raceBottomHud">
                  <div className="controlKeys">
                    <button className={`arcadeKey runKey ${myEnergy <= 0 ? 'disabledKey' : ''}`} onClick={() => pressRunKey()} style={{ minWidth: '120px' }}>
                      <b>D</b><small>LARI</small>
                    </button>
                    <button className={`arcadeKey ${sprinting ? 'keyActive' : ''}`} onPointerDown={(e) => { e.preventDefault(); moveRef.current.sprinting = true; setSprinting(true); }} onPointerUp={() => { moveRef.current.sprinting = false; setSprinting(false); }} onPointerLeave={() => { moveRef.current.sprinting = false; setSprinting(false); }}><b>⚡</b><small>SHIFT<br />SPRINT</small></button>
                  </div>
                  <div className="distanceCard"><small>JARAK SAAT INI</small><b>{Math.floor(Number(me?.distance || 0))} m</b></div>
                  <div className="miniProgress"><div style={{ width: `${Math.min(100, Number(me?.distance || 0) / 3)}%` }} /><span>🐱</span><b>🏁</b></div>
                  <div className="woodTip">Tekan D atau tahan<br />Jawab kuis jika energi habis!</div>
                </div>
              </div>

              <div className="raceMeta">{rankedPlayers.length} PEMAIN/BOT • TEKAN D: MAJU • SHIFT: SPRINT<span className="stepHint">{stepHint}</span></div>
            </>
          )}
        </section>
      )}

      {/* ====== SCREEN REVIEW (PEMBAHASAN) ====== */}
      {screen === 'review' && reviewData && (
        <section className="panel">
          <div className="between roomHeading">
            <div>
              <h2>📖 PEMBAHASAN KUIS</h2>
              <p className="muted">Kunci jawaban dan statistik akurasi pemain.</p>
            </div>
            <button className="ghost" onClick={home}>KEMBALI KE MENU</button>
          </div>

          <div className="review-layout">
            <div className="review-players">
              <h3>📊 Akurasi Pemain</h3>
              <div className="player-stats-list">
                {rankedPlayers.map((p) => {
                  const totalQ = p.correct_count + p.wrong_count;
                  const acc = totalQ > 0 ? Math.round((p.correct_count / totalQ) * 100) : 0;
                  return (
                    <div className="player-stat-card" key={p.id}>
                      <div className="player-stat-header">
                        <b>{p.nickname}</b>
                        <span className={`acc-badge ${acc >= 70 ? 'high' : acc >= 40 ? 'mid' : 'low'}`}>{acc}% Akurasi</span>
                      </div>
                      <div className="player-stat-details">
                        <span>✅ {p.correct_count} Benar</span>
                        <span>❌ {p.wrong_count} Salah</span>
                        <span>📝 {totalQ} Soal Dijawab</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="review-answers">
              <h3>🔑 Kunci Jawaban</h3>
              <div className="answers-list">
                {reviewData.map((q, i) => {
                  let correctAns = '';
                  if (q.type === 'isian') correctAns = q.options[0];
                  else if (q.type === 'tf') correctAns = q.options[q.correct_index];
                  else correctAns = `Opsi ${'ABCD'[q.correct_index]}. ${q.options[q.correct_index]}`;

                  return (
                    <div className="answer-card" key={q.id}>
                      <p className="q-prompt"><b>Soal {i + 1}:</b> {q.prompt}</p>
                      <p className="q-correct"><b>Jawaban Benar:</b> <span>{correctAns}</span></p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ====== QUIZ POPUP ====== */}
      {screen === 'room' && room?.status === 'racing' && me?.needs_quiz && !showResults && (
        <div className="overlay">
          <div className="quizModal">
            <h2>⚡ ENERGI HABIS!</h2>
            <p>Jawab soal dengan benar untuk memulihkan energi dan lanjut berlari.</p>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '15px 0' }}>
              <span style={{ fontSize: '20px' }}>⏱</span>
              <div className="quizTimerBarWrapper">
                <div
                  className="quizTimerBar"
                  style={{
                    width: `${(quizSeconds / (room.quiz_time_limit || 15)) * 100}%`,
                    backgroundColor: quizSeconds > ((room.quiz_time_limit || 15) * 0.3) ? 'var(--green-moss)' : 'var(--pink-soft)'
                  }}
                />
              </div>
              <span style={{ fontWeight: 900, color: 'var(--text-dark)', minWidth: '40px', textAlign: 'right' }}>{quizSeconds}s</span>
            </div>

            {question ? (
              <>
                <h3 style={{ marginBottom: '15px' }}>SOAL {question.number}: {question.prompt}</h3>
                
                {question.type === 'pg' && (
                  <div className="answerGrid">
                    {question.options.map((o, i) => (
                      <button key={i} disabled={busy} onClick={() => answer(i)}>{'ABCD'[i]}. {o}</button>
                    ))}
                  </div>
                )}

                {question.type === 'tf' && (
                  <div className="answerGrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <button disabled={busy} onClick={() => answer(0)} style={{ textAlign: 'center', fontSize: '18px' }}>✅ BENAR</button>
                    <button disabled={busy} onClick={() => answer(1)} style={{ textAlign: 'center', fontSize: '18px' }}>❌ SALAH</button>
                  </div>
                )}

                {question.type === 'isian' && (
                  <form onSubmit={handleSubmitShortAnswer} style={{ marginTop: '20px' }}>
                    <input type="text" value={shortAnswerInput} onChange={(e) => setShortAnswerInput(e.target.value)} placeholder="Ketik jawabanmu di sini..." autoFocus required />
                    <button type="submit" disabled={busy} style={{ width: '100%', marginTop: '15px' }}>KIRIM JAWABAN</button>
                  </form>
                )}
              </>
            ) : <p>Memuat soal...</p>}
          </div>
        </div>
      )}

      <footer>CAT DASH • Multiplayer Quiz Race • React + Supabase</footer>
    </main>
  );
}