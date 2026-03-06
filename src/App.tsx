import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════
interface Question {
  id: string | number;
  section: 'Science' | 'Math' | 'English';
  text: string;
  options: [string, string, string, string];
  answer: number;
  topic?: string; // syllabus topic (e.g. "Newtons Laws", "Differentiation")
  explanation?: string; // optional explanation shown in Practice mode
}
interface Student {
  name: string;
  branch: string;
  college: string;
  enrollment: string; // required field now
}
// A named test set created by admin
interface TestSet {
  id: string;
  name: string; // e.g. "DDCET 2025 Full Test"
  type: 'exam' | 'practice';
  description: string;
  allowDate?: string; // if set, only accessible on/after this date (YYYY-MM-DD)
  allowRetake: boolean; // if false, same enrollment can't retake
  config: TestConfig;
  timeLimits: SectionTimeLimits;
  createdAt: string;
}
interface SectionTimeLimits {
  enabled: boolean;
  science: number; // minutes
  math: number;
  english: number;
}
interface ScoreEntry {
  name: string;
  branch: string;
  college: string;
  enrollment: string;
  testSetId: string; // which test set this belongs to
  testSetName: string;
  score: number;
  correct: number;
  wrong: number;
  unattempted: number;
  total: number;
  timeTaken: number;
  date: string;
  sciScore: number;
  sciCorrect: number;
  sciTotal: number;
  mathScore: number;
  mathCorrect: number;
  mathTotal: number;
  engScore: number;
  engCorrect: number;
  engTotal: number;
  answers: Record<number, number>;
  questions: Question[];
}
type Screen = 'home' | 'test' | 'result' | 'leaderboard' | 'admin';
type SectionFilter = 'All' | 'Science' | 'Math' | 'English';
type TestMode = 'exam' | 'practice';

// ═══════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════
const ADMIN_PW = 'ddcet@admin2025';
const TIMER_SEC = 150 * 60;
const BRANCHES = [
  'Civil Engineering',
  'Mechanical Engineering',
  'Electrical Engineering',
  'Computer Science and Engineering',
  'Computer Engineering',
  'Chemical Engineering',
  'IT Engineering',
  'Other',
];
const SECTIONS: Array<'Science' | 'Math' | 'English'> = [
  'Science',
  'Math',
  'English',
];

interface TestConfig {
  science: number;
  math: number;
  english: number;
}
const DEFAULT_CONFIG: TestConfig = { science: 50, math: 30, english: 20 };
const DEFAULT_TIME_LIMITS: SectionTimeLimits = {
  enabled: false,
  science: 75,
  math: 45,
  english: 30,
};

const DEFAULT_TEST_SET: TestSet = {
  id: 'default',
  name: 'DDCET Mock Test',
  type: 'exam',
  description: 'Official DDCET pattern — 100 questions, 150 minutes',
  allowRetake: false,
  config: DEFAULT_CONFIG,
  timeLimits: DEFAULT_TIME_LIMITS,
  createdAt: new Date().toISOString(),
};

const loadConfig = (): TestConfig => {
  try {
    const r = LS.get('ddcet:config');
    if (r) return JSON.parse(r) as TestConfig;
  } catch {}
  return DEFAULT_CONFIG;
};
const saveConfig = (c: TestConfig): void => {
  LS.set('ddcet:config', JSON.stringify(c));
};

// TestSet storage
const loadTestSets = (): TestSet[] => {
  try {
    const r = LS.get('ddcet:testsets');
    if (r) return JSON.parse(r) as TestSet[];
  } catch {}
  return [DEFAULT_TEST_SET];
};
const saveTestSets = (sets: TestSet[]): void => {
  LS.set('ddcet:testsets', JSON.stringify(sets));
};

// Attempt lock: track who already took a specific test
const getAttemptKey = (testSetId: string, enrollment: string) =>
  `ddcet:attempt:${testSetId}:${enrollment.trim().toLowerCase()}`;
const hasAttempted = (testSetId: string, enrollment: string): boolean => {
  if (!enrollment.trim()) return false;
  return LS.get(getAttemptKey(testSetId, enrollment)) === '1';
};
const markAttempted = (testSetId: string, enrollment: string): void => {
  if (!enrollment.trim()) return;
  LS.set(getAttemptKey(testSetId, enrollment), '1');
};

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════
const fmtTime = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h > 0 ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(
    sec
  ).padStart(2, '0')}`;
};
const uid = (): string =>
  `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const shuffle = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ═══════════════════════════════════════════════
// FIREBASE CONFIG
// 👉 Replace these values with your own Firebase project config
// Get them from: console.firebase.google.com → Project Settings → Your Apps
// ═══════════════════════════════════════════════
const FB_CONFIG = {
  apiKey: 'PASTE_YOUR_apiKey_HERE',
  authDomain: 'PASTE_YOUR_authDomain_HERE',
  projectId: 'PASTE_YOUR_projectId_HERE',
  storageBucket: 'PASTE_YOUR_storageBucket_HERE',
  messagingSenderId: 'PASTE_YOUR_messagingSenderId_HERE',
  appId: 'PASTE_YOUR_appId_HERE',
};
const FB_CONFIGURED = !FB_CONFIG.apiKey.includes('PASTE');

// ═══════════════════════════════════════════════
// STORAGE — localStorage (questions/config) + Firebase (scores)
// ═══════════════════════════════════════════════
const LS = {
  get: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, val: string): void => {
    try {
      localStorage.setItem(key, val);
    } catch {}
  },
  keys: (prefix: string): string[] => {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    } catch {
      return [];
    }
  },
};

const loadQ = (): Question[] => {
  try {
    const r = LS.get('ddcet:questions');
    if (r) {
      const q = JSON.parse(r) as Question[];
      if (Array.isArray(q) && q.length > 0) return q;
    }
  } catch {}
  return []; // Questions live in DB — use Admin → Upload to DB or Bulk Import
};
const saveQ = (qs: Question[]): void => {
  LS.set('ddcet:questions', JSON.stringify(qs));
};

// Firebase dynamic loader — only loads SDK if configured
let _db: unknown = null;
const getDB = async (): Promise<unknown> => {
  if (_db) return _db;
  if (!FB_CONFIGURED) return null;
  try {
    const { initializeApp, getApps } = (await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js' as string
    )) as { initializeApp: (c: object) => unknown; getApps: () => unknown[] };
    const app = getApps().length ? getApps()[0] : initializeApp(FB_CONFIG);
    const { getFirestore } = (await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js' as string
    )) as { getFirestore: (a: unknown) => unknown };
    _db = getFirestore(app);
    return _db;
  } catch {
    return null;
  }
};

// Save score — Firebase if configured, localStorage fallback
const saveScore = async (entry: ScoreEntry): Promise<void> => {
  const key = `ddcet:score:${entry.testSetId}:${Date.now()}`;
  LS.set(key, JSON.stringify(entry));
  if (!FB_CONFIGURED) return;
  try {
    const db = await getDB();
    if (!db) return;
    const { collection, addDoc, serverTimestamp } = (await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js' as string
    )) as {
      collection: (db: unknown, path: string) => unknown;
      addDoc: (ref: unknown, data: object) => Promise<unknown>;
      serverTimestamp: () => unknown;
    };
    const col = `scores_${entry.testSetId}`;
    await addDoc(collection(db, col), {
      ...entry,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('Firebase save failed:', e);
  }
};

// Load scores for a specific test set
const loadScoresRemote = async (
  testSetId = 'default'
): Promise<ScoreEntry[]> => {
  if (!FB_CONFIGURED) return loadScoresLocal(testSetId);
  try {
    const db = await getDB();
    if (!db) return loadScoresLocal(testSetId);
    const { collection, getDocs, orderBy, query } = (await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js' as string
    )) as {
      collection: (db: unknown, path: string) => unknown;
      getDocs: (
        q: unknown
      ) => Promise<{ docs: Array<{ data: () => ScoreEntry }> }>;
      orderBy: (field: string, dir: string) => unknown;
      query: (...args: unknown[]) => unknown;
    };
    const col = `scores_${testSetId}`;
    const q = query(collection(db, col), orderBy('score', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data());
  } catch {
    return loadScoresLocal(testSetId);
  }
};

const clearScoresRemote = async (testSetId = 'default'): Promise<void> => {
  LS.keys(`ddcet:score:${testSetId}:`).forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  });
  if (!FB_CONFIGURED) return;
  try {
    const db = await getDB();
    if (!db) return;
    const { collection, getDocs, deleteDoc, doc } = (await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js' as string
    )) as {
      collection: (db: unknown, path: string) => unknown;
      getDocs: (
        ref: unknown
      ) => Promise<{ docs: Array<{ ref: unknown; id: string }> }>;
      deleteDoc: (ref: unknown) => Promise<void>;
      doc: (db: unknown, path: string, id: string) => unknown;
    };
    const col = `scores_${testSetId}`;
    const snap = await getDocs(collection(db, col));
    await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, col, d.id))));
  } catch (e) {
    console.warn('Firebase clear failed:', e);
  }
};

const loadScoresLocal = (testSetId = 'default'): ScoreEntry[] => {
  return LS.keys(`ddcet:score:${testSetId}:`)
    .map((k) => {
      try {
        const r = LS.get(k);
        return r ? (JSON.parse(r) as ScoreEntry) : null;
      } catch {
        return null;
      }
    })
    .filter((x): x is ScoreEntry => x !== null)
    .sort((a, b) => b.score - a.score);
};

// ═══════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [config, setConfig] = useState<TestConfig>(DEFAULT_CONFIG);
  const [testSets, setTestSets] = useState<TestSet[]>([]);
  const [activeSet, setActiveSet] = useState<TestSet>(DEFAULT_TEST_SET);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setQuestions(loadQ());
    setConfig(loadConfig());
    const sets = loadTestSets();
    setTestSets(sets);
    setActiveSet(sets[0] || DEFAULT_TEST_SET);
    setLoading(false);
  }, []);

  const handleSetTestSets = (sets: TestSet[]) => {
    setTestSets(sets);
    saveTestSets(sets);
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#060c18',
        }}
      >
        <CSS />
        <Dots />
      </div>
    );
  }

  return (
    <>
      <CSS />
      {screen === 'home' && (
        <Home
          setScreen={setScreen}
          testSets={testSets}
          activeSet={activeSet}
          setActiveSet={setActiveSet}
        />
      )}
      {screen === 'test' && (
        <Test
          setScreen={setScreen}
          questions={questions}
          activeSet={activeSet}
        />
      )}
      {screen === 'result' && <Result setScreen={setScreen} />}
      {screen === 'leaderboard' && (
        <Leaderboard
          setScreen={setScreen}
          testSets={testSets}
          initSet={activeSet}
        />
      )}
      {screen === 'admin' && (
        <Admin
          setScreen={setScreen}
          questions={questions}
          setQuestions={setQuestions}
          config={config}
          setConfig={setConfig}
          testSets={testSets}
          setTestSets={handleSetTestSets}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════
function Home({
  setScreen,
  testSets,
  activeSet,
  setActiveSet,
}: {
  setScreen: (s: Screen) => void;
  testSets: TestSet[];
  activeSet: TestSet;
  setActiveSet: (t: TestSet) => void;
}) {
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [college, setCollege] = useState('');
  const [enrollment, setEnroll] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showAdm, setShowAdm] = useState(false);
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');

  const today = new Date().toISOString().split('T')[0];

  // Available test sets: not date-locked
  const availableSets = testSets.filter(
    (ts) => !ts.allowDate || ts.allowDate <= today
  );

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Full name is required';
    if (!branch) e.branch = 'Select your branch';
    if (!enrollment.trim()) e.enrollment = 'Enrollment number is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const startTest = (mode: TestMode = 'exam') => {
    if (!validate()) return;

    // Check duplicate attempt for exam mode
    if (mode === 'exam' && !activeSet.allowRetake) {
      if (hasAttempted(activeSet.id, enrollment.trim())) {
        setErrors((e) => ({
          ...e,
          enrollment: `You already attempted "${activeSet.name}". Ask your admin to reset attempt locks, or try Practice Mode.`,
        }));
        return;
      }
    }

    const student: Student = {
      name: name.trim(),
      branch,
      college,
      enrollment: enrollment.trim(),
    };
    sessionStorage.setItem('ddcet_student', JSON.stringify(student));
    sessionStorage.setItem('ddcet_mode', mode);
    setScreen('test');
  };

  const enterAdmin = () => {
    if (pw === ADMIN_PW) setScreen('admin');
    else setPwErr('Incorrect password');
  };

  const cfg = activeSet.config;
  const totalQ = cfg.science + cfg.math + cfg.english;

  return (
    <div className="pg home-pg">
      <div className="home-grid">
        <div className="home-left">
          <div className="brand-pill">GTU · DDCET</div>
          <h1 className="home-h1">
            Mock Test
            <br />
            Platform
          </h1>
          <p className="home-sub">
            Diploma to Degree Common Entrance Test — Official Pattern Practice
          </p>

          {/* Test Set Selector */}
          {availableSets.length > 1 && (
            <div style={{ marginBottom: '1.2rem' }}>
              <div className="fl" style={{ marginBottom: 6 }}>
                Select Test
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {availableSets.map((ts) => (
                  <div
                    key={ts.id}
                    onClick={() => setActiveSet(ts)}
                    style={{
                      padding: '.6rem .9rem',
                      borderRadius: 10,
                      cursor: 'pointer',
                      background:
                        activeSet.id === ts.id ? '#132040' : '#0e1a2e',
                      border: `1.5px solid ${
                        activeSet.id === ts.id ? '#3b82f6' : '#1e2d45'
                      }`,
                      transition: 'all .15s',
                    }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <span style={{ fontSize: '1rem' }}>
                        {ts.type === 'practice' ? '📖' : '📝'}
                      </span>
                      <div>
                        <div
                          style={{
                            fontSize: '.88rem',
                            fontWeight: 700,
                            color:
                              activeSet.id === ts.id ? '#60a5fa' : '#e2e8f0',
                          }}
                        >
                          {ts.name}
                        </div>
                        <div style={{ fontSize: '.7rem', color: '#64748b' }}>
                          {ts.description}
                        </div>
                      </div>
                      {activeSet.id === ts.id && (
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: '.7rem',
                            color: '#3b82f6',
                          }}
                        >
                          ✓ Selected
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="info-pills">
            <div className="ipill">
              <b>{totalQ}</b>Questions
            </div>
            <div className="ipill">
              <b>
                {activeSet.timeLimits.enabled
                  ? `${
                      activeSet.timeLimits.science +
                      activeSet.timeLimits.math +
                      activeSet.timeLimits.english
                    }`
                  : '150'}
              </b>
              Minutes
            </div>
            <div className="ipill">
              <b>{totalQ * 2}</b>Marks
            </div>
            <div className="ipill">
              <b>{activeSet.type === 'practice' ? 'Practice' : 'Exam'}</b>Mode
            </div>
          </div>
          <div className="dist-grid">
            {(
              [
                ['Science', cfg.science, '#3b82f6'],
                ['Math', cfg.math, '#8b5cf6'],
                ['English', cfg.english, '#10b981'],
              ] as [string, number, string][]
            ).map(([s, n, c]) => (
              <div key={s} className="dist-row">
                <div
                  className="dist-bar"
                  style={{
                    width: `${(n / Math.max(totalQ, 1)) * 100}%`,
                    background: c,
                  }}
                />
                <span className={`sec-tag sec-${s}`}>{s}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: '.75rem',
                    color: '#64748b',
                  }}
                >
                  {n} Q
                </span>
              </div>
            ))}
          </div>
          {activeSet.timeLimits.enabled && (
            <div
              style={{
                fontSize: '.75rem',
                color: '#94a3b8',
                marginBottom: '.8rem',
                padding: '.5rem .8rem',
                background: '#131e30',
                borderRadius: 8,
              }}
            >
              ⏱ Section limits: {activeSet.timeLimits.science}m Science ·{' '}
              {activeSet.timeLimits.math}m Math · {activeSet.timeLimits.english}
              m English
            </div>
          )}
          <div className="mark-row">
            <div className="mk green">+2 Correct</div>
            <div className="mk red">−0.5 Wrong</div>
            <div className="mk gray">0 Skipped</div>
          </div>
        </div>

        <div className="home-right">
          <div className="form-card">
            <h2 className="fc-h">
              {activeSet.type === 'practice'
                ? '📖 Practice Mode'
                : '📝 Begin Test'}
            </h2>

            <div className="fg">
              <label className="fl">Full Name *</label>
              <input
                className={`fi${errors.name ? ' fi-e' : ''}`}
                placeholder="Enter your full name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((v) => ({ ...v, name: '' }));
                }}
              />
              {errors.name && <span className="fe">{errors.name}</span>}
            </div>

            <div className="fg">
              <label className="fl">Enrollment Number *</label>
              <input
                className={`fi${errors.enrollment ? ' fi-e' : ''}`}
                placeholder="e.g. 22XXXXXX (required)"
                value={enrollment}
                onChange={(e) => {
                  setEnroll(e.target.value);
                  setErrors((v) => ({ ...v, enrollment: '' }));
                }}
              />
              {errors.enrollment && (
                <span className="fe">{errors.enrollment}</span>
              )}
            </div>

            <div className="fg">
              <label className="fl">Engineering Branch *</label>
              <select
                className={`fi${errors.branch ? ' fi-e' : ''}`}
                value={branch}
                onChange={(e) => {
                  setBranch(e.target.value);
                  setErrors((v) => ({ ...v, branch: '' }));
                }}
              >
                <option value="">— Select branch —</option>
                {BRANCHES.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              {errors.branch && <span className="fe">{errors.branch}</span>}
            </div>

            <div className="fg">
              <label className="fl">College Name (optional)</label>
              <input
                className="fi"
                placeholder="Your college / institute name"
                value={college}
                onChange={(e) => setCollege(e.target.value)}
              />
            </div>

            {questions.length === 0 && (
              <div
                style={{
                  background: '#2d1200',
                  border: '1px solid #92400e',
                  borderRadius: 8,
                  padding: '.65rem .9rem',
                  marginBottom: '.5rem',
                  fontSize: '.77rem',
                  color: '#fbbf24',
                  lineHeight: 1.6,
                }}
              >
                ⚠ No questions loaded yet.{' '}
                <span
                  style={{
                    color: '#60a5fa',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                  onClick={() => {
                    setPw('');
                    setShowAdm(true);
                  }}
                >
                  Open Admin → 📤 Upload to DB
                </span>{' '}
                to add your question bank.
              </div>
            )}
            <button
              className="btn-prim"
              onClick={() => startTest('exam')}
              disabled={questions.length === 0}
              style={{
                opacity: questions.length === 0 ? 0.45 : 1,
                cursor: questions.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {activeSet.type === 'practice'
                ? '📖 Start Practice →'
                : '🎯 Start Exam →'}
            </button>

            {activeSet.type === 'exam' && (
              <>
                <div className="divider">
                  <span>or</span>
                </div>
                <button
                  className="btn-out w100"
                  onClick={() => startTest('practice')}
                  style={{ borderColor: '#8b5cf6', color: '#a78bfa' }}
                >
                  📖 Practice Mode (no timer, see answers)
                </button>
              </>
            )}

            <div className="divider">
              <span>or</span>
            </div>
            <button
              className="btn-out w100"
              onClick={() => setScreen('leaderboard')}
            >
              🏆 View Leaderboard
            </button>
            <button className="btn-ghost" onClick={() => setShowAdm((v) => !v)}>
              ⚙ Admin Panel
            </button>

            {showAdm && (
              <div
                style={{
                  marginTop: '.6rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <input
                  className="fi"
                  type="password"
                  placeholder="Admin password"
                  value={pw}
                  onChange={(e) => {
                    setPw(e.target.value);
                    setPwErr('');
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && enterAdmin()}
                />
                {pwErr && <span className="fe">{pwErr}</span>}
                <button className="btn-adm" onClick={enterAdmin}>
                  Enter Admin →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="footer">
        crafted by <span className="footer-aj">AJ</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// TEST
// ═══════════════════════════════════════════════
function Test({
  setScreen,
  questions,
  activeSet,
}: {
  setScreen: (s: Screen) => void;
  questions: Question[];
  activeSet: TestSet;
}) {
  const student: Student = JSON.parse(
    sessionStorage.getItem('ddcet_student') ||
      '{"name":"Student","branch":"—","college":"","enrollment":""}'
  );
  const isPractice = sessionStorage.getItem('ddcet_mode') === 'practice';
  const cfg = activeSet.config;
  const tl = activeSet.timeLimits;

  // Build test questions grouped by section
  const [testQs] = useState<Question[]>(() => {
    const pick = (arr: Question[], n: number) =>
      shuffle(arr).slice(0, Math.min(n, arr.length));
    const sci = pick(
      questions.filter((q) => q.section === 'Science'),
      cfg.science
    );
    const math = pick(
      questions.filter((q) => q.section === 'Math'),
      cfg.math
    );
    const eng = pick(
      questions.filter((q) => q.section === 'English'),
      cfg.english
    );
    // Keep sections together so section timers work by index range
    return [...sci, ...math, ...eng];
  });

  // Section boundaries by index
  const secBounds = {
    Science: { start: 0, end: cfg.science - 1 },
    Math: { start: cfg.science, end: cfg.science + cfg.math - 1 },
    English: { start: cfg.science + cfg.math, end: testQs.length - 1 },
  };

  const [ans, setAns] = useState<Record<number, number>>({});
  const [flag, setFlag] = useState<Record<number, boolean>>({});
  const [cur, setCur] = useState(0);
  const [panel, setPanel] = useState(false);
  const [sf, setSf] = useState<SectionFilter>('All');
  const [warn, setWarn] = useState('');
  const [tabWarnCt, setTabWarnCt] = useState(0);
  const [done, setDone] = useState(false);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({}); // practice mode

  // Timer state: overall + per-section
  const totalSecs = isPractice
    ? 0
    : tl.enabled
    ? (tl.science + tl.math + tl.english) * 60
    : 150 * 60;
  const [tLeft, setTLeft] = useState(totalSecs);
  const secTimers = {
    Science: tl.enabled ? tl.science * 60 : null,
    Math: tl.enabled ? tl.math * 60 : null,
    English: tl.enabled ? tl.english * 60 : null,
  };
  const [secTLeft, setSecTLeft] = useState<Record<string, number>>({
    Science: secTimers.Science ?? 0,
    Math: secTimers.Math ?? 0,
    English: secTimers.English ?? 0,
  });
  const curSection = testQs[cur]?.section ?? 'Science';
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fsRef = useRef<HTMLDivElement>(null);

  // ── Fullscreen on mount ──
  useEffect(() => {
    const el = document.documentElement;
    if (!isPractice && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
    return () => {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  // ── Anti-cheat + ESC lock (exam mode only) ──
  useEffect(() => {
    const noCtx = (e: MouseEvent) => e.preventDefault();
    const noKey = (e: KeyboardEvent) => {
      // Block dev-tools shortcuts
      if (
        (e.ctrlKey || e.metaKey) &&
        ['c', 'u', 's', 'a', 'p', 'v'].includes(e.key.toLowerCase())
      )
        e.preventDefault();
      if (
        e.key === 'F12' ||
        (e.ctrlKey &&
          e.shiftKey &&
          ['i', 'j', 'c'].includes(e.key.toLowerCase()))
      )
        e.preventDefault();
      // ── Block ESC to prevent exiting fullscreen during exam ──
      // ESC is allowed in Practice Mode, blocked in Exam Mode
      if (!isPractice && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        // Re-request fullscreen if they somehow exited it
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      }
    };
    const noSel = (e: Event) => e.preventDefault();
    // Also intercept fullscreenchange — if user exits fullscreen in exam, re-enter it
    const onFsChange = () => {
      if (!isPractice && !done && !document.fullscreenElement) {
        setTimeout(() => {
          document.documentElement.requestFullscreen().catch(() => {});
        }, 200);
      }
    };

    // Tab switch — auto-submit after 3 warnings
    const onVis = () => {
      if (done || isPractice) return;
      if (document.visibilityState === 'hidden') {
        setTabWarnCt((c) => {
          const next = c + 1;
          if (next >= 3) {
            // Auto-submit
            submitRef.current(true);
          } else {
            setWarn(
              `⚠ Tab switch detected! Warning ${next}/3 — 3rd warning auto-submits your test.`
            );
          }
          return next;
        });
      }
    };

    if (!isPractice) {
      document.addEventListener('contextmenu', noCtx);
      document.addEventListener('keydown', noKey, true); // capture phase so ESC is caught first
      document.addEventListener('selectstart', noSel);
      document.addEventListener('visibilitychange', onVis);
      document.addEventListener('fullscreenchange', onFsChange);
    }
    return () => {
      document.removeEventListener('contextmenu', noCtx);
      document.removeEventListener('keydown', noKey, true);
      document.removeEventListener('selectstart', noSel);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [done, isPractice]);

  // Use a ref for submit so the visibility handler can always call latest version
  const submitRef = useRef<(auto?: boolean) => void>(() => {});

  const submit = useCallback(
    (auto = false) => {
      if (done) return;
      if (
        !auto &&
        !window.confirm(
          `Submit test?\n${
            testQs.length - Object.keys(ans).length
          } question(s) unanswered.`
        )
      )
        return;
      if (timerRef.current) clearInterval(timerRef.current);
      setDone(true);

      let c = 0,
        w = 0,
        u = 0,
        sciC = 0,
        sciW = 0,
        sciU = 0,
        mathC = 0,
        mathW = 0,
        mathU = 0,
        engC = 0,
        engW = 0,
        engU = 0;
      testQs.forEach((q, i) => {
        const ok = ans[i] === q.answer,
          sk = ans[i] === undefined;
        if (sk) u++;
        else if (ok) c++;
        else w++;
        if (q.section === 'Science') {
          if (sk) sciU++;
          else if (ok) sciC++;
          else sciW++;
        } else if (q.section === 'Math') {
          if (sk) mathU++;
          else if (ok) mathC++;
          else mathW++;
        } else {
          if (sk) engU++;
          else if (ok) engC++;
          else engW++;
        }
      });
      const sciT = testQs.filter((q) => q.section === 'Science').length;
      const mathT = testQs.filter((q) => q.section === 'Math').length;
      const engT = testQs.filter((q) => q.section === 'English').length;
      const score = Math.max(0, c * 2 - w * 0.5);

      if (!isPractice) {
        // Mark attempt lock
        markAttempted(activeSet.id, student.enrollment);
      }

      const entry: ScoreEntry = {
        name: student.name,
        branch: student.branch,
        college: student.college || '—',
        enrollment: student.enrollment || '—',
        testSetId: activeSet.id,
        testSetName: activeSet.name,
        score,
        correct: c,
        wrong: w,
        unattempted: u,
        total: testQs.length,
        timeTaken: isPractice ? 0 : totalSecs - tLeft,
        date: new Date().toLocaleDateString('en-IN'),
        sciScore: Math.max(0, sciC * 2 - sciW * 0.5),
        sciCorrect: sciC,
        sciTotal: sciT,
        mathScore: Math.max(0, mathC * 2 - mathW * 0.5),
        mathCorrect: mathC,
        mathTotal: mathT,
        engScore: Math.max(0, engC * 2 - engW * 0.5),
        engCorrect: engC,
        engTotal: engT,
        answers: { ...ans },
        questions: testQs,
      };
      sessionStorage.setItem('ddcet_result', JSON.stringify(entry));
      if (!isPractice) void saveScore(entry);

      // Exit fullscreen
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setScreen('result');
    },
    [
      done,
      testQs,
      ans,
      tLeft,
      student,
      activeSet,
      isPractice,
      totalSecs,
      setScreen,
    ]
  );

  // Keep submitRef up to date
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  // ── Timer ──
  useEffect(() => {
    if (done || isPractice) return;
    timerRef.current = setInterval(() => {
      setTLeft((t) => {
        if (t <= 1) {
          submitRef.current(true);
          return 0;
        }
        return t - 1;
      });
      if (tl.enabled) {
        setSecTLeft((prev) => {
          const sec = testQs[cur]?.section;
          if (!sec) return prev;
          const v = prev[sec];
          if (v <= 1) {
            // Section time up — warn only, student can still answer other sections
            if (prev[sec] > 0) {
              // Only show warning once (when it first hits 0)
              setWarn(
                `⏰ ${sec} time is up! You can still answer other sections.`
              );
            }
            return { ...prev, [sec]: 0 };
          }
          return { ...prev, [sec]: v - 1 };
        });
      }
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [done, isPractice, tl.enabled]);

  const q = testQs[cur];
  const attempted = Object.keys(ans).length;
  const flaggedCount = Object.values(flag).filter(Boolean).length;
  const tc = isPractice
    ? 't-ok'
    : tLeft > 600
    ? 't-ok'
    : tLeft > 180
    ? 't-warn'
    : 't-danger';
  const secT = tl.enabled ? secTLeft[curSection] : null;
  const secTc =
    secT == null
      ? 't-ok'
      : secT > 300
      ? 't-ok'
      : secT > 60
      ? 't-warn'
      : 't-danger';

  const chipCls = (i: number) => {
    const a = ans[i] !== undefined,
      f = flag[i];
    return a && f
      ? 'chip-both'
      : f
      ? 'chip-flag'
      : a
      ? 'chip-ans'
      : i === cur
      ? 'chip-cur'
      : 'chip-none';
  };

  const navQs =
    sf === 'All'
      ? testQs.map((qq, i) => ({ qq, i }))
      : testQs
          .map((qq, i) => ({ qq, i }))
          .filter(({ qq }) => qq.section === sf);

  // Practice: reveal answer for current question
  const isRevealed = isPractice && revealed[cur];

  return (
    <div
      ref={fsRef}
      className="test-root"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      {warn && (
        <div className="cheat-warn" onClick={() => setWarn('')}>
          {warn} <small>(tap to dismiss)</small>
        </div>
      )}

      {/* Header */}
      <div className="t-hdr">
        <div className="thdr-l">
          <span className="t-logo">{isPractice ? '📖' : 'DDCET'}</span>
          <span className="t-name">{student.name}</span>
          <span className="t-branch">
            {student.branch.split(' ').slice(0, 2).join(' ')}
          </span>
          {student.enrollment && (
            <span className="t-branch">#{student.enrollment}</span>
          )}
        </div>
        <div className="thdr-m">
          <Pill c="green">{attempted} done</Pill>
          <Pill c="amber">{flaggedCount} flagged</Pill>
          <Pill c="gray">{testQs.length - attempted} left</Pill>
          {isPractice && <span className="practice-badge">Practice</span>}
        </div>
        <div className="thdr-r">
          {!isPractice && (
            <>
              {tl.enabled && secT !== null && (
                <div className={`timer ${secTc}`} title={`${curSection} time`}>
                  {curSection.slice(0, 3)}: {fmtTime(secT)}
                </div>
              )}
              <div className={`timer ${tc}`}>{fmtTime(tLeft)}</div>
            </>
          )}
          {isPractice && <div className="timer t-ok">Practice</div>}
          <button className="btn-tog" onClick={() => setPanel((v) => !v)}>
            ☰
          </button>
          <button className="btn-sub" onClick={() => submit(false)}>
            Submit
          </button>
        </div>
      </div>

      <div className="prog">
        <div
          className="prog-f"
          style={{ width: `${((cur + 1) / testQs.length) * 100}%` }}
        />
      </div>

      <div className="t-body">
        <div className="q-main">
          <div className="q-meta-row">
            <span className={`sec-tag sec-${q.section}`}>{q.section}</span>
            <span className="q-num">
              Q {cur + 1} / {testQs.length}
            </span>
            {tl.enabled && secT !== null && !isPractice && (
              <span
                className={`timer ${secTc}`}
                style={{ fontSize: '.7rem', padding: '2px 8px' }}
              >
                {fmtTime(secT)}
              </span>
            )}
          </div>
          <div className="q-txt">{q.text}</div>
          <div className="opts-col">
            {q.options.map((o, i) => {
              let cls = 'opt';
              if (ans[cur] === i) cls += ' opt-sel';
              if (isRevealed && i === q.answer) cls += ' opt-correct-reveal';
              if (isRevealed && ans[cur] === i && ans[cur] !== q.answer)
                cls += ' opt-wrong-reveal';
              return (
                <button
                  key={i}
                  className={cls}
                  onClick={() => {
                    if (!isRevealed || !isPractice)
                      setAns((a) => ({ ...a, [cur]: i }));
                  }}
                >
                  <div className="opt-l">{['A', 'B', 'C', 'D'][i]}</div>
                  <div className="opt-t">{o}</div>
                  {isRevealed && i === q.answer && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: '.75rem',
                        color: '#4ade80',
                        fontWeight: 700,
                      }}
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Practice: answer + topic + explanation reveal */}
          {isPractice && (
            <div style={{ marginTop: '1rem' }}>
              {!isRevealed ? (
                <button
                  className="btn-out"
                  style={{ fontSize: '.82rem', padding: '.5rem 1.2rem' }}
                  onClick={() => setRevealed((r) => ({ ...r, [cur]: true }))}
                >
                  💡 Show Answer & Topic
                </button>
              ) : (
                <div className="practice-explain">
                  <div
                    style={{
                      color: '#4ade80',
                      fontWeight: 700,
                      marginBottom: 8,
                      fontSize: '.95rem',
                    }}
                  >
                    ✓ Correct Answer: {q.options[q.answer]}
                  </div>
                  {q.topic && (
                    <div className="topic-tag">
                      📚 Topic: <b>{q.topic}</b>
                    </div>
                  )}
                  {q.explanation && (
                    <div
                      style={{
                        color: '#94a3b8',
                        fontSize: '.82rem',
                        lineHeight: 1.65,
                        marginTop: 6,
                      }}
                    >
                      💬 {q.explanation}
                    </div>
                  )}
                  {!q.topic && !q.explanation && (
                    <div
                      style={{
                        color: '#475569',
                        fontSize: '.78rem',
                        marginTop: 4,
                      }}
                    >
                      No topic/explanation added yet. Add them in Admin →
                      Questions.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="q-foot">
            {!isPractice ? (
              <button
                className={`btn-flag${flag[cur] ? ' fl-on' : ' fl-off'}`}
                onClick={() => setFlag((f) => ({ ...f, [cur]: !f[cur] }))}
              >
                {flag[cur] ? '🚩 Flagged' : '🏳 Flag'}
              </button>
            ) : (
              <div />
            )}
            <div className="nav-r">
              {ans[cur] !== undefined && !isRevealed && (
                <button
                  className="btn-clr"
                  onClick={() =>
                    setAns((a) => {
                      const n = { ...a };
                      delete n[cur];
                      return n;
                    })
                  }
                >
                  ✕ Clear
                </button>
              )}
              <button
                className="btn-nav"
                disabled={cur === 0}
                onClick={() => setCur((c) => c - 1)}
              >
                ← Prev
              </button>
              <button
                className="btn-nav prim"
                disabled={cur === testQs.length - 1}
                onClick={() => setCur((c) => c + 1)}
              >
                Next →
              </button>
            </div>
          </div>
        </div>

        {/* Navigator */}
        <div className={`nav-panel${panel ? ' pan-open' : ''}`}>
          <div className="np-hdr">
            <span className="np-ttl">Navigator</span>
            <button className="np-cls" onClick={() => setPanel(false)}>
              ✕
            </button>
          </div>
          <div className="np-flt">
            {(['All', 'Science', 'Math', 'English'] as SectionFilter[]).map(
              (s) => (
                <button
                  key={s}
                  className={`nfb${sf === s ? ' nfa' : ''}`}
                  onClick={() => setSf(s)}
                >
                  {s}
                </button>
              )
            )}
          </div>
          {tl.enabled && !isPractice && (
            <div
              style={{
                padding: '6px 10px',
                background: '#131e30',
                margin: '0 0 8px',
                borderRadius: 6,
                fontSize: '.72rem',
              }}
            >
              <div style={{ color: '#64748b' }}>Section time remaining:</div>
              {SECTIONS.map((s) => (
                <div
                  key={s}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color:
                      secTLeft[s] < 60
                        ? '#f87171'
                        : secTLeft[s] < 300
                        ? '#fbbf24'
                        : '#4ade80',
                  }}
                >
                  <span>{s}</span>
                  <span>{fmtTime(secTLeft[s])}</span>
                </div>
              ))}
            </div>
          )}
          <div className="np-leg">
            <span className="lg chip-ans">Answered</span>
            <span className="lg chip-flag">Flagged</span>
            <span className="lg chip-both">Both</span>
            <span className="lg chip-none">Pending</span>
          </div>
          <div className="np-grid">
            {navQs.map(({ i }) => (
              <div
                key={i}
                className={`chip ${chipCls(i)}${i === cur ? ' chip-cur' : ''}`}
                onClick={() => {
                  setCur(i);
                  if (window.innerWidth < 900) setPanel(false);
                }}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>
        {panel && <div className="ov" onClick={() => setPanel(false)} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// RESULT
// ═══════════════════════════════════════════════
function Result({ setScreen }: { setScreen: (s: Screen) => void }) {
  const r = JSON.parse(
    sessionStorage.getItem('ddcet_result') || 'null'
  ) as ScoreEntry | null;
  const [tab, setTab] = useState<'summary' | 'review'>('summary');
  const [reviewFlt, setReviewFlt] = useState<
    'all' | 'wrong' | 'correct' | 'skipped'
  >('all');

  if (!r)
    return (
      <div className="pg">
        <p style={{ color: '#64748b' }}>No result found.</p>
      </div>
    );

  const pct = Math.round((r.score / (r.total * 2)) * 100);
  const grade =
    pct >= 75
      ? 'A+'
      : pct >= 60
      ? 'A'
      : pct >= 45
      ? 'B'
      : pct >= 30
      ? 'C'
      : 'D';
  const gc =
    pct >= 75
      ? '#4ade80'
      : pct >= 60
      ? '#60a5fa'
      : pct >= 45
      ? '#fbbf24'
      : pct >= 30
      ? '#f97316'
      : '#f87171';
  const em = pct >= 75 ? '🎉' : pct >= 55 ? '👍' : pct >= 35 ? '📖' : '💪';
  const circ = 2 * Math.PI * 50;

  const secs = [
    {
      label: 'Science',
      score: r.sciScore,
      correct: r.sciCorrect,
      total: r.sciTotal,
      color: '#3b82f6',
    },
    {
      label: 'Math',
      score: r.mathScore,
      correct: r.mathCorrect,
      total: r.mathTotal,
      color: '#8b5cf6',
    },
    {
      label: 'English',
      score: r.engScore,
      correct: r.engCorrect,
      total: r.engTotal,
      color: '#10b981',
    },
  ];

  const reviewQs = (r.questions || [])
    .map((q, i) => {
      const chosen = r.answers?.[i];
      const isCorrect = chosen === q.answer;
      const isSkipped = chosen === undefined;
      return { q, i, chosen, isCorrect, isSkipped };
    })
    .filter(({ isCorrect, isSkipped }) => {
      if (reviewFlt === 'wrong') return !isCorrect && !isSkipped;
      if (reviewFlt === 'correct') return isCorrect;
      if (reviewFlt === 'skipped') return isSkipped;
      return true;
    });

  const printPDF = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const rows = (r.questions || [])
      .map((q, i) => {
        const chosen = r.answers?.[i];
        const ok = chosen === q.answer;
        const skipped = chosen === undefined;
        const status = skipped ? 'Skipped' : ok ? 'Correct' : 'Wrong';
        const color = skipped ? '#888' : ok ? '#16a34a' : '#dc2626';
        return `<tr style="border-bottom:1px solid #e2e8f0">
        <td style="padding:6px 4px;font-size:12px;color:#374151">${i + 1}. ${
          q.text
        }</td>
        <td style="padding:6px 4px;font-size:11px;color:#6b7280">${
          q.options[q.answer]
        }</td>
        <td style="padding:6px 4px;font-size:11px;color:${
          skipped ? '#888' : ok ? '#6b7280' : '#dc2626'
        }">${skipped ? '—' : q.options[chosen]}</td>
        <td style="padding:6px 4px;font-size:11px;font-weight:700;color:${color}">${status}</td>
      </tr>`;
      })
      .join('');
    w.document.write(`<!DOCTYPE html><html><head><title>DDCET Result — ${
      r.name
    }</title>
    <style>body{font-family:Arial,sans-serif;margin:0;padding:20px;color:#111}
    @media print{.no-print{display:none}}</style></head><body>
    <div style="text-align:center;margin-bottom:16px;border-bottom:2px solid #1d4ed8;padding-bottom:12px">
      <h2 style="color:#1d4ed8;margin:0">DDCET Mock Test — Result Card</h2>
      <p style="color:#6b7280;margin:4px 0;font-size:13px">Gujarat Technological University</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr><td style="padding:4px 8px;font-size:13px"><b>Name:</b> ${r.name}</td>
          <td style="padding:4px 8px;font-size:13px"><b>Enrollment:</b> ${
            r.enrollment || '—'
          }</td></tr>
      <tr><td style="padding:4px 8px;font-size:13px"><b>Branch:</b> ${
        r.branch
      }</td>
          <td style="padding:4px 8px;font-size:13px"><b>College:</b> ${
            r.college
          }</td></tr>
      <tr><td style="padding:4px 8px;font-size:13px"><b>Date:</b> ${r.date}</td>
          <td style="padding:4px 8px;font-size:13px"><b>Time Taken:</b> ${Math.floor(
            r.timeTaken / 60
          )}m ${r.timeTaken % 60}s</td></tr>
    </table>
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 16px;text-align:center;min-width:90px">
        <div style="font-size:22px;font-weight:800;color:#16a34a">${r.score.toFixed(
          1
        )}</div>
        <div style="font-size:11px;color:#6b7280">Score / ${
          r.total * 2
        }</div></div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 16px;text-align:center;min-width:90px">
        <div style="font-size:22px;font-weight:800;color:#1d4ed8">${pct}%</div>
        <div style="font-size:11px;color:#6b7280">Percentage</div></div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 16px;text-align:center;min-width:90px">
        <div style="font-size:22px;font-weight:800;color:#111">Grade ${grade}</div>
        <div style="font-size:11px;color:#6b7280">Grade</div></div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 16px;text-align:center;min-width:80px">
        <div style="font-size:20px;font-weight:700;color:#16a34a">${
          r.correct
        }</div>
        <div style="font-size:11px;color:#6b7280">Correct</div></div>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 16px;text-align:center;min-width:80px">
        <div style="font-size:20px;font-weight:700;color:#dc2626">${
          r.wrong
        }</div>
        <div style="font-size:11px;color:#6b7280">Wrong</div></div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 16px;text-align:center;min-width:80px">
        <div style="font-size:20px;font-weight:700;color:#6b7280">${
          r.unattempted
        }</div>
        <div style="font-size:11px;color:#6b7280">Skipped</div></div>
    </div>
    <div style="margin-bottom:14px">
      <b style="font-size:13px">Section-wise Score:</b>
      <div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap">
        ${secs
          .map(
            (
              s
            ) => `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 12px;min-width:110px">
          <div style="font-size:13px;font-weight:700">${s.label}</div>
          <div style="font-size:12px;color:#6b7280">${s.score.toFixed(1)} / ${
              s.total * 2
            } &nbsp;·&nbsp; ${s.correct}/${s.total} correct</div>
        </div>`
          )
          .join('')}
      </div>
    </div>
    <h3 style="font-size:13px;border-top:1px solid #e5e7eb;padding-top:10px;margin-bottom:6px">Answer Review</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f3f4f6">
        <th style="padding:6px 4px;font-size:11px;text-align:left">Question</th>
        <th style="padding:6px 4px;font-size:11px;text-align:left">Correct Answer</th>
        <th style="padding:6px 4px;font-size:11px;text-align:left">Your Answer</th>
        <th style="padding:6px 4px;font-size:11px;text-align:left">Status</th>
      </tr></thead><tbody>${rows}</tbody>
    </table>
    <div class="no-print" style="text-align:center;margin-top:20px">
      <button onclick="window.print()" style="background:#1d4ed8;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer">🖨 Print / Save PDF</button>
    </div>
    <p style="text-align:center;font-size:10px;color:#9ca3af;margin-top:16px">Generated by DDCET Mock Test Platform · crafted by AJ</p>
    </body></html>`);
    w.document.close();
  };

  return (
    <div
      className="pg res-pg"
      style={{ alignItems: 'flex-start', padding: '1.5rem' }}
    >
      <div className="res-card" style={{ maxWidth: 680 }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: '1.2rem' }}>
          {(['summary', 'review'] as const).map((t) => (
            <button
              key={t}
              className={`tab${tab === t ? ' tab-a' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'summary' ? '📊 Summary' : '🔍 Answer Review'}
            </button>
          ))}
          <button
            className="btn-out"
            style={{
              marginLeft: 'auto',
              fontSize: '.8rem',
              padding: '.4rem .9rem',
            }}
            onClick={printPDF}
          >
            📄 Download PDF
          </button>
        </div>

        {tab === 'summary' && (
          <>
            <div className="res-top">
              <div style={{ fontSize: '2.6rem' }}>{em}</div>
              <div className="res-nm">{r.name}</div>
              <div className="res-br">
                {r.enrollment && r.enrollment !== '—'
                  ? `#${r.enrollment} · `
                  : ''}
                {r.branch}
                {r.college !== '—' ? ` · ${r.college}` : ''} · {r.date}
              </div>
            </div>
            <div className="ring-wrap">
              <svg viewBox="0 0 120 120" style={{ width: 140, height: 140 }}>
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  stroke="#1e293b"
                  strokeWidth="10"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  stroke={gc}
                  strokeWidth="10"
                  strokeDasharray={circ}
                  strokeDashoffset={circ * (1 - pct / 100)}
                  strokeLinecap="round"
                  transform="rotate(-90 60 60)"
                  style={{ transition: 'stroke-dashoffset 1.2s ease' }}
                />
              </svg>
              <div className="ring-in">
                <div className="ring-sc">{r.score.toFixed(1)}</div>
                <div className="ring-tot">/{r.total * 2}</div>
              </div>
            </div>
            <div className="grade-bdg" style={{ color: gc, borderColor: gc }}>
              Grade {grade} · {pct}%
            </div>

            {/* Overall stats */}
            <div className="res-grid">
              {(
                [
                  ['Correct', String(r.correct), '#4ade80'],
                  ['Wrong', String(r.wrong), '#f87171'],
                  ['Skipped', String(r.unattempted), '#94a3b8'],
                  ['+Marks', (r.correct * 2).toFixed(1), '#fbbf24'],
                  ['−Marks', (r.wrong * 0.5).toFixed(1), '#f87171'],
                  ['Time', `${Math.floor(r.timeTaken / 60)}m`, '#60a5fa'],
                ] as [string, string, string][]
              ).map(([l, v, c]) => (
                <div key={l} className="rg-cell">
                  <div className="rg-v" style={{ color: c }}>
                    {v}
                  </div>
                  <div className="rg-l">{l}</div>
                </div>
              ))}
            </div>

            {/* Section breakdown */}
            <div style={{ marginBottom: '1.2rem' }}>
              <div
                style={{
                  fontSize: '.72rem',
                  color: '#64748b',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  marginBottom: 8,
                }}
              >
                Section-wise Score
              </div>
              {secs.map((s) => {
                const sp =
                  s.total > 0 ? Math.round((s.score / (s.total * 2)) * 100) : 0;
                return (
                  <div key={s.label} className="sec-row">
                    <div className="sec-row-left">
                      <span className={`sec-tag sec-${s.label}`}>
                        {s.label}
                      </span>
                      <span style={{ fontSize: '.78rem', color: '#94a3b8' }}>
                        {s.correct}/{s.total} correct
                      </span>
                    </div>
                    <div className="sec-row-bar">
                      <div className="sec-bar-bg">
                        <div
                          className="sec-bar-fill"
                          style={{ width: `${sp}%`, background: s.color }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: '.8rem',
                          fontWeight: 700,
                          color: s.color,
                          minWidth: 40,
                          textAlign: 'right',
                        }}
                      >
                        {s.score.toFixed(0)}/{s.total * 2}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="res-acts">
              <button
                className="btn-prim"
                style={{ flex: 1 }}
                onClick={() => setScreen('home')}
              >
                Try Again
              </button>
              <button
                className="btn-out"
                onClick={() => setScreen('leaderboard')}
              >
                🏆 Leaderboard
              </button>
            </div>
          </>
        )}

        {tab === 'review' && (
          <>
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                marginBottom: '1rem',
              }}
            >
              {(['all', 'correct', 'wrong', 'skipped'] as const).map((f) => (
                <button
                  key={f}
                  className={`nfb${reviewFlt === f ? ' nfa' : ''}`}
                  style={{ fontSize: '.75rem' }}
                  onClick={() => setReviewFlt(f)}
                >
                  {f === 'all'
                    ? `All (${(r.questions || []).length})`
                    : f === 'correct'
                    ? `✓ Correct (${r.correct})`
                    : f === 'wrong'
                    ? `✗ Wrong (${r.wrong})`
                    : `— Skipped (${r.unattempted})`}
                </button>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                maxHeight: '65vh',
                overflowY: 'auto',
              }}
            >
              {reviewQs.length === 0 && (
                <div className="empty">No questions in this filter.</div>
              )}
              {reviewQs.map(({ q, i, chosen, isCorrect, isSkipped }) => (
                <div
                  key={i}
                  className={`rev-item${
                    isCorrect
                      ? ' rev-ok'
                      : isSkipped
                      ? ' rev-skip'
                      : ' rev-wrong'
                  }`}
                >
                  <div className="rev-top">
                    <span className={`sec-tag sec-${q.section}`}>
                      {q.section}
                    </span>
                    <span className="rev-qnum">Q{i + 1}</span>
                    <span
                      className={`rev-status${
                        isCorrect
                          ? ' rev-s-ok'
                          : isSkipped
                          ? ' rev-s-skip'
                          : ' rev-s-wrong'
                      }`}
                    >
                      {isCorrect
                        ? '✓ Correct'
                        : isSkipped
                        ? '— Skipped'
                        : '✗ Wrong'}
                    </span>
                  </div>
                  <div className="rev-qtxt">{q.text}</div>
                  <div className="rev-opts">
                    {q.options.map((opt, j) => {
                      const isAns = j === q.answer;
                      const isChosen = j === chosen;
                      let cls = 'rev-opt';
                      if (isAns) cls += ' rev-opt-correct';
                      else if (isChosen && !isAns) cls += ' rev-opt-wrong';
                      return (
                        <div key={j} className={cls}>
                          <span className="rev-ol">
                            {['A', 'B', 'C', 'D'][j]}
                          </span>
                          <span>{opt}</span>
                          {isAns && (
                            <span className="rev-tag-ok">✓ Correct</span>
                          )}
                          {isChosen && !isAns && (
                            <span className="rev-tag-wrong">✗ Your answer</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
              <button
                className="btn-prim"
                style={{ flex: 1 }}
                onClick={() => setScreen('home')}
              >
                Try Again
              </button>
              <button className="btn-out" onClick={printPDF}>
                📄 Download PDF
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════
function Leaderboard({
  setScreen,
  testSets,
  initSet,
}: {
  setScreen: (s: Screen) => void;
  testSets: TestSet[];
  initSet: TestSet;
}) {
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [flt, setFlt] = useState('All');
  const [activeTs, setActiveTs] = useState<string>(initSet.id);

  useEffect(() => {
    loadScoresRemote().then((s) => {
      setScores(s);
      setLoading(false);
    });
  }, []);

  // Filter by selected test set
  const tsScores =
    activeTs === '__all__'
      ? scores
      : scores.filter((s) => s.testSetId === activeTs);
  const branches = [
    'All',
    ...Array.from(new Set(tsScores.map((s) => s.branch))),
  ];
  const shown =
    flt === 'All' ? tsScores : tsScores.filter((s) => s.branch === flt);

  const avgScore = tsScores.length
    ? (tsScores.reduce((a, b) => a + b.score, 0) / tsScores.length).toFixed(1)
    : '—';
  const topScore = tsScores.length ? tsScores[0].score.toFixed(1) : '—';
  const avgPct = tsScores.length
    ? Math.round(
        tsScores.reduce((a, b) => a + (b.score / (b.total * 2)) * 100, 0) /
          tsScores.length
      )
    : 0;

  // Unique test sets that have scores
  const setsWithScores = [
    '__all__',
    ...Array.from(new Set(scores.map((s) => s.testSetId))),
  ];

  return (
    <div className="pg lb-pg">
      <div className="lb-wrap">
        <div className="lb-hdr-row">
          <button className="btn-bk" onClick={() => setScreen('home')}>
            ← Back
          </button>
          <h2 className="lb-ttl">🏆 Leaderboard</h2>
          <span className="lb-cnt" style={{ marginLeft: 'auto' }}>
            {tsScores.length} attempts
          </span>
        </div>

        {!FB_CONFIGURED && (
          <div className="fb-banner">
            ⚠️ <b>Local mode</b> — scores saved per-device only. Set up Firebase
            for shared leaderboard.
          </div>
        )}
        {FB_CONFIGURED && (
          <div className="fb-banner fb-ok">
            🔥 <b>Firebase active</b> — scores synced in real-time across every
            device.
          </div>
        )}

        {/* Test Set Filter */}
        {setsWithScores.length > 1 && (
          <div
            style={{
              marginBottom: '.75rem',
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            {setsWithScores.map((tsId) => {
              const ts = testSets.find((t) => t.id === tsId);
              const label =
                tsId === '__all__' ? '📊 All Tests' : ts?.name ?? tsId;
              return (
                <button
                  key={tsId}
                  className={`nfb${activeTs === tsId ? ' nfa' : ''}`}
                  style={{ fontSize: '.75rem' }}
                  onClick={() => {
                    setActiveTs(tsId);
                    setFlt('All');
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <Dots />
          </div>
        ) : (
          <>
            {tsScores.length > 0 && (
              <div className="lb-stats">
                <div className="lbs-cell">
                  <div className="lbs-v">{tsScores.length}</div>
                  <div className="lbs-l">Total Attempts</div>
                </div>
                <div className="lbs-cell">
                  <div className="lbs-v" style={{ color: '#4ade80' }}>
                    {topScore}
                  </div>
                  <div className="lbs-l">Top Score</div>
                </div>
                <div className="lbs-cell">
                  <div className="lbs-v" style={{ color: '#60a5fa' }}>
                    {avgScore}
                  </div>
                  <div className="lbs-l">Avg Score</div>
                </div>
                <div className="lbs-cell">
                  <div className="lbs-v" style={{ color: '#fbbf24' }}>
                    {avgPct}%
                  </div>
                  <div className="lbs-l">Avg %</div>
                </div>
              </div>
            )}

            <div className="lb-flt">
              {branches.slice(0, 8).map((b) => (
                <button
                  key={b}
                  className={`nfb${flt === b ? ' nfa' : ''}`}
                  style={{ fontSize: '.71rem' }}
                  onClick={() => setFlt(b)}
                >
                  {b === 'All' ? b : b.split(' ')[0]}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <div className="empty">No scores yet — be the first!</div>
            ) : (
              <div className="lb-tbl">
                <div className="lb-head">
                  <div>#</div>
                  <div>Student</div>
                  <div>Branch</div>
                  <div>Score</div>
                  <div>%</div>
                  <div>C/W/S</div>
                </div>
                {shown.slice(0, 60).map((s, i) => {
                  const pct = Math.round((s.score / (s.total * 2)) * 100);
                  return (
                    <div key={i} className={`lb-row${i < 3 ? ' lb-top' : ''}`}>
                      <div className={`lbr${i < 3 ? String(i + 1) : ''}`}>
                        {i === 0
                          ? '🥇'
                          : i === 1
                          ? '🥈'
                          : i === 2
                          ? '🥉'
                          : `#${i + 1}`}
                      </div>
                      <div>
                        <div className="lb-nm">{s.name}</div>
                        <div className="lb-cl">
                          {s.enrollment && s.enrollment !== '—'
                            ? `#${s.enrollment} · `
                            : ''}
                          {s.college !== '—' ? s.college + ' · ' : ''}
                          {s.date}
                        </div>
                      </div>
                      <div className="lb-br">
                        {s.branch.split(' ').slice(0, 2).join(' ')}
                      </div>
                      <div className="lb-sc">{s.score.toFixed(1)}</div>
                      <div
                        className="lb-pc"
                        style={{
                          color:
                            pct >= 60
                              ? '#4ade80'
                              : pct >= 40
                              ? '#fbbf24'
                              : '#f87171',
                        }}
                      >
                        {pct}%
                      </div>
                      <div className="lb-cws">
                        <span style={{ color: '#4ade80' }}>{s.correct}✓</span>{' '}
                        <span style={{ color: '#f87171' }}>{s.wrong}✗</span>{' '}
                        <span style={{ color: '#94a3b8' }}>
                          {s.unattempted}−
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        <div className="footer" style={{ marginTop: '2rem' }}>
          crafted by <span className="footer-aj">AJ</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════
function Admin({
  setScreen,
  questions,
  setQuestions,
  config,
  setConfig,
  testSets,
  setTestSets,
}: {
  setScreen: (s: Screen) => void;
  questions: Question[];
  setQuestions: (q: Question[]) => void;
  config: TestConfig;
  setConfig: (c: TestConfig) => void;
  testSets: TestSet[];
  setTestSets: (ts: TestSet[]) => void;
}) {
  const [tab, setTab] = useState<
    'list' | 'add' | 'import' | 'upload' | 'testsets' | 'settings' | 'data'
  >('list');
  const [editQ, setEditQ] = useState<Question | null>(null);
  const [search, setSearch] = useState('');
  const [fSec, setFSec] = useState<SectionFilter>('All');
  const [importTxt, setImportTxt] = useState('');
  const [impErr, setImpErr] = useState('');
  const [impOk, setImpOk] = useState('');
  const [msg, setMsg] = useState('');
  const [cfgEdit, setCfgEdit] = useState<TestConfig>({ ...config });
  // Firebase Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLog, setUploadLog] = useState<string[]>([]);
  const [uploadRunning, setUploadRunning] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [fetchLog, setFetchLog] = useState<string[]>([]);
  const [fetchRunning, setFetchRunning] = useState(false);

  // TestSet editor state
  const [editingSet, setEditingSet] = useState<TestSet | null>(null);
  const [tsForm, setTsForm] = useState<Partial<TestSet>>({});

  const sci = questions.filter((q) => q.section === 'Science').length;
  const math = questions.filter((q) => q.section === 'Math').length;
  const eng = questions.filter((q) => q.section === 'English').length;

  const doSave = (qs: Question[]) => {
    setQuestions(qs);
    saveQ(qs);
    setMsg('Saved ✓');
    setTimeout(() => setMsg(''), 2500);
  };

  const del = (id: string | number) => {
    if (!window.confirm('Delete this question?')) return;
    doSave(questions.filter((q) => q.id !== id));
  };

  const onSaveQ = (q: Question) => {
    const updated = questions.find((x) => x.id === q.id)
      ? questions.map((x) => (x.id === q.id ? q : x))
      : [...questions, q];
    doSave(updated);
    setTab('list');
    setEditQ(null);
  };

  const doImport = () => {
    setImpErr('');
    setImpOk('');
    const lines = importTxt
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const nqs: Question[] = [];
    for (let i = 0; i < lines.length; i++) {
      const p = lines[i].split('|');
      if (p.length < 7 || p.length > 9) {
        setImpErr(`Line ${i + 1}: Need 7–9 fields separated by |`);
        return;
      }
      const [sec, text, a, b, c, d, ansStr, topicStr, expl] = p.map((x) =>
        x.trim()
      );
      if (!SECTIONS.includes(sec as Question['section'])) {
        setImpErr(`Line ${i + 1}: Section must be Science, Math, or English`);
        return;
      }
      const ai = parseInt(ansStr);
      if (isNaN(ai) || ai < 0 || ai > 3) {
        setImpErr(`Line ${i + 1}: Answer must be 0, 1, 2, or 3`);
        return;
      }
      const q: Question = {
        id: uid(),
        section: sec as Question['section'],
        text,
        options: [a, b, c, d],
        answer: ai,
      };
      if (topicStr) q.topic = topicStr;
      if (expl) q.explanation = expl;
      nqs.push(q);
    }
    doSave([...questions, ...nqs]);
    setImpOk(`✓ Imported ${nqs.length} questions!`);
    setImportTxt('');
  };

  const filtered = questions.filter(
    (q) =>
      (fSec === 'All' || q.section === fSec) &&
      (!search || q.text.toLowerCase().includes(search.toLowerCase()))
  );

  // TestSet helpers
  const startNewSet = () => {
    const fresh: TestSet = {
      id: uid(),
      name: '',
      type: 'exam',
      description: '',
      allowRetake: false,
      config: { ...config },
      timeLimits: { ...DEFAULT_TIME_LIMITS },
      createdAt: new Date().toISOString(),
    };
    setEditingSet(fresh);
    setTsForm(fresh);
  };

  const editSet = (ts: TestSet) => {
    setEditingSet(ts);
    setTsForm({ ...ts });
  };

  const saveSet = () => {
    if (!tsForm.name?.trim()) {
      alert('Test name is required.');
      return;
    }
    const updated: TestSet = {
      ...editingSet!,
      ...tsForm,
      name: tsForm.name!.trim(),
      config: tsForm.config ?? config,
      timeLimits: tsForm.timeLimits ?? DEFAULT_TIME_LIMITS,
    } as TestSet;
    const exists = testSets.find((t) => t.id === updated.id);
    const newSets = exists
      ? testSets.map((t) => (t.id === updated.id ? updated : t))
      : [...testSets, updated];
    setTestSets(newSets);
    setEditingSet(null);
    setMsg('Test set saved ✓');
    setTimeout(() => setMsg(''), 2500);
  };

  const deleteSet = (id: string) => {
    if (id === 'default') {
      alert('Cannot delete the default test set.');
      return;
    }
    if (!window.confirm('Delete this test set? Scores will remain.')) return;
    setTestSets(testSets.filter((t) => t.id !== id));
  };

  const resetAttempts = (ts: TestSet) => {
    if (
      !window.confirm(
        `Reset all attempt locks for "${ts.name}"? Students who took it can retake it.`
      )
    )
      return;
    const keys = LS.keys(`ddcet:attempt:${ts.id}:`);
    keys.forEach((k) => localStorage.removeItem(k));
    setMsg('Attempt locks cleared ✓');
    setTimeout(() => setMsg(''), 2500);
  };

  const setTsField = <K extends keyof TestSet>(k: K, v: TestSet[K]) =>
    setTsForm((f) => ({ ...f, [k]: v }));
  const setTsCfg = (k: keyof TestConfig, v: number) =>
    setTsForm((f) => ({ ...f, config: { ...(f.config ?? config), [k]: v } }));
  const setTsTl = (k: keyof SectionTimeLimits, v: number | boolean) =>
    setTsForm((f) => ({
      ...f,
      timeLimits: { ...(f.timeLimits ?? DEFAULT_TIME_LIMITS), [k]: v },
    }));

  return (
    <div className="pg adm-pg">
      <div className="adm-wrap">
        <div className="adm-hdr">
          <div className="adm-hl">
            <button className="btn-bk" onClick={() => setScreen('home')}>
              ← Exit Admin
            </button>
            <h2 className="adm-ttl">⚙ Admin Panel</h2>
            {msg && <span className="save-ok">{msg}</span>}
          </div>
          <div className="adm-stats">
            <span className="asp blue">{sci} Science</span>
            <span className="asp purple">{math} Math</span>
            <span className="asp green">{eng} English</span>
            <span className="asp amber">{questions.length} Total</span>
          </div>
        </div>

        <div className="adm-note">
          Test picks: <b>{config.science} Science</b> +{' '}
          <b>{config.math} Math</b> + <b>{config.english} English</b> ={' '}
          <b>{config.science + config.math + config.english} questions</b> per
          attempt. Change in ⚙ Settings.
        </div>
        {questions.length === 0 && (
          <div
            style={{
              background: '#2d1200',
              border: '1px solid #92400e',
              borderRadius: 10,
              padding: '.85rem 1.1rem',
              marginBottom: '1rem',
              fontSize: '.82rem',
              color: '#fbbf24',
              lineHeight: 1.7,
            }}
          >
            ⚠ <b>No questions loaded.</b> Go to <b>Admin → 📤 Upload to DB</b>{' '}
            to upload your question bank, or use <b>Admin → 📥 Import</b> to
            paste questions manually.
          </div>
        )}

        <div className="tabs">
          {(
            [
              'list',
              'add',
              'import',
              'upload',
              'testsets',
              'settings',
              'data',
            ] as const
          ).map((t) => (
            <button
              key={t}
              className={`tab${tab === t ? ' tab-a' : ''}`}
              onClick={() => {
                setTab(t);
                setEditQ(null);
                setEditingSet(null);
              }}
            >
              {t === 'list'
                ? '📋 Questions'
                : t === 'add'
                ? '➕ Add'
                : t === 'import'
                ? '📥 Import'
                : t === 'upload'
                ? '📤 Upload to DB'
                : t === 'testsets'
                ? '📝 Test Sets'
                : t === 'settings'
                ? '⚙ Settings'
                : '📊 Data'}
            </button>
          ))}
          <button
            className="tab tab-d"
            onClick={() => {
              if (
                window.confirm(
                  'Clear all questions? They will be removed from local storage.\nNote: Firebase DB questions are not affected. Cannot be undone.'
                )
              )
                doSave([]);
            }}
          >
            ↺ Reset
          </button>
        </div>

        {tab === 'list' && (
          <div className="adm-box">
            <div className="adm-tb">
              <input
                className="fi"
                placeholder="🔍 Search questions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1 }}
              />
              {(['All', 'Science', 'Math', 'English'] as SectionFilter[]).map(
                (s) => (
                  <button
                    key={s}
                    className={`nfb${fSec === s ? ' nfa' : ''}`}
                    onClick={() => setFSec(s)}
                  >
                    {s}
                  </button>
                )
              )}
            </div>
            <div className="ql-note">
              Showing {filtered.length} of {questions.length} questions
            </div>
            <div className="ql">
              {filtered.map((q) => (
                <div key={String(q.id)} className="ql-item">
                  <div className="ql-top">
                    <span className={`sec-tag sec-${q.section}`}>
                      {q.section}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        fontSize: '.88rem',
                        color: '#e2e8f0',
                        margin: '0 .6rem',
                      }}
                    >
                      {q.text}
                    </div>
                    <button
                      className="btn-ed"
                      onClick={() => {
                        setEditQ(q);
                        setTab('add');
                      }}
                    >
                      ✏
                    </button>
                    <button className="btn-dl" onClick={() => del(q.id)}>
                      🗑
                    </button>
                  </div>
                  {q.topic && (
                    <div style={{ marginTop: 4 }}>
                      <span className="topic-inline">📚 {q.topic}</span>
                    </div>
                  )}
                  <div className="ql-opts">
                    {q.options.map((o, j) => (
                      <span
                        key={j}
                        className={`ql-o${j === q.answer ? ' ql-ok' : ''}`}
                      >
                        {['A', 'B', 'C', 'D'][j]}. {o}
                      </span>
                    ))}
                    {q.explanation && (
                      <span className="ql-expl">
                        💬 {q.explanation.slice(0, 60)}
                        {q.explanation.length > 60 ? '…' : ''}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="empty">No questions match your filter.</div>
              )}
            </div>
          </div>
        )}

        {tab === 'add' && (
          <QForm
            key={editQ ? String(editQ.id) : 'new'}
            initial={editQ}
            onSave={onSaveQ}
            onCancel={() => {
              setTab('list');
              setEditQ(null);
            }}
          />
        )}

        {tab === 'import' && (
          <div className="adm-box">
            <div className="imp-guide">
              <h3
                style={{
                  color: '#f1f5f9',
                  marginBottom: '.5rem',
                  fontSize: '1rem',
                }}
              >
                📥 Bulk Import Format
              </h3>
              <p
                style={{
                  fontSize: '.82rem',
                  color: '#94a3b8',
                  marginBottom: '.75rem',
                }}
              >
                One question per line, 7 fields separated by <code>|</code>
              </p>
              <div className="imp-fmt">
                <code>
                  Section | Question | A | B | C | D | Answer | Topic (opt) |
                  Explanation (opt)
                </code>
              </div>
              <div className="imp-ex">
                <div
                  style={{
                    fontSize: '.68rem',
                    color: '#64748b',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    marginBottom: '.3rem',
                  }}
                >
                  Examples (7, 8, or 9 fields):
                </div>
                <code>
                  Science|What is the SI unit of
                  force?|Newton|Joule|Watt|Pascal|0
                </code>
                <br />
                <code>
                  Math|What is d/dx(x²)?|x|2x|x²|2x²|1|Differentiation
                </code>
                <br />
                <code>
                  English|Select correct
                  spelling:|Recieve|Receive|Recevie|Reciave|1|Word
                  Correction|Receive is the correct spelling — "i before e
                  except after c"
                </code>
              </div>
              <p
                style={{
                  fontSize: '.73rem',
                  color: '#64748b',
                  marginTop: '.5rem',
                }}
              >
                <b>Sections:</b> Science, Math, English &nbsp;|&nbsp;{' '}
                <b>Answer:</b> 0/1/2/3 &nbsp;|&nbsp; <b>Topic & Explanation:</b>{' '}
                optional 8th & 9th fields
              </p>
            </div>
            <textarea
              className="imp-ta"
              rows={12}
              placeholder={
                'Science|Question here|A|B|C|D|0\nMath|Question here|A|B|C|D|2\n...'
              }
              value={importTxt}
              onChange={(e) => {
                setImportTxt(e.target.value);
                setImpErr('');
                setImpOk('');
              }}
            />
            {impErr && <div className="imp-err">⚠ {impErr}</div>}
            {impOk && <div className="imp-ok">{impOk}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button
                className="btn-prim"
                style={{ flex: 1 }}
                onClick={doImport}
                disabled={!importTxt.trim()}
              >
                Import Questions (to localStorage)
              </button>
              <button className="btn-out" onClick={() => setImportTxt('')}>
                Clear
              </button>
            </div>
          </div>
        )}

        {/* ── UPLOAD TO DB ── */}
        {tab === 'upload' && (
          <div className="adm-box">
            <h3
              style={{
                color: '#f1f5f9',
                marginBottom: '.5rem',
                fontSize: '1rem',
              }}
            >
              📤 Upload Questions to Firebase Database
            </h3>
            <p
              style={{
                fontSize: '.8rem',
                color: '#94a3b8',
                marginBottom: '1rem',
                lineHeight: 1.6,
              }}
            >
              Upload questions from the Excel file (
              <b style={{ color: '#f1f5f9' }}>DDCET_Question_Bank.xlsx</b>)
              directly into Firebase Firestore. Once uploaded, questions are
              fetched from the DB on every test load — no code changes needed to
              add more questions.
            </p>

            {/* Firebase status */}
            {!FB_CONFIGURED ? (
              <div
                style={{
                  background: '#2d1200',
                  border: '1px solid #92400e',
                  borderRadius: 10,
                  padding: '1rem',
                  marginBottom: '1rem',
                }}
              >
                <div
                  style={{ color: '#fbbf24', fontWeight: 700, marginBottom: 6 }}
                >
                  ⚠ Firebase not connected
                </div>
                <div
                  style={{
                    fontSize: '.78rem',
                    color: '#94a3b8',
                    lineHeight: 1.7,
                  }}
                >
                  To enable cloud question storage:
                  <br />
                  1. Go to{' '}
                  <a
                    href="https://console.firebase.google.com"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#60a5fa' }}
                  >
                    console.firebase.google.com
                  </a>
                  <br />
                  2. Create project → Firestore Database → Start in test mode
                  <br />
                  3. Project Settings → Web app → copy{' '}
                  <code>firebaseConfig</code>
                  <br />
                  4. Open{' '}
                  <b style={{ color: '#f1f5f9' }}>src/lib/constants.ts</b> →
                  fill in <code>FB_CONFIG</code> values
                  <br />
                  5. Redeploy. Questions uploaded here will persist across all
                  devices.
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: '#0d2b1e',
                  border: '1px solid #166534',
                  borderRadius: 8,
                  padding: '.7rem 1rem',
                  marginBottom: '1rem',
                  fontSize: '.78rem',
                  color: '#4ade80',
                }}
              >
                🔥 Firebase connected — uploads go to Firestore collection:{' '}
                <code style={{ color: '#a7f3d0' }}>ddcet_questions</code>
              </div>
            )}

            {/* Option 1: Upload from Excel */}
            <div
              style={{
                background: '#0e1a2e',
                border: '1px solid #1e3a5f',
                borderRadius: 10,
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  color: '#60a5fa',
                  marginBottom: 6,
                  fontSize: '.88rem',
                }}
              >
                📊 Option 1 — Upload from Excel File
              </div>
              <p
                style={{
                  fontSize: '.76rem',
                  color: '#94a3b8',
                  marginBottom: '.8rem',
                  lineHeight: 1.6,
                }}
              >
                Select the{' '}
                <b style={{ color: '#f1f5f9' }}>DDCET_Question_Bank.xlsx</b>{' '}
                file (or any Excel you filled in). Columns expected:{' '}
                <code style={{ color: '#a78bfa' }}>#</code> <code>Section</code>{' '}
                <code>Topic</code> <code>Question</code> <code>A</code>{' '}
                <code>B</code> <code>C</code> <code>D</code>{' '}
                <code>Answer(0-3)</code> <code>Explanation</code>
              </p>
              <input
                type="file"
                accept=".xlsx,.xls"
                style={{
                  display: 'block',
                  marginBottom: 10,
                  color: '#94a3b8',
                  fontSize: '.8rem',
                }}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setUploadFile(f);
                  setUploadLog([]);
                  setUploadDone(false);
                }}
              />
              <button
                className="btn-prim"
                disabled={!uploadFile || uploadRunning}
                style={{ width: 'auto', padding: '.5rem 1.4rem' }}
                onClick={async () => {
                  if (!uploadFile) return;
                  setUploadRunning(true);
                  setUploadLog(['📖 Reading Excel file...']);
                  setUploadDone(false);
                  try {
                    // Read xlsx via SheetJS (loaded from CDN)
                    const SheetJS = (await import(
                      'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as string
                    )) as {
                      read: (data: ArrayBuffer, opts: object) => unknown;
                      utils: {
                        sheet_to_json: (
                          ws: unknown,
                          opts?: object
                        ) => unknown[];
                      };
                    };
                    const buf = await uploadFile.arrayBuffer();
                    const wb = (
                      SheetJS.read as (
                        d: ArrayBuffer,
                        o: object
                      ) => {
                        SheetNames: string[];
                        Sheets: Record<string, unknown>;
                      }
                    )(buf, { type: 'array' });
                    const sheetName =
                      wb.SheetNames.find(
                        (n) =>
                          n.includes('Bank') ||
                          n.includes('bank') ||
                          n.includes('Question')
                      ) || wb.SheetNames[0];
                    const ws = wb.Sheets[sheetName];
                    const rows = SheetJS.utils.sheet_to_json(ws, {
                      header: 1,
                    }) as unknown[][];
                    // Skip title/header rows — find first row where col[0] is a number (the first question ID)
                    const dataRows = rows.filter(
                      (r) => typeof r[0] === 'number' && r[1] && r[3]
                    );
                    setUploadLog((l) => [
                      ...l,
                      `✅ Found ${dataRows.length} question rows in sheet "${sheetName}"`,
                    ]);
                    if (dataRows.length === 0) {
                      setUploadLog((l) => [
                        ...l,
                        '❌ No valid question rows found. Check the Excel format.',
                      ]);
                      setUploadRunning(false);
                      return;
                    }
                    const parsed: Question[] = dataRows
                      .map((r) => ({
                        id: String(r[0]),
                        section: String(r[1]) as Question['section'],
                        topic: String(r[2] ?? ''),
                        text: String(r[3]),
                        options: [
                          String(r[4] || ''),
                          String(r[5] || ''),
                          String(r[6] || ''),
                          String(r[7] || ''),
                        ] as [string, string, string, string],
                        answer: Number(r[8]) || 0,
                        explanation: String(r[10] ?? ''),
                      }))
                      .filter((q) =>
                        ['Science', 'Math', 'English'].includes(q.section)
                      );

                    setUploadLog((l) => [
                      ...l,
                      `📝 Parsed ${parsed.length} valid questions. Starting upload...`,
                    ]);

                    // Upload to Firebase or localStorage
                    let success = 0;
                    const total = parsed.length;
                    for (let i = 0; i < parsed.length; i++) {
                      if (FB_CONFIGURED) {
                        // Upload to Firebase (dynamic import of firebase helper)
                        try {
                          const db = await getDB();
                          if (db) {
                            const { collection, addDoc } = (await import(
                              'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js' as string
                            )) as {
                              collection: (d: unknown, p: string) => unknown;
                              addDoc: (
                                r: unknown,
                                d: object
                              ) => Promise<unknown>;
                            };
                            await addDoc(
                              collection(db, 'ddcet_questions'),
                              parsed[i]
                            );
                            success++;
                          }
                        } catch {
                          /* skip failed */
                        }
                      } else {
                        success++; // count all as "saved" to localStorage below
                      }
                      if ((i + 1) % 10 === 0 || i + 1 === total) {
                        setUploadLog((l) => [
                          ...l.slice(0, -1),
                          `⏳ Uploading... ${i + 1}/${total}`,
                        ]);
                      }
                    }

                    if (!FB_CONFIGURED) {
                      // Save all to localStorage as fallback
                      const existing = loadQ();
                      const merged = [
                        ...existing.filter(
                          (e) =>
                            !parsed.find((p) => String(p.id) === String(e.id))
                        ),
                        ...parsed,
                      ];
                      doSave(merged);
                      setUploadLog((l) => [
                        ...l,
                        `✅ Saved ${parsed.length} questions to localStorage (Firebase not connected).`,
                      ]);
                    } else {
                      setUploadLog((l) => [
                        ...l,
                        `✅ Uploaded ${success}/${total} questions to Firebase Firestore.`,
                      ]);
                    }
                    setUploadDone(true);
                  } catch (e) {
                    setUploadLog((l) => [...l, `❌ Error: ${String(e)}`]);
                  }
                  setUploadRunning(false);
                }}
              >
                {uploadRunning ? '⏳ Uploading...' : '📤 Upload Questions'}
              </button>
              {uploadLog.length > 0 && (
                <div
                  style={{
                    marginTop: '1rem',
                    background: '#060d1a',
                    border: '1px solid #1e2d45',
                    borderRadius: 8,
                    padding: '.75rem 1rem',
                    fontSize: '.76rem',
                    lineHeight: 2,
                  }}
                >
                  {uploadLog.map((l, i) => (
                    <div
                      key={i}
                      style={{
                        color: l.startsWith('❌')
                          ? '#f87171'
                          : l.startsWith('✅')
                          ? '#4ade80'
                          : '#94a3b8',
                      }}
                    >
                      {l}
                    </div>
                  ))}
                  {uploadDone && (
                    <div
                      style={{
                        color: '#fbbf24',
                        fontWeight: 700,
                        marginTop: 8,
                      }}
                    >
                      🎉 Done! Go to 📋 Questions tab to see uploaded questions.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Option 2: Fetch from Firebase */}
            <div
              style={{
                background: '#0e1a2e',
                border: '1px solid #1e3a5f',
                borderRadius: 10,
                padding: '1rem',
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  color: '#4ade80',
                  marginBottom: 6,
                  fontSize: '.88rem',
                }}
              >
                🔄 Option 2 — Fetch Questions from Firebase
              </div>
              <p
                style={{
                  fontSize: '.76rem',
                  color: '#94a3b8',
                  marginBottom: '.8rem',
                  lineHeight: 1.6,
                }}
              >
                Pull all questions from Firestore into this device. Useful when
                you added questions from another device and want to sync.
              </p>
              <button
                className="btn-out"
                style={{ width: 'auto', padding: '.5rem 1.4rem' }}
                disabled={fetchRunning || !FB_CONFIGURED}
                onClick={async () => {
                  setFetchRunning(true);
                  setFetchLog(['🔄 Fetching from Firebase...']);
                  try {
                    const db = await getDB();
                    if (!db) {
                      setFetchLog(['❌ Firebase not available.']);
                      setFetchRunning(false);
                      return;
                    }
                    const { collection, getDocs, orderBy, query } =
                      (await import(
                        'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js' as string
                      )) as {
                        collection: (d: unknown, p: string) => unknown;
                        getDocs: (
                          q: unknown
                        ) => Promise<{
                          docs: Array<{ data: () => Question; id: string }>;
                        }>;
                        orderBy: (f: string) => unknown;
                        query: (...a: unknown[]) => unknown;
                      };
                    const q = query(
                      collection(db, 'ddcet_questions'),
                      orderBy('section')
                    );
                    const snap = await getDocs(q);
                    const fetched = snap.docs.map((d) => ({
                      ...d.data(),
                      _firebaseId: d.id,
                    })) as Question[];
                    doSave(fetched);
                    setFetchLog([
                      `✅ Fetched ${fetched.length} questions from Firestore. Saved to local cache.`,
                    ]);
                  } catch (e) {
                    setFetchLog([`❌ Error: ${String(e)}`]);
                  }
                  setFetchRunning(false);
                }}
              >
                {fetchRunning ? '⏳ Fetching...' : '🔄 Fetch from Firebase'}
              </button>
              {!FB_CONFIGURED && (
                <p
                  style={{ fontSize: '.72rem', color: '#475569', marginTop: 6 }}
                >
                  Configure Firebase first to use this option.
                </p>
              )}
              {fetchLog.map((l, i) => (
                <div
                  key={i}
                  style={{
                    marginTop: 8,
                    fontSize: '.76rem',
                    color: l.startsWith('❌') ? '#f87171' : '#4ade80',
                  }}
                >
                  {l}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TEST SETS ── */}
        {tab === 'testsets' && (
          <div className="adm-box">
            {!editingSet ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: '1rem',
                  }}
                >
                  <h3
                    style={{ color: '#f1f5f9', fontSize: '1.05rem', flex: 1 }}
                  >
                    📝 Manage Test Sets
                  </h3>
                  <button
                    className="btn-prim"
                    style={{
                      width: 'auto',
                      padding: '.45rem 1.1rem',
                      fontSize: '.82rem',
                    }}
                    onClick={startNewSet}
                  >
                    + New Test Set
                  </button>
                </div>
                <p
                  style={{
                    fontSize: '.78rem',
                    color: '#64748b',
                    marginBottom: '1rem',
                  }}
                >
                  Create multiple tests (e.g. DDCET Mock, Practice Test, Chapter
                  Test) each with their own settings, time limits, and
                  leaderboard. Students pick which test to attempt on the home
                  screen.
                </p>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  {testSets.map((ts) => {
                    const tTotal =
                      (ts.config.science + ts.config.math + ts.config.english) *
                      2;
                    return (
                      <div key={ts.id} className="ts-card">
                        <div className="ts-card-top">
                          <span style={{ fontSize: '1.1rem' }}>
                            {ts.type === 'practice' ? '📖' : '📝'}
                          </span>
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                color: '#f1f5f9',
                                fontSize: '.95rem',
                              }}
                            >
                              {ts.name}
                            </div>
                            <div
                              style={{
                                fontSize: '.72rem',
                                color: '#64748b',
                                marginTop: 2,
                              }}
                            >
                              {ts.description || '—'}
                            </div>
                          </div>
                          <div
                            style={{ display: 'flex', gap: 5, flexShrink: 0 }}
                          >
                            <button
                              className="btn-ed"
                              onClick={() => editSet(ts)}
                            >
                              ✏ Edit
                            </button>
                            <button
                              className="btn-ed"
                              style={{
                                background: '#0d2b1e',
                                borderColor: '#166534',
                                color: '#4ade80',
                              }}
                              onClick={() => resetAttempts(ts)}
                            >
                              ↺ Reset
                            </button>
                            {ts.id !== 'default' && (
                              <button
                                className="btn-dl"
                                onClick={() => deleteSet(ts.id)}
                              >
                                🗑
                              </button>
                            )}
                          </div>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            flexWrap: 'wrap',
                            marginTop: 8,
                          }}
                        >
                          <span className="asp blue">
                            {ts.config.science}S·{ts.config.math}M·
                            {ts.config.english}E
                          </span>
                          <span className="asp amber">{tTotal} marks</span>
                          {ts.type === 'practice' && (
                            <span className="asp green">Practice</span>
                          )}
                          {!ts.allowRetake && (
                            <span className="asp purple">No retake</span>
                          )}
                          {ts.allowDate && (
                            <span className="asp amber">
                              From {ts.allowDate}
                            </span>
                          )}
                          {ts.timeLimits.enabled && (
                            <span className="asp blue">
                              {ts.timeLimits.science}m/{ts.timeLimits.math}m/
                              {ts.timeLimits.english}m
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              /* ── EDIT FORM ── */
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: '1.2rem',
                  }}
                >
                  <button
                    className="btn-bk"
                    onClick={() => setEditingSet(null)}
                  >
                    ← Back
                  </button>
                  <h3 style={{ color: '#f1f5f9', fontSize: '1rem' }}>
                    {testSets.find((t) => t.id === editingSet.id)
                      ? '✏ Edit Test Set'
                      : '➕ New Test Set'}
                  </h3>
                </div>

                <div className="fg">
                  <label className="fl">Test Name *</label>
                  <input
                    className="fi"
                    placeholder="e.g. DDCET 2025 Full Mock, Chapter 3 Practice..."
                    value={tsForm.name || ''}
                    onChange={(e) => setTsField('name', e.target.value)}
                  />
                </div>
                <div className="fg">
                  <label className="fl">Description</label>
                  <input
                    className="fi"
                    placeholder="Short description shown to students"
                    value={tsForm.description || ''}
                    onChange={(e) => setTsField('description', e.target.value)}
                  />
                </div>
                <div className="fg">
                  <label className="fl">Test Type</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['exam', 'practice'] as const).map((t) => (
                      <button
                        key={t}
                        className={`nfb${tsForm.type === t ? ' nfa' : ''}`}
                        style={{ fontSize: '.82rem', padding: '.35rem .9rem' }}
                        onClick={() => setTsField('type', t)}
                      >
                        {t === 'exam'
                          ? '📝 Exam (timed, scored, anti-cheat)'
                          : '📖 Practice (no timer, see answers)'}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 10,
                    marginBottom: '.9rem',
                  }}
                >
                  <div>
                    <label className="fl">Available From (optional)</label>
                    <input
                      className="fi"
                      type="date"
                      value={tsForm.allowDate || ''}
                      onChange={(e) =>
                        setTsField(
                          'allowDate',
                          e.target.value || (undefined as unknown as string)
                        )
                      }
                    />
                    <span style={{ fontSize: '.68rem', color: '#64748b' }}>
                      Leave blank = always available
                    </span>
                  </div>
                  <div>
                    <label className="fl">Allow Retake?</label>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      {([true, false] as const).map((v) => (
                        <button
                          key={String(v)}
                          className={`nfb${
                            tsForm.allowRetake === v ? ' nfa' : ''
                          }`}
                          style={{ flex: 1 }}
                          onClick={() => setTsField('allowRetake', v)}
                        >
                          {v ? '✓ Yes' : '✗ No (1 attempt)'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    background: '#131e30',
                    borderRadius: 10,
                    padding: '1rem',
                    marginBottom: '.9rem',
                  }}
                >
                  <div className="fl" style={{ marginBottom: 10 }}>
                    Questions per Section
                  </div>
                  {(['science', 'math', 'english'] as const).map((sec) => {
                    const label = sec.charAt(0).toUpperCase() + sec.slice(1);
                    const avail = questions.filter(
                      (q) => q.section === (label as Question['section'])
                    ).length;
                    const cur2 = tsForm.config?.[sec] ?? config[sec];
                    return (
                      <div
                        key={sec}
                        className="cfg-row"
                        style={{ marginBottom: 6 }}
                      >
                        <div className="cfg-left">
                          <span
                            className={`asp ${
                              sec === 'science'
                                ? 'blue'
                                : sec === 'math'
                                ? 'purple'
                                : 'green'
                            }`}
                          >
                            {label}
                          </span>
                          <span className="cfg-avail">{avail} in bank</span>
                        </div>
                        <div className="cfg-right">
                          <button
                            className="cfg-btn"
                            onClick={() => setTsCfg(sec, Math.max(0, cur2 - 5))}
                          >
                            −5
                          </button>
                          <button
                            className="cfg-btn"
                            onClick={() => setTsCfg(sec, Math.max(0, cur2 - 1))}
                          >
                            −1
                          </button>
                          <div className="cfg-val">{cur2}</div>
                          <button
                            className="cfg-btn"
                            onClick={() =>
                              setTsCfg(sec, Math.min(avail, cur2 + 1))
                            }
                          >
                            +1
                          </button>
                          <button
                            className="cfg-btn"
                            onClick={() =>
                              setTsCfg(sec, Math.min(avail, cur2 + 5))
                            }
                          >
                            +5
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {tsForm.type === 'exam' && (
                  <div
                    style={{
                      background: '#131e30',
                      borderRadius: 10,
                      padding: '1rem',
                      marginBottom: '.9rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginBottom: 10,
                      }}
                    >
                      <div className="fl" style={{ margin: 0 }}>
                        Section Time Limits
                      </div>
                      <button
                        className={`nfb${
                          tsForm.timeLimits?.enabled ? ' nfa' : ''
                        }`}
                        onClick={() =>
                          setTsTl('enabled', !tsForm.timeLimits?.enabled)
                        }
                      >
                        {tsForm.timeLimits?.enabled ? '✓ Enabled' : 'Disabled'}
                      </button>
                    </div>
                    {tsForm.timeLimits?.enabled && (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr',
                          gap: 8,
                        }}
                      >
                        {(['science', 'math', 'english'] as const).map(
                          (sec) => {
                            const label =
                              sec.charAt(0).toUpperCase() + sec.slice(1);
                            const val =
                              (tsForm.timeLimits?.[
                                sec as keyof SectionTimeLimits
                              ] as number) ??
                              DEFAULT_TIME_LIMITS[
                                sec as keyof SectionTimeLimits
                              ];
                            return (
                              <div
                                key={sec}
                                style={{
                                  background: '#0e1a2e',
                                  borderRadius: 8,
                                  padding: '.65rem',
                                  textAlign: 'center',
                                }}
                              >
                                <div className="fl" style={{ marginBottom: 6 }}>
                                  {label} (min)
                                </div>
                                <div
                                  style={{
                                    display: 'flex',
                                    gap: 4,
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                  }}
                                >
                                  <button
                                    className="cfg-btn"
                                    style={{
                                      width: 24,
                                      height: 24,
                                      fontSize: '.7rem',
                                    }}
                                    onClick={() =>
                                      setTsTl(
                                        sec as keyof SectionTimeLimits,
                                        Math.max(5, (val as number) - 5)
                                      )
                                    }
                                  >
                                    −
                                  </button>
                                  <div
                                    className="cfg-val"
                                    style={{ minWidth: 36, fontSize: '1.1rem' }}
                                  >
                                    {val as number}
                                  </div>
                                  <button
                                    className="cfg-btn"
                                    style={{
                                      width: 24,
                                      height: 24,
                                      fontSize: '.7rem',
                                    }}
                                    onClick={() =>
                                      setTsTl(
                                        sec as keyof SectionTimeLimits,
                                        Math.min(120, (val as number) + 5)
                                      )
                                    }
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className="btn-prim"
                    style={{ flex: 1 }}
                    onClick={saveSet}
                  >
                    {testSets.find((t) => t.id === editingSet.id)
                      ? 'Save Changes'
                      : 'Create Test Set'}
                  </button>
                  <button
                    className="btn-out"
                    onClick={() => setEditingSet(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'settings' && (
          <div className="adm-box">
            <h3
              style={{
                color: '#f1f5f9',
                marginBottom: '.4rem',
                fontSize: '1.05rem',
              }}
            >
              ⚙ Default Test Configuration
            </h3>
            <p
              style={{
                fontSize: '.78rem',
                color: '#64748b',
                marginBottom: '1.4rem',
              }}
            >
              Set the default number of questions per section for new test sets.
            </p>
            {(['science', 'math', 'english'] as const).map((sec) => {
              const label = sec.charAt(0).toUpperCase() + sec.slice(1);
              const available = questions.filter(
                (q) => q.section === (label as Question['section'])
              ).length;
              const colorClass =
                sec === 'science'
                  ? 'blue'
                  : sec === 'math'
                  ? 'purple'
                  : 'green';
              return (
                <div key={sec} className="cfg-row">
                  <div className="cfg-left">
                    <span className={`asp ${colorClass}`}>{label}</span>
                    <span className="cfg-avail">
                      {available} available in bank
                    </span>
                  </div>
                  <div className="cfg-right">
                    <button
                      className="cfg-btn"
                      onClick={() =>
                        setCfgEdit((c) => ({
                          ...c,
                          [sec]: Math.max(0, c[sec] - 5),
                        }))
                      }
                    >
                      −5
                    </button>
                    <button
                      className="cfg-btn"
                      onClick={() =>
                        setCfgEdit((c) => ({
                          ...c,
                          [sec]: Math.max(0, c[sec] - 1),
                        }))
                      }
                    >
                      −1
                    </button>
                    <div className="cfg-val">{cfgEdit[sec]}</div>
                    <button
                      className="cfg-btn"
                      onClick={() =>
                        setCfgEdit((c) => ({
                          ...c,
                          [sec]: Math.min(available, c[sec] + 1),
                        }))
                      }
                    >
                      +1
                    </button>
                    <button
                      className="cfg-btn"
                      onClick={() =>
                        setCfgEdit((c) => ({
                          ...c,
                          [sec]: Math.min(available, c[sec] + 5),
                        }))
                      }
                    >
                      +5
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="cfg-total">
              Total questions per test:{' '}
              <b style={{ color: '#60a5fa' }}>
                {cfgEdit.science + cfgEdit.math + cfgEdit.english}
              </b>
              &nbsp;· Total marks:{' '}
              <b style={{ color: '#4ade80' }}>
                {(cfgEdit.science + cfgEdit.math + cfgEdit.english) * 2}
              </b>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                className="btn-prim"
                style={{ flex: 1 }}
                onClick={() => {
                  setConfig(cfgEdit);
                  saveConfig(cfgEdit);
                  setMsg('Config saved ✓');
                  setTimeout(() => setMsg(''), 2500);
                }}
              >
                Save Default Config
              </button>
              <button
                className="btn-out"
                onClick={() => setCfgEdit({ ...DEFAULT_CONFIG })}
              >
                Reset to (50/30/20)
              </button>
            </div>

            <div
              style={{
                marginTop: '1.5rem',
                background: FB_CONFIGURED ? '#0d2b1e' : '#1a1200',
                border: `1px solid ${FB_CONFIGURED ? '#166534' : '#92400e'}`,
                borderRadius: 10,
                padding: '1.1rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: '.7rem',
                }}
              >
                <span style={{ fontSize: '1.1rem' }}>
                  {FB_CONFIGURED ? '🔥' : '⚙️'}
                </span>
                <b
                  style={{
                    color: FB_CONFIGURED ? '#4ade80' : '#fbbf24',
                    fontSize: '.9rem',
                  }}
                >
                  {FB_CONFIGURED
                    ? 'Firebase Connected ✓'
                    : 'Firebase Setup — Enable Shared Leaderboard'}
                </b>
              </div>
              {!FB_CONFIGURED ? (
                <div
                  style={{
                    fontSize: '.78rem',
                    color: '#94a3b8',
                    lineHeight: 1.7,
                  }}
                >
                  <b style={{ color: '#f1f5f9' }}>
                    Steps to enable real-time data across all devices:
                  </b>
                  <br />
                  1. Go to{' '}
                  <a
                    href="https://console.firebase.google.com"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#60a5fa' }}
                  >
                    console.firebase.google.com
                  </a>
                  <br />
                  2. Click <b style={{ color: '#f1f5f9' }}>"Add project"</b> →
                  name it "ddcet-test" → Create
                  <br />
                  3. Click{' '}
                  <b style={{ color: '#f1f5f9' }}>"Firestore Database"</b> →
                  Create database → Start in test mode
                  <br />
                  4. Go to <b style={{ color: '#f1f5f9' }}>
                    Project Settings
                  </b>{' '}
                  → "Your apps" → Web icon → Register app
                  <br />
                  5. Copy the <code>firebaseConfig</code> object
                  <br />
                  6. Open <b style={{ color: '#f1f5f9' }}>App.tsx</b> → find{' '}
                  <code>FB_CONFIG</code> at top → paste your values → commit
                  <br />
                </div>
              ) : (
                <div style={{ fontSize: '.78rem', color: '#4ade80' }}>
                  All student scores are syncing to Firestore in real-time. View
                  data in the 📊 Data tab.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'data' && <DataViewer />}

        <div className="footer" style={{ marginTop: '2rem' }}>
          crafted by <span className="footer-aj">AJ</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// DATA VIEWER
// ═══════════════════════════════════════════════
function DataViewer() {
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'score' | 'date' | 'name'>('score');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadScoresRemote().then((s) => {
      setScores(s);
      setLoading(false);
    });
  }, []);

  const sorted = [...scores]
    .filter(
      (s) =>
        !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.college.toLowerCase().includes(search.toLowerCase()) ||
        (s.enrollment || '').toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'score') return b.score - a.score;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return b.date.localeCompare(a.date);
    });

  const clearAll = async () => {
    if (
      !window.confirm(
        'Delete ALL submission data permanently? This cannot be undone.'
      )
    )
      return;
    await clearScoresRemote();
    setScores([]);
  };

  const exportCSV = () => {
    const header =
      'Name,Enrollment,Branch,College,Score,MaxScore,%,Correct,Wrong,Skipped,Total,Science,Math,English,Time(min),Date';
    const rows = scores.map((s) =>
      [
        `"${s.name}"`,
        s.enrollment || '—',
        `"${s.branch}"`,
        `"${s.college}"`,
        s.score.toFixed(1),
        s.total * 2,
        Math.round((s.score / (s.total * 2)) * 100) + '%',
        s.correct,
        s.wrong,
        s.unattempted,
        s.total,
        `${(s.sciScore || 0).toFixed(1)}/${(s.sciTotal || 0) * 2}`,
        `${(s.mathScore || 0).toFixed(1)}/${(s.mathTotal || 0) * 2}`,
        `${(s.engScore || 0).toFixed(1)}/${(s.engTotal || 0) * 2}`,
        Math.floor(s.timeTaken / 60),
        s.date,
      ].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ddcet_results_${new Date()
      .toLocaleDateString('en-IN')
      .replace(/\//g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const rows = sorted
      .map((s, i) => {
        const pct = Math.round((s.score / (s.total * 2)) * 100);
        const color = pct >= 60 ? '#16a34a' : pct >= 40 ? '#ca8a04' : '#dc2626';
        const grade =
          pct >= 75
            ? 'A+'
            : pct >= 60
            ? 'A'
            : pct >= 45
            ? 'B'
            : pct >= 30
            ? 'C'
            : 'D';
        return `<tr style="border-bottom:1px solid #e5e7eb">
        <td style="padding:5px 6px;font-size:11px;color:#374151;text-align:center">${
          i + 1
        }</td>
        <td style="padding:5px 6px;font-size:11px;font-weight:600;color:#111">${
          s.name
        }</td>
        <td style="padding:5px 6px;font-size:10px;color:#6b7280">${
          s.enrollment || '—'
        }</td>
        <td style="padding:5px 6px;font-size:10px;color:#6b7280">${s.branch
          .split(' ')
          .slice(0, 2)
          .join(' ')}</td>
        <td style="padding:5px 6px;font-size:10px;color:#6b7280">${
          s.college
        }</td>
        <td style="padding:5px 6px;font-size:11px;font-weight:700;color:#1d4ed8;text-align:center">${s.score.toFixed(
          1
        )}/${s.total * 2}</td>
        <td style="padding:5px 6px;font-size:11px;font-weight:700;color:${color};text-align:center">${pct}%</td>
        <td style="padding:5px 6px;font-size:10px;text-align:center;color:#16a34a">${
          s.correct
        }</td>
        <td style="padding:5px 6px;font-size:10px;text-align:center;color:#dc2626">${
          s.wrong
        }</td>
        <td style="padding:5px 6px;font-size:10px;text-align:center;color:#6b7280">${
          s.unattempted
        }</td>
        <td style="padding:5px 6px;font-size:10px;text-align:center;color:#1d4ed8">${(
          s.sciScore || 0
        ).toFixed(0)}</td>
        <td style="padding:5px 6px;font-size:10px;text-align:center;color:#7c3aed">${(
          s.mathScore || 0
        ).toFixed(0)}</td>
        <td style="padding:5px 6px;font-size:10px;text-align:center;color:#059669">${(
          s.engScore || 0
        ).toFixed(0)}</td>
        <td style="padding:5px 6px;font-size:10px;text-align:center;font-weight:700;color:${color}">${grade}</td>
        <td style="padding:5px 6px;font-size:10px;text-align:center;color:#6b7280">${Math.floor(
          s.timeTaken / 60
        )}m</td>
        <td style="padding:5px 6px;font-size:10px;color:#6b7280">${s.date}</td>
      </tr>`;
      })
      .join('');
    const total2 = scores.length;
    const avgPct2 = total2
      ? Math.round(
          scores.reduce((a, b) => a + (b.score / (b.total * 2)) * 100, 0) /
            total2
        )
      : 0;
    const passed2 = scores.filter(
      (s) => (s.score / (s.total * 2)) * 100 >= 40
    ).length;
    w.document
      .write(`<!DOCTYPE html><html><head><title>DDCET Score Report</title>
    <style>body{font-family:Arial,sans-serif;margin:0;padding:16px;font-size:12px}
    table{width:100%;border-collapse:collapse}th{background:#1e3a5f;color:#fff;padding:5px 6px;font-size:10px;text-align:left}
    tr:nth-child(even)td{background:#f9fafb}
    @media print{.no-print{display:none}}</style></head><body>
    <div style="text-align:center;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #1d4ed8">
      <h2 style="color:#1d4ed8;margin:0;font-size:18px">DDCET Mock Test — Score Report</h2>
      <p style="color:#6b7280;margin:3px 0;font-size:11px">Gujarat Technological University · Generated ${new Date().toLocaleDateString(
        'en-IN'
      )}</p>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:8px 14px;min-width:90px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#1d4ed8">${total2}</div><div style="font-size:10px;color:#6b7280">Total Students</div></div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:8px 14px;min-width:90px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#16a34a">${passed2}</div><div style="font-size:10px;color:#6b7280">Passed (≥40%)</div></div>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 14px;min-width:90px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#dc2626">${
          total2 - passed2
        }</div><div style="font-size:10px;color:#6b7280">Below 40%</div></div>
      <div style="background:#fefce8;border:1px solid #fef08a;border-radius:6px;padding:8px 14px;min-width:90px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#ca8a04">${avgPct2}%</div><div style="font-size:10px;color:#6b7280">Average %</div></div>
    </div>
    <table><thead><tr>
      <th>#</th><th>Name</th><th>Enroll.</th><th>Branch</th><th>College</th>
      <th>Score</th><th>%</th><th>✓</th><th>✗</th><th>Skip</th>
      <th>Sci</th><th>Math</th><th>Eng</th><th>Grade</th><th>Time</th><th>Date</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div class="no-print" style="text-align:center;margin-top:16px">
      <button onclick="window.print()" style="background:#1d4ed8;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer">🖨 Print / Save as PDF</button>
    </div>
    <p style="text-align:center;font-size:10px;color:#9ca3af;margin-top:14px">DDCET Mock Test Platform · crafted by AJ</p>
    </body></html>`);
    w.document.close();
  };

  const total = scores.length;
  const avgPct = total
    ? Math.round(
        scores.reduce((a, b) => a + (b.score / (b.total * 2)) * 100, 0) / total
      )
    : 0;
  const passed = scores.filter(
    (s) => (s.score / (s.total * 2)) * 100 >= 40
  ).length;
  const branches = Object.entries(
    scores.reduce((acc, s) => {
      acc[s.branch] = (acc[s.branch] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="adm-box">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <h3 style={{ color: '#f1f5f9', fontSize: '1.05rem', flex: 1 }}>
          📊 Submission Data
        </h3>
        <button
          className="btn-out"
          style={{ fontSize: '.75rem', padding: '.35rem .8rem' }}
          onClick={exportCSV}
          disabled={!scores.length}
        >
          ⬇ CSV
        </button>
        <button
          className="btn-out"
          style={{
            fontSize: '.75rem',
            padding: '.35rem .8rem',
            borderColor: '#7c3aed',
            color: '#a78bfa',
          }}
          onClick={exportPDF}
          disabled={!scores.length}
        >
          📄 PDF Report
        </button>
        <button
          className="btn-clr-lb"
          onClick={clearAll}
          disabled={!scores.length}
        >
          🗑 Clear All
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center' }}>
          <Dots />
        </div>
      ) : total === 0 ? (
        <div className="empty">
          No submissions yet. Share your test link with students!
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="dv-summary">
            <div className="dv-card">
              <div className="dv-val">{total}</div>
              <div className="dv-lbl">Total Attempts</div>
            </div>
            <div className="dv-card">
              <div className="dv-val" style={{ color: '#4ade80' }}>
                {passed}
              </div>
              <div className="dv-lbl">Passed (≥40%)</div>
            </div>
            <div className="dv-card">
              <div className="dv-val" style={{ color: '#f87171' }}>
                {total - passed}
              </div>
              <div className="dv-lbl">Below 40%</div>
            </div>
            <div className="dv-card">
              <div className="dv-val" style={{ color: '#fbbf24' }}>
                {avgPct}%
              </div>
              <div className="dv-lbl">Avg Score %</div>
            </div>
          </div>

          {/* Branch breakdown */}
          <div style={{ marginBottom: '1rem' }}>
            <div
              style={{
                fontSize: '.72rem',
                color: '#64748b',
                textTransform: 'uppercase',
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              By Branch
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {branches.map(([br, cnt]) => (
                <div
                  key={br}
                  style={{
                    background: '#131e30',
                    borderRadius: 6,
                    padding: '3px 10px',
                    fontSize: '.72rem',
                    color: '#94a3b8',
                  }}
                >
                  {br.split(' ')[0]} <b style={{ color: '#60a5fa' }}>{cnt}</b>
                </div>
              ))}
            </div>
          </div>

          {/* Search + sort */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: '.75rem',
              flexWrap: 'wrap',
            }}
          >
            <input
              className="fi"
              placeholder="🔍 Search name, enrollment, college..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            {(['score', 'date', 'name'] as const).map((s) => (
              <button
                key={s}
                className={`nfb${sortBy === s ? ' nfa' : ''}`}
                onClick={() => setSortBy(s)}
              >
                {s === 'score' ? 'Top Score' : s === 'date' ? 'Latest' : 'A-Z'}
              </button>
            ))}
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table className="dv-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Enroll.</th>
                  <th>Branch</th>
                  <th>College</th>
                  <th>Score</th>
                  <th>%</th>
                  <th>✓</th>
                  <th>✗</th>
                  <th>Skip</th>
                  <th style={{ color: '#60a5fa' }}>Sci</th>
                  <th style={{ color: '#a78bfa' }}>Math</th>
                  <th style={{ color: '#4ade80' }}>Eng</th>
                  <th>Time</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s, i) => {
                  const pct = Math.round((s.score / (s.total * 2)) * 100);
                  return (
                    <tr
                      key={i}
                      className={
                        pct >= 60 ? 'dv-pass' : pct >= 40 ? 'dv-avg' : 'dv-fail'
                      }
                    >
                      <td style={{ color: '#64748b' }}>{i + 1}</td>
                      <td style={{ color: '#f1f5f9', fontWeight: 600 }}>
                        {s.name}
                      </td>
                      <td style={{ color: '#94a3b8', fontSize: '.7rem' }}>
                        {s.enrollment || '—'}
                      </td>
                      <td style={{ color: '#94a3b8', fontSize: '.72rem' }}>
                        {s.branch.split(' ').slice(0, 2).join(' ')}
                      </td>
                      <td style={{ color: '#64748b', fontSize: '.72rem' }}>
                        {s.college !== '—' ? s.college : '—'}
                      </td>
                      <td style={{ color: '#60a5fa', fontWeight: 700 }}>
                        {s.score.toFixed(1)}
                      </td>
                      <td
                        style={{
                          color:
                            pct >= 60
                              ? '#4ade80'
                              : pct >= 40
                              ? '#fbbf24'
                              : '#f87171',
                          fontWeight: 700,
                        }}
                      >
                        {pct}%
                      </td>
                      <td style={{ color: '#4ade80' }}>{s.correct}</td>
                      <td style={{ color: '#f87171' }}>{s.wrong}</td>
                      <td style={{ color: '#94a3b8' }}>{s.unattempted}</td>
                      <td style={{ color: '#60a5fa', fontSize: '.72rem' }}>
                        {(s.sciScore || 0).toFixed(0)}/{(s.sciTotal || 0) * 2}
                      </td>
                      <td style={{ color: '#a78bfa', fontSize: '.72rem' }}>
                        {(s.mathScore || 0).toFixed(0)}/{(s.mathTotal || 0) * 2}
                      </td>
                      <td style={{ color: '#4ade80', fontSize: '.72rem' }}>
                        {(s.engScore || 0).toFixed(0)}/{(s.engTotal || 0) * 2}
                      </td>
                      <td style={{ color: '#64748b' }}>
                        {Math.floor(s.timeTaken / 60)}m
                      </td>
                      <td style={{ color: '#64748b', fontSize: '.7rem' }}>
                        {s.date}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: '.7rem', color: '#475569', marginTop: 8 }}>
            {FB_CONFIGURED
              ? '🔥 Data stored in Firebase — visible across all devices in real-time.'
              : '⚠ Local mode — data stored per-browser. Set up Firebase in Settings for shared data.'}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// QUESTION FORM
// ═══════════════════════════════════════════════
function QForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Question | null;
  onSave: (q: Question) => void;
  onCancel: () => void;
}) {
  const blankOptions: [string, string, string, string] = ['', '', '', ''];
  const [section, setSection] = useState<Question['section']>(
    initial?.section ?? 'Science'
  );
  const [text, setText] = useState(initial?.text ?? '');
  const [opts, setOpts] = useState<[string, string, string, string]>(
    initial
      ? ([...initial.options] as [string, string, string, string])
      : [...blankOptions]
  );
  const [answer, setAnswer] = useState(initial?.answer ?? 0);
  const [topic, setTopic] = useState(initial?.topic ?? '');
  const [explanation, setExplanation] = useState(initial?.explanation ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = () => {
    const e: Record<string, string> = {};
    if (!text.trim()) e.text = 'Question text is required';
    opts.forEach((o, i) => {
      if (!o.trim()) e[`o${i}`] = 'Required';
    });
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    const q: Question = {
      id: initial?.id ?? uid(),
      section,
      text: text.trim(),
      options: opts.map((o) => o.trim()) as [string, string, string, string],
      answer,
      ...(topic.trim() ? { topic: topic.trim() } : {}),
      ...(explanation.trim() ? { explanation: explanation.trim() } : {}),
    };
    onSave(q);
  };

  const setOpt = (i: number, val: string) => {
    setOpts((prev) => {
      const next = [...prev] as [string, string, string, string];
      next[i] = val;
      return next;
    });
  };

  // Suggested topics by section for quick-fill
  const topicSuggestions: Record<Question['section'], string[]> = {
    Science: [
      'Units & Measurement',
      'Classical Mechanics',
      'Electric Current',
      'Heat & Thermometry',
      'Wave Motion & Optics',
      'Chemical Reactions',
      'Acids, Bases & Salts',
      'Metals & Non-metals',
      'Environmental Science',
    ],
    Math: [
      'Matrices & Determinants',
      'Trigonometry',
      'Vectors',
      'Coordinate Geometry',
      'Functions & Limits',
      'Differentiation',
      'Integration',
      'Logarithm',
      'Statistics',
    ],
    English: [
      'Grammar',
      'Comprehension',
      'Theory of Communication',
      'Techniques of Writing',
      'Word Correction',
      'Sentence Correction',
    ],
  };

  return (
    <div className="adm-box">
      <h3
        style={{
          color: '#f1f5f9',
          marginBottom: '1.2rem',
          fontSize: '1.05rem',
        }}
      >
        {initial ? '✏ Edit Question' : '➕ Add New Question'}
      </h3>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginBottom: '.9rem',
        }}
      >
        <div>
          <label className="fl">Section *</label>
          <select
            className="fi"
            value={section}
            onChange={(e) => {
              setSection(e.target.value as Question['section']);
              setTopic('');
            }}
          >
            {SECTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="fl">Topic / Syllabus Point</label>
          <input
            className="fi"
            placeholder="e.g. Newton's Laws, Trigonometry..."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            list="topic-list"
          />
          <datalist id="topic-list">
            {topicSuggestions[section].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="fg">
        <label className="fl">Question Text *</label>
        <textarea
          className={`fi fi-ta${errors.text ? ' fi-e' : ''}`}
          rows={3}
          placeholder="Enter full question text..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {errors.text && <span className="fe">{errors.text}</span>}
      </div>

      <div className="fg">
        <label className="fl">
          Options * — click letter to mark correct answer
        </label>
        {opts.map((opt, i) => (
          <div key={i} className={`of-row${answer === i ? ' of-ok' : ''}`}>
            <button
              className={`of-rb${answer === i ? ' of-rb-on' : ''}`}
              onClick={() => setAnswer(i)}
            >
              {answer === i ? '✓' : ['A', 'B', 'C', 'D'][i]}
            </button>
            <input
              className={`fi${errors[`o${i}`] ? ' fi-e' : ''}`}
              placeholder={`Option ${['A', 'B', 'C', 'D'][i]}`}
              value={opt}
              onChange={(e) => setOpt(i, e.target.value)}
            />
          </div>
        ))}
        <div style={{ fontSize: '.72rem', color: '#4ade80', marginTop: 5 }}>
          Correct answer: Option {['A', 'B', 'C', 'D'][answer]}
        </div>
      </div>

      <div className="fg">
        <label className="fl">
          Explanation (optional — shown in Practice Mode)
        </label>
        <textarea
          className="fi fi-ta"
          rows={2}
          placeholder="Brief explanation of why this answer is correct..."
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
        />
        <span style={{ fontSize: '.68rem', color: '#475569' }}>
          Students see this after clicking "Show Answer" in Practice mode
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn-prim" style={{ flex: 1 }} onClick={submit}>
          {initial ? 'Save Changes' : 'Add Question'}
        </button>
        <button className="btn-out" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MINI COMPONENTS
// ═══════════════════════════════════════════════
function Pill({ c, children }: { c: string; children: ReactNode }) {
  return <span className={`pill ${c}`}>{children}</span>;
}
function Dots() {
  return (
    <div className="dots">
      <span />
      <span />
      <span />
    </div>
  );
}

// ═══════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════
function CSS() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Outfit:wght@300;400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Outfit',sans-serif;background:#060c18;color:#e2e8f0;-webkit-font-smoothing:antialiased;}
textarea,input,select,button{font-family:'Outfit',sans-serif;}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#060c18}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:3px}
code{font-size:.83em;background:#1e293b;padding:1px 6px;border-radius:4px;color:#a78bfa;}
.pg{min-height:100vh;padding:1.5rem;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.fl{display:block;font-size:.71rem;font-weight:700;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em;}
.fi{width:100%;background:#131e30;border:1.5px solid #1e2d45;border-radius:10px;padding:.6rem .9rem;color:#f1f5f9;font-size:.93rem;outline:none;transition:border-color .2s;}
.fi:focus{border-color:#3b82f6;}.fi-e{border-color:#ef4444!important;}.fe{font-size:.7rem;color:#ef4444;margin-top:3px;display:block;}
.fi-ta{resize:vertical;min-height:80px;}.fg{margin-bottom:.9rem;}
.btn-prim{width:100%;padding:.8rem;background:linear-gradient(135deg,#1d4ed8,#6d28d9);border:none;border-radius:12px;color:#fff;font-size:.95rem;font-weight:700;font-family:'Syne',sans-serif;cursor:pointer;transition:opacity .2s,transform .1s;}
.btn-prim:hover{opacity:.9;transform:translateY(-1px);}.btn-prim:disabled{opacity:.4;cursor:not-allowed;transform:none;}
.btn-out{padding:.72rem 1.3rem;background:transparent;border:1.5px solid #1e2d45;border-radius:12px;color:#94a3b8;font-size:.88rem;font-weight:600;cursor:pointer;transition:all .2s;white-space:nowrap;}
.btn-out:hover{border-color:#60a5fa;color:#60a5fa;}.w100{width:100%;}
.btn-ghost{width:100%;padding:.55rem;background:transparent;border:none;color:#475569;font-size:.8rem;cursor:pointer;margin-top:4px;}
.btn-ghost:hover{color:#94a3b8;}
.btn-bk{padding:.45rem .95rem;background:#131e30;border:1.5px solid #1e2d45;border-radius:8px;color:#94a3b8;font-size:.8rem;font-weight:600;cursor:pointer;transition:all .2s;white-space:nowrap;}
.btn-bk:hover{border-color:#60a5fa;color:#60a5fa;}
.divider{text-align:center;color:#1e2d45;font-size:.78rem;margin:.65rem 0;position:relative;}
.divider::before,.divider::after{content:"";position:absolute;top:50%;width:43%;height:1px;background:#131e30;}
.divider::before{left:0}.divider::after{right:0}
.sec-tag{font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 9px;border-radius:20px;display:inline-block;}
.sec-Science{background:#1e3a5f;color:#60a5fa;}.sec-Math{background:#2d1b4e;color:#a78bfa;}.sec-English{background:#14352a;color:#4ade80;}
.nfb{padding:3px 9px;border-radius:20px;border:1px solid #1e2d45;background:transparent;color:#64748b;font-size:.74rem;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;}
.nfa{border-color:#3b82f6;background:#132040;color:#60a5fa;}
.pill{padding:3px 9px;border-radius:20px;font-size:.71rem;font-weight:700;background:#131e30;}
.pill.green{color:#4ade80;}.pill.amber{color:#fbbf24;}.pill.gray{color:#94a3b8;}
.dots{display:flex;gap:6px;padding:2rem;}.dots span{width:8px;height:8px;border-radius:50%;background:#1e2d45;animation:ld .8s infinite;}
.dots span:nth-child(2){animation-delay:.2s;}.dots span:nth-child(3){animation-delay:.4s;}
@keyframes ld{0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
.empty{padding:2.5rem;text-align:center;color:#475569;font-size:.88rem;}
.home-pg{background:radial-gradient(ellipse at 12% 55%,#1e3a5f22,transparent 55%),radial-gradient(ellipse at 88% 15%,#4f1b7a18,transparent 55%),#060c18;padding:2rem 1.5rem;}
.home-grid{display:grid;grid-template-columns:1fr 1fr;gap:3rem;max-width:940px;width:100%;align-items:center;}
@media(max-width:680px){.home-grid{grid-template-columns:1fr;gap:2rem;}}
.brand-pill{display:inline-block;font-family:'Syne',sans-serif;font-size:.7rem;font-weight:800;color:#3b82f6;background:#132040;border-radius:6px;padding:3px 10px;letter-spacing:.12em;margin-bottom:1.1rem;}
.home-h1{font-family:'Syne',sans-serif;font-size:clamp(2.4rem,5.5vw,4rem);font-weight:800;line-height:.95;color:#f8fafc;margin-bottom:.7rem;}
.home-sub{font-size:.85rem;color:#64748b;line-height:1.6;margin-bottom:1.6rem;}
.info-pills{display:flex;gap:8px;margin-bottom:1.4rem;flex-wrap:wrap;}
.ipill{background:#0e1a2e;border:1px solid #1e2d45;border-radius:10px;padding:.55rem .9rem;text-align:center;min-width:70px;font-size:.67rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em;}
.ipill b{display:block;font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;color:#60a5fa;}
.dist-grid{display:flex;flex-direction:column;gap:6px;margin-bottom:1.3rem;}
.dist-row{display:flex;align-items:center;gap:8px;font-size:.75rem;}
.dist-bar{height:5px;border-radius:3px;min-width:3px;}
.mark-row{display:flex;gap:7px;}
.mk{flex:1;text-align:center;padding:.4rem;border-radius:8px;font-size:.73rem;font-weight:700;}
.mk.green{background:#0d2b1e;color:#4ade80;}.mk.red{background:#2d0a0a;color:#f87171;}.mk.gray{background:#131e30;color:#94a3b8;}
.form-card{background:#0e1a2e;border:1px solid #1e2d45;border-radius:20px;padding:1.9rem;box-shadow:0 30px 80px #00000070;}
.fc-h{font-family:'Syne',sans-serif;font-size:1.25rem;font-weight:800;color:#f1f5f9;margin-bottom:1.3rem;}
.btn-adm{padding:.5rem;background:#131e30;border:1.5px solid #1e2d45;border-radius:8px;color:#94a3b8;font-size:.8rem;font-weight:600;cursor:pointer;transition:all .2s;}
.btn-adm:hover{border-color:#f59e0b;color:#f59e0b;}
.test-root{display:flex;flex-direction:column;height:100vh;overflow:hidden;background:#060c18;}
.t-hdr{background:#0a1120;border-bottom:1px solid #131e30;padding:.6rem 1.2rem;display:flex;align-items:center;gap:.75rem;flex-shrink:0;flex-wrap:wrap;}
.thdr-l{display:flex;align-items:center;gap:7px;}.thdr-m{display:flex;gap:5px;flex:1;flex-wrap:wrap;}.thdr-r{display:flex;align-items:center;gap:7px;margin-left:auto;}
.t-logo{font-family:'Syne',sans-serif;font-weight:800;font-size:.95rem;color:#60a5fa;}
.t-name{font-size:.8rem;color:#e2e8f0;font-weight:600;}.t-branch{font-size:.7rem;color:#64748b;background:#131e30;border-radius:20px;padding:2px 8px;}
.timer{font-family:'Syne',sans-serif;font-size:.97rem;font-weight:700;padding:4px 13px;border-radius:8px;min-width:76px;text-align:center;}
.t-ok{background:#0d2b1e;color:#4ade80;}.t-warn{background:#2d1800;color:#fbbf24;animation:pu .9s infinite;}.t-danger{background:#2d0a0a;color:#f87171;animation:pu .45s infinite;}
@keyframes pu{0%,100%{opacity:1}50%{opacity:.5}}
.btn-tog{padding:.38rem .75rem;background:#131e30;border:1.5px solid #1e2d45;border-radius:7px;color:#94a3b8;font-size:.8rem;cursor:pointer;display:none;}
@media(max-width:900px){.btn-tog{display:inline-flex;}}
.btn-sub{padding:.42rem 1rem;background:#c81e1e;border:none;border-radius:8px;color:#fff;font-weight:700;font-size:.82rem;cursor:pointer;transition:opacity .2s;white-space:nowrap;}
.btn-sub:hover{opacity:.85;}
.prog{height:3px;background:#131e30;flex-shrink:0;}.prog-f{height:100%;background:linear-gradient(90deg,#1d4ed8,#7c3aed);transition:width .4s;}
.t-body{flex:1;display:flex;overflow:hidden;position:relative;}
.q-main{flex:1;overflow-y:auto;padding:1.8rem 1.5rem;max-width:740px;}
.q-meta-row{display:flex;align-items:center;gap:9px;margin-bottom:.75rem;}
.q-num{font-size:.7rem;color:#64748b;font-weight:700;background:#131e30;border-radius:20px;padding:2px 9px;}
.q-txt{font-size:1.03rem;font-weight:500;color:#f1f5f9;line-height:1.65;margin-bottom:1.3rem;}
.opts-col{display:flex;flex-direction:column;gap:8px;}
.opt{display:flex;align-items:center;gap:11px;padding:.78rem 1rem;background:#131e30;border:1.5px solid #1e2d45;border-radius:12px;cursor:pointer;text-align:left;transition:all .15s;}
.opt:hover{border-color:#3b82f6;background:#132040;}.opt-sel{border-color:#2563eb;background:#132040;}
.opt-l{width:27px;height:27px;border-radius:50%;background:#1e2d45;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;color:#94a3b8;flex-shrink:0;transition:all .15s;}
.opt-sel .opt-l{background:#1d4ed8;color:#fff;}
.opt-t{font-size:.9rem;color:#cbd5e1;}.opt-sel .opt-t{color:#f1f5f9;}
.q-foot{display:flex;justify-content:space-between;align-items:center;margin-top:1.4rem;padding-top:1.1rem;border-top:1px solid #131e30;flex-wrap:wrap;gap:8px;}
.btn-flag{padding:.42rem .9rem;border-radius:8px;border:1.5px solid;font-size:.78rem;font-weight:600;cursor:pointer;transition:all .2s;}
.fl-off{border-color:#1e2d45;background:transparent;color:#64748b;}.fl-on{border-color:#f59e0b;background:#2d1800;color:#fbbf24;}
.nav-r{display:flex;gap:7px;align-items:center;}
.btn-nav{padding:.42rem 1rem;background:#131e30;border:1.5px solid #1e2d45;border-radius:8px;color:#94a3b8;font-weight:600;cursor:pointer;font-size:.82rem;transition:all .2s;}
.btn-nav:hover:not(:disabled){border-color:#60a5fa;color:#60a5fa;}.btn-nav:disabled{opacity:.3;cursor:not-allowed;}
.btn-nav.prim{background:linear-gradient(135deg,#1d4ed8,#6d28d9);border-color:transparent;color:#fff;}
.btn-clr{padding:.38rem .75rem;background:transparent;border:1px solid #1e2d45;border-radius:7px;color:#64748b;font-size:.72rem;cursor:pointer;}
.btn-clr:hover{border-color:#ef4444;color:#f87171;}
.nav-panel{width:265px;background:#08111e;border-left:1px solid #131e30;display:flex;flex-direction:column;flex-shrink:0;overflow:hidden;}
@media(max-width:900px){.nav-panel{position:fixed;right:0;top:0;height:100%;z-index:200;transform:translateX(100%);transition:transform .3s;}.pan-open{transform:translateX(0)!important;}.ov{position:fixed;inset:0;background:#00000075;z-index:199;}}
.np-hdr{padding:.8rem 1rem;border-bottom:1px solid #131e30;display:flex;justify-content:space-between;align-items:center;}
.np-ttl{font-family:'Syne',sans-serif;font-size:.82rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;}
.np-cls{background:transparent;border:none;color:#64748b;font-size:1rem;cursor:pointer;padding:2px 5px;}
.np-flt{display:flex;gap:4px;flex-wrap:wrap;padding:.55rem .9rem;border-bottom:1px solid #131e30;}
.np-leg{display:flex;flex-wrap:wrap;gap:4px;padding:.45rem .9rem;border-bottom:1px solid #131e30;}
.lg{font-size:.6rem;font-weight:700;padding:2px 7px;border-radius:4px;}
.np-grid{flex:1;overflow-y:auto;padding:.7rem .9rem;display:grid;grid-template-columns:repeat(5,1fr);gap:4px;align-content:start;}
.chip{aspect-ratio:1;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:.67rem;font-weight:700;cursor:pointer;transition:all .15s;border:1.5px solid transparent;}
.chip-ans{background:#132040;border-color:#1d4ed8;color:#60a5fa;}.chip-flag{background:#2d1800;border-color:#d97706;color:#fbbf24;}
.chip-both{background:linear-gradient(135deg,#132040 50%,#2d1800 50%);border-color:#6d28d9;color:#c4b5fd;}
.chip-cur{background:#1e1040;border-color:#6d28d9;color:#c4b5fd;}.chip-none{background:#131e30;border-color:#1e2d45;color:#475569;}
.res-pg{background:radial-gradient(ellipse at 35% 25%,#1e3a5f1a,transparent 55%),#060c18;}
.res-card{background:#0e1a2e;border:1px solid #1e2d45;border-radius:22px;padding:2.1rem;box-shadow:0 40px 100px #00000070;width:100%;max-width:490px;}
.res-top{text-align:center;margin-bottom:1.4rem;}
.res-nm{font-family:'Syne',sans-serif;font-size:1.35rem;font-weight:800;color:#f1f5f9;margin-top:.3rem;}
.res-br{font-size:.75rem;color:#64748b;margin-top:3px;}
.ring-wrap{position:relative;width:140px;height:140px;margin:0 auto .9rem;}
.ring-in{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.ring-sc{font-family:'Syne',sans-serif;font-size:1.85rem;font-weight:800;color:#f1f5f9;}
.ring-tot{font-size:.68rem;color:#64748b;margin-top:-2px;}
.grade-bdg{font-size:.8rem;font-weight:700;border:1.5px solid;border-radius:20px;padding:3px 14px;width:max-content;margin:0 auto 1.4rem;display:flex;align-items:center;}
.res-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:1.4rem;}
.rg-cell{background:#131e30;border-radius:10px;padding:.8rem .4rem;text-align:center;}
.rg-v{font-family:'Syne',sans-serif;font-size:1.35rem;font-weight:800;}
.rg-l{font-size:.62rem;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-top:2px;}
.res-acts{display:flex;gap:9px;}.res-acts .btn-prim{margin:0;}
.lb-pg{background:#060c18;align-items:flex-start;padding:1.5rem;}
.lb-wrap{width:100%;max-width:840px;}
.lb-hdr-row{display:flex;align-items:center;gap:.9rem;margin-bottom:.9rem;flex-wrap:wrap;}
.lb-ttl{font-family:'Syne',sans-serif;font-size:1.45rem;font-weight:800;color:#f1f5f9;flex:1;}
.lb-cnt{font-size:.72rem;color:#64748b;background:#131e30;border-radius:20px;padding:3px 11px;}
.lb-flt{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:.9rem;}
.lb-tbl{background:#0e1a2e;border:1px solid #1e2d45;border-radius:16px;overflow:hidden;}
.lb-head{display:grid;grid-template-columns:46px 1fr 130px 65px 50px 90px;gap:.5rem;padding:.6rem 1.2rem;background:#131e30;font-size:.67rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;}
.lb-row{display:grid;grid-template-columns:46px 1fr 130px 65px 50px 90px;gap:.5rem;align-items:center;padding:.8rem 1.2rem;border-bottom:1px solid #0a111e;transition:background .15s;}
.lb-row:hover{background:#131e3022;}.lb-row:last-child{border-bottom:none;}
.lb-top{background:linear-gradient(90deg,#0d1f0d18,transparent);}
@media(max-width:580px){.lb-head,.lb-row{grid-template-columns:38px 1fr 55px 45px;}.lb-br,.lb-cws{display:none;}}
.lbr{font-family:'Syne',sans-serif;font-weight:800;font-size:.95rem;}
.lbr1{color:#fbbf24;}.lbr2{color:#94a3b8;}.lbr3{color:#f97316;}
.lb-nm{font-weight:600;color:#e2e8f0;font-size:.88rem;}.lb-cl{font-size:.67rem;color:#64748b;margin-top:1px;}
.lb-br{font-size:.73rem;color:#94a3b8;}
.lb-sc{font-family:'Syne',sans-serif;font-weight:800;font-size:1rem;color:#60a5fa;}
.lb-pc{font-weight:700;font-size:.82rem;}
.lb-cws{font-size:.7rem;display:flex;gap:4px;}
.adm-pg{background:#04090f;align-items:flex-start;justify-content:flex-start;padding:1.5rem;}
.adm-wrap{width:100%;max-width:960px;}
.adm-hdr{display:flex;align-items:center;gap:.9rem;margin-bottom:.6rem;flex-wrap:wrap;}
.adm-hl{display:flex;align-items:center;gap:9px;flex:1;flex-wrap:wrap;}
.adm-ttl{font-family:'Syne',sans-serif;font-size:1.25rem;font-weight:800;color:#f1f5f9;}
.save-ok{font-size:.75rem;color:#4ade80;background:#0d2b1e;border-radius:20px;padding:2px 10px;}
.adm-stats{display:flex;gap:5px;flex-wrap:wrap;}
.asp{font-size:.7rem;font-weight:700;border-radius:20px;padding:3px 9px;}
.asp.blue{background:#1e3a5f;color:#60a5fa;}.asp.purple{background:#2d1b4e;color:#a78bfa;}.asp.green{background:#14352a;color:#4ade80;}.asp.amber{background:#2d1800;color:#fbbf24;}
.adm-note{font-size:.77rem;color:#64748b;margin-bottom:.9rem;padding:.55rem .85rem;background:#0e1a2e;border-radius:8px;border:1px solid #131e30;}
.adm-note b{color:#e2e8f0;}
.tabs{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:1rem;}
.tab{padding:.48rem 1rem;border-radius:10px;border:1.5px solid #1e2d45;background:transparent;color:#64748b;font-size:.81rem;font-weight:600;cursor:pointer;transition:all .2s;}
.tab-a{border-color:#3b82f6;background:#132040;color:#60a5fa;}
.tab-d{border-color:#4a1515;color:#f87171;}.tab-d:hover{background:#2d0a0a;}
.adm-box{background:#0e1a2e;border:1px solid #1e2d45;border-radius:14px;padding:1.4rem;}
.adm-tb{display:flex;gap:8px;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;}
.ql-note{font-size:.72rem;color:#64748b;margin-bottom:.75rem;}
.ql{display:flex;flex-direction:column;gap:7px;max-height:62vh;overflow-y:auto;}
.ql-item{background:#131e30;border-radius:10px;padding:.85rem 1rem;border:1px solid #1e2d45;}
.ql-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.ql-opts{display:flex;flex-wrap:wrap;gap:5px;margin-top:.45rem;}
.ql-o{font-size:.7rem;color:#64748b;background:#0a111e;border-radius:5px;padding:2px 8px;}
.ql-ok{background:#0d2b1e;color:#4ade80;font-weight:700;}
.btn-ed{padding:2px 9px;border-radius:6px;background:#132040;border:1px solid #1d4ed8;color:#60a5fa;font-size:.7rem;font-weight:600;cursor:pointer;}
.btn-dl{padding:2px 7px;border-radius:6px;background:#2d0a0a;border:1px solid #7f1d1d;color:#f87171;font-size:.78rem;cursor:pointer;}
.of-row{display:flex;align-items:center;gap:8px;margin-bottom:7px;}
.of-rb{width:30px;height:30px;border-radius:50%;background:#131e30;border:1.5px solid #1e2d45;color:#64748b;font-weight:700;font-size:.75rem;cursor:pointer;flex-shrink:0;transition:all .2s;display:flex;align-items:center;justify-content:center;}
.of-rb-on{background:#0d2b1e;border-color:#4ade80;color:#4ade80;}
.of-ok .fi{border-color:#4ade80;}
.imp-guide{background:#131e30;border-radius:10px;padding:1.1rem;margin-bottom:.9rem;}
.imp-fmt{background:#08111e;border-radius:7px;padding:.6rem .9rem;margin-bottom:.65rem;font-size:.76rem;overflow-x:auto;}
.imp-ex{background:#08111e;border-radius:7px;padding:.6rem .9rem;margin-bottom:.6rem;font-size:.73rem;line-height:1.85;}
.imp-ta{width:100%;background:#131e30;border:1.5px solid #1e2d45;border-radius:10px;padding:.7rem .9rem;color:#f1f5f9;font-size:.8rem;outline:none;resize:vertical;transition:border-color .2s;}
.imp-ta:focus{border-color:#3b82f6;}
.imp-err{background:#2d0a0a;border:1px solid #7f1d1d;color:#f87171;border-radius:8px;padding:.6rem .85rem;font-size:.78rem;margin-top:7px;}
.imp-ok{background:#0d2b1e;border:1px solid #166534;color:#4ade80;border-radius:8px;padding:.6rem .85rem;font-size:.78rem;margin-top:7px;}
.cfg-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:1rem;background:#131e30;border-radius:10px;margin-bottom:8px;flex-wrap:wrap;}
.cfg-left{display:flex;align-items:center;gap:8px;}.cfg-avail{font-size:.72rem;color:#64748b;}
.cfg-right{display:flex;align-items:center;gap:5px;}
.cfg-btn{width:32px;height:32px;border-radius:7px;background:#0e1a2e;border:1.5px solid #1e2d45;color:#94a3b8;font-size:.85rem;font-weight:700;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;}
.cfg-btn:hover{border-color:#3b82f6;color:#60a5fa;}
.cfg-val{min-width:46px;text-align:center;font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:800;color:#f1f5f9;background:#0e1a2e;border-radius:8px;padding:4px 8px;border:1.5px solid #1e2d45;}
.cfg-total{margin-top:12px;padding:.75rem 1rem;background:#131e30;border-radius:8px;font-size:.85rem;color:#94a3b8;text-align:center;}
.footer{text-align:center;font-size:.72rem;color:#1e2d45;padding:.8rem;letter-spacing:.08em;text-transform:lowercase;}
.footer-aj{font-family:'Syne',sans-serif;font-weight:800;font-size:.85rem;background:linear-gradient(135deg,#3b82f6,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.fb-banner{padding:.65rem 1rem;border-radius:8px;font-size:.77rem;margin-bottom:.9rem;background:#2d1800;border:1px solid #92400e;color:#fbbf24;}
.fb-banner a{color:#fbbf24;font-weight:700;}
.fb-ok{background:#0d2b1e;border-color:#166534;color:#4ade80;}
.btn-clr-lb{padding:.35rem .8rem;background:#2d0a0a;border:1px solid #7f1d1d;border-radius:7px;color:#f87171;font-size:.73rem;font-weight:600;cursor:pointer;white-space:nowrap;}
.btn-clr-lb:hover{background:#3d0f0f;}
.lb-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:.9rem;}
.lbs-cell{background:#131e30;border-radius:10px;padding:.75rem .4rem;text-align:center;}
.lbs-v{font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:800;color:#f1f5f9;}
.lbs-l{font-size:.62rem;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-top:2px;}
@media(max-width:480px){.lb-stats{grid-template-columns:repeat(2,1fr);}}
.dv-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:1rem;}
.dv-card{background:#131e30;border-radius:10px;padding:.75rem .4rem;text-align:center;}
.dv-val{font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:800;color:#f1f5f9;}
.dv-lbl{font-size:.62rem;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-top:2px;}
@media(max-width:480px){.dv-summary{grid-template-columns:repeat(2,1fr);}}
.dv-table{width:100%;border-collapse:collapse;font-size:.75rem;}
.dv-table th{background:#131e30;color:#64748b;font-weight:700;text-transform:uppercase;font-size:.62rem;letter-spacing:.04em;padding:.5rem .6rem;text-align:left;white-space:nowrap;}
.dv-table td{padding:.55rem .6rem;border-bottom:1px solid #0a111e;white-space:nowrap;}
.dv-table tr:hover td{background:#131e3033;}
.dv-pass td:first-child{border-left:2px solid #4ade80;}
.dv-avg  td:first-child{border-left:2px solid #fbbf24;}
.dv-fail td:first-child{border-left:2px solid #f87171;}
/* ── Anti-cheat warning ── */
.cheat-warn{position:fixed;top:0;left:0;right:0;z-index:9999;background:#7f1d1d;color:#fecaca;text-align:center;padding:.55rem 1rem;font-size:.82rem;font-weight:600;cursor:pointer;border-bottom:2px solid #dc2626;}
/* ── Section breakdown bars (result) ── */
.sec-row{display:flex;align-items:center;gap:10px;margin-bottom:9px;flex-wrap:wrap;}
.sec-row-left{display:flex;align-items:center;gap:8px;min-width:160px;}
.sec-row-bar{display:flex;align-items:center;gap:8px;flex:1;min-width:140px;}
.sec-bar-bg{flex:1;height:7px;background:#131e30;border-radius:4px;overflow:hidden;}
.sec-bar-fill{height:100%;border-radius:4px;transition:width 1s ease;}
/* ── Answer Review ── */
.rev-item{background:#0e1a2e;border:1.5px solid #1e2d45;border-radius:12px;padding:1rem;}
.rev-ok{border-color:#166534;}.rev-wrong{border-color:#7f1d1d;}.rev-skip{border-color:#1e2d45;}
.rev-top{display:flex;align-items:center;gap:8px;margin-bottom:.6rem;flex-wrap:wrap;}
.rev-qnum{font-size:.7rem;color:#64748b;background:#131e30;border-radius:20px;padding:2px 8px;font-weight:700;}
.rev-status{font-size:.72rem;font-weight:700;padding:2px 9px;border-radius:20px;margin-left:auto;}
.rev-s-ok{background:#0d2b1e;color:#4ade80;}.rev-s-wrong{background:#2d0a0a;color:#f87171;}.rev-s-skip{background:#1e2d45;color:#94a3b8;}
.rev-qtxt{font-size:.9rem;color:#e2e8f0;line-height:1.6;margin-bottom:.75rem;}
.rev-opts{display:flex;flex-direction:column;gap:6px;}
.rev-opt{display:flex;align-items:center;gap:9px;padding:.5rem .8rem;border-radius:8px;background:#131e30;border:1px solid #1e2d45;font-size:.83rem;color:#94a3b8;}
.rev-opt-correct{background:#0d2b1e;border-color:#166534;color:#4ade80;}
.rev-opt-wrong{background:#2d0a0a;border-color:#7f1d1d;color:#f87171;}
.rev-ol{width:22px;height:22px;border-radius:50%;background:#1e2d45;display:flex;align-items:center;justify-content:center;font-size:.68rem;font-weight:700;flex-shrink:0;}
.rev-opt-correct .rev-ol{background:#166534;color:#4ade80;}
.rev-opt-wrong .rev-ol{background:#7f1d1d;color:#f87171;}
.rev-tag-ok{margin-left:auto;font-size:.67rem;font-weight:700;color:#4ade80;white-space:nowrap;}
.rev-tag-wrong{margin-left:auto;font-size:.67rem;font-weight:700;color:#f87171;white-space:nowrap;}
/* ── Test Set Cards ── */
.ts-card{background:#131e30;border:1.5px solid #1e2d45;border-radius:12px;padding:1rem;transition:border-color .2s;}
.ts-card:hover{border-color:#3b82f6;}
.ts-card-top{display:flex;align-items:flex-start;gap:10px;}
.practice-badge{background:#2d1b4e;color:#a78bfa;font-size:.67rem;font-weight:700;padding:2px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:.05em;}
/* ── Topic & Explanation ── */
.topic-inline{display:inline-block;font-size:.67rem;font-weight:700;color:#fbbf24;background:#2d1f00;border-radius:20px;padding:1px 8px;margin-top:4px;margin-left:4px;}
.topic-tag{display:inline-flex;align-items:center;gap:5px;background:#2d1f00;border:1px solid #92400e;border-radius:8px;padding:4px 10px;font-size:.78rem;color:#fbbf24;margin-bottom:4px;}
.ql-expl{font-size:.7rem;color:#64748b;background:#0e1a2e;border-radius:6px;padding:2px 8px;font-style:italic;}
.practice-explain{background:#0e1a2e;border:1.5px solid #1e3a5f;border-radius:10px;padding:.85rem 1rem;margin-top:.5rem;}
    `}</style>
  );
}
