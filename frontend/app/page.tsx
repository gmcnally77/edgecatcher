'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { 
  TrendingUp, Lock, Swords, Trophy, Dribbble, AlertCircle, Radar, 
  Check, Copy 
} from 'lucide-react';

// --- CONFIG ---
const SPORTS = [
  { id: 'MMA', label: 'MMA', icon: <Swords size={14} /> },
  { id: 'NFL', label: 'NFL', icon: <Trophy size={14} /> },
  { id: 'Basketball', label: 'Basketball', icon: <Dribbble size={14} /> },
];

// --- HELPER: Data Grouping & Stability ---
const groupData = (data: any[]) => {
  const competitions: Record<string, any[]> = {};
  
  // Sort by freshness first
  data.sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());

  data.forEach(row => {
    const compName = row.competition || 'Other';
    if (!competitions[compName]) competitions[compName] = [];
    
    // Dedup / Find existing market
    let market = competitions[compName].find(m => 
        m.id === row.market_id || 
        (m.name === row.event_name && Math.abs(new Date(m.start_time).getTime() - new Date(row.start_time).getTime()) < 3600000)
    );

    if (!market) {
        // Stable key for React rendering
        market = {
            id: row.market_id,
            stable_key: `${row.event_name}_${row.start_time}`,
            name: row.event_name,
            start_time: row.start_time,
            volume: row.volume,
            in_play: row.in_play,
            market_status: row.market_status,
            selections: []
        };
        competitions[compName].push(market);
    } else if (market.id !== row.market_id) {
        return; // Skip duplicates
    }

    market.selections.push({
        id: row.id,
        name: row.runner_name,
        exchange: { back: row.back_price, lay: row.lay_price },
        bookmakers: {
            pinnacle: row.price_pinnacle, 
            ladbrokes: row.price_bet365,
            paddypower: row.price_paddy
        }
    });
  });

  // Sort competitions and markets
  Object.keys(competitions).forEach(key => {
      competitions[key].sort((a, b) => {
          if (a.in_play && !b.in_play) return -1;
          if (!a.in_play && b.in_play) return 1;
          const timeDiff = new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
          return timeDiff !== 0 ? timeDiff : a.name.localeCompare(b.name);
      });
      competitions[key].forEach(market => {
          market.selections.sort((a: any, b: any) => a.name.localeCompare(b.name));
      });
  });
  return competitions;
};

// --- COMPONENTS: Optimized for Mobile ---

const PriceBox = ({ label, price, type }: any) => (
    <div className={`w-[46px] h-[38px] rounded flex flex-col items-center justify-center border flex-none ${type === 'back' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-pink-500/10 border-pink-500/30'}`}>
        <span className={`text-[8px] font-bold leading-none mb-0.5 uppercase ${type === 'back' ? 'text-blue-400' : 'text-pink-400'}`}>{label}</span>
        <span className={`text-xs font-mono font-bold leading-none ${type === 'back' ? 'text-blue-300' : 'text-pink-300'}`}>{price ? price.toFixed(2) : '—'}</span>
    </div>
);

const BookieBox = ({ label, price, color, isBest }: any) => {
    const gradients: any = {
        orange: 'from-orange-950/40 to-orange-900/20 border-orange-500/30 text-orange-200',
        red: 'from-red-950/40 to-red-900/20 border-red-500/30 text-red-200',
        green: 'from-emerald-950/40 to-emerald-900/20 border-emerald-500/30 text-emerald-200',
    };
    const activeStyle = isBest 
        ? `border-${color === 'orange' ? 'orange' : color === 'red' ? 'red' : 'emerald'}-400/80 bg-white/5 ring-1 ring-inset ring-white/10`
        : 'opacity-40 grayscale-[0.5]';

    return (
        <div className={`w-[46px] h-[38px] rounded flex flex-col items-center justify-center border transition-all flex-none bg-gradient-to-b ${gradients[color] || gradients.orange} ${activeStyle}`}>
            <span className="text-[8px] font-bold leading-none mb-0.5 uppercase">{label}</span>
            <span className={`text-xs font-mono font-bold leading-none ${isBest ? 'text-white' : ''}`}>{price && price > 1 ? price.toFixed(2) : '—'}</span>
        </div>
    );
};

const PaywallOverlay = ({ onUnlock }: any) => (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-[2px]">
        <button onClick={onUnlock} className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-4 py-2 rounded-lg shadow-xl border border-blue-400/50 flex items-center gap-2 hover:scale-105 transition-all">
            <Lock size={12} className="text-yellow-400" /> Unlock
        </button>
    </div>
);

// --- MAIN PAGE ---

export default function Home() {
  const [activeSport, setActiveSport] = useState('Basketball');
  const [competitions, setCompetitions] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  
  // Auth/Payment State
  const [isPaid, setIsPaid] = useState(false);
  const [trialTimeLeft, setTrialTimeLeft] = useState<string>('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [copied, setCopied] = useState(false);

  // Environment Guard
  const SCOPE_MODE = process.env.NEXT_PUBLIC_SCOPE_MODE || "";
  const visibleSports = SCOPE_MODE.startsWith("NBA_PREMATCH_ML") 
    ? SPORTS.filter(s => s.id === 'Basketball' || s.id === 'MMA') 
    : SPORTS;

  // --- EFFECT: Trial Timer ---
  useEffect(() => {
    const timer = setInterval(() => {
        const start = typeof window !== 'undefined' ? localStorage.getItem('trial_start') : null;
        const paidPerm = typeof window !== 'undefined' && localStorage.getItem('paid') === 'true';
        
        if (start && !paidPerm) {
            const diff = (parseInt(start) + 24 * 60 * 60 * 1000) - Date.now();
            if (diff <= 0) {
                localStorage.removeItem('trial_start');
                setIsPaid(false);
                setTrialTimeLeft('');
            } else {
                const h = Math.floor(diff / 3600000);
                const m = Math.floor((diff % 3600000) / 60000);
                setTrialTimeLeft(`${h}h ${m}m`);
            }
        } else {
            setTrialTimeLeft('');
        }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // --- EFFECT: Initial Auth Check ---
  useEffect(() => {
    const paidStatus = typeof window !== 'undefined' && localStorage.getItem('paid') === 'true';
    const trialStart = typeof window !== 'undefined' ? localStorage.getItem('trial_start') : null;
    const isTrialValid = trialStart && (Date.now() - parseInt(trialStart) < 24 * 60 * 60 * 1000);
    setIsPaid(paidStatus || !!isTrialValid);
    
    // Auto-select sport based on scope
    if (SCOPE_MODE.startsWith("NBA_PREMATCH_ML") && activeSport !== 'Basketball' && activeSport !== 'MMA') {
      setActiveSport('Basketball');
    }
  }, []);

  // --- DATA FETCHING ---
  const fetchPrices = async () => {
    const dbCutoff = new Date();
    dbCutoff.setHours(dbCutoff.getHours() - 24); 

    let { data, error } = await supabase
      .from('market_feed')
      .select('*')
      .eq('sport', activeSport)
      .gt('start_time', dbCutoff.toISOString());

    if (!error && data) {
      const now = new Date();
      const activeRows = data.filter((row: any) => {
        if (row.market_status === 'CLOSED' || row.market_status === 'SETTLED') return false;
        if (SCOPE_MODE.startsWith('NBA_PREMATCH_ML') && (row.in_play || new Date(row.start_time) <= now)) return false;
        return true; 
      });
      setCompetitions(groupData(activeRows));
    }
    setLoading(false);
  };

  useEffect(() => {
    setCompetitions({});
    setLoading(true);
    fetchPrices();
    const interval = setInterval(fetchPrices, 5000); // 5s Refresh
    return () => clearInterval(interval);
  }, [activeSport]);

  // --- HANDLERS ---
  const handleUnlock = () => {
    setPaymentRef(`PRO-${Math.floor(1000 + Math.random() * 9000)}`);
    setShowPaymentModal(true);
  };

  const handleConfirmPayment = () => {
    localStorage.setItem('paid', 'true');
    setIsPaid(true);
    setShowPaymentModal(false);
  };

  const handleActivateTrial = () => {
    localStorage.setItem('trial_start', Date.now().toString());
    setIsPaid(true);
    setShowPaymentModal(false);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText("https://revolut.me/gerardq0w5");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (iso: string) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-GB', { 
        weekday: 'short', hour: '2-digit', minute: '2-digit' 
    });
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-300 font-sans">
      
      {/* HEADER: Condensed & Search Removed */}
      <div className="sticky top-0 z-50 bg-[#0B1120]/95 backdrop-blur-md border-b border-slate-800 shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-3">
            <div className="flex justify-between items-center mb-3">
                {/* Brand */}
                <div className="flex items-center gap-2">
                    <div className="bg-blue-600 p-1.5 rounded-lg shadow-lg shadow-blue-900/20">
                        <TrendingUp className="text-white" size={16} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-white tracking-tight leading-none">EdgeScanner</span>
                            <span className="text-[9px] font-bold text-yellow-400 bg-yellow-400/10 px-1.5 rounded border border-yellow-400/20">PRO</span>
                        </div>
                    </div>
                </div>

                {/* Status Indicator */}
                <div className="flex items-center gap-3">
                    {trialTimeLeft && (
                        <div className="hidden sm:flex flex-col items-end leading-none">
                             <span className="text-[9px] font-bold text-emerald-400 uppercase">Trial Active</span>
                             <span className="text-[10px] font-mono text-emerald-500/80">{trialTimeLeft}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 bg-[#161F32] px-2 py-1 rounded border border-slate-700/50">
                        <Radar size={12} className="text-blue-400 animate-pulse" />
                        <span className="text-[10px] font-bold text-blue-100 uppercase tracking-tight">Live</span>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-6 overflow-x-auto no-scrollbar border-b border-transparent">
                {visibleSports.map((sport) => (
                    <button 
                        key={sport.id} 
                        onClick={() => setActiveSport(sport.id)} 
                        className={`flex items-center gap-2 pb-2 text-xs font-bold transition-all border-b-2 whitespace-nowrap ${
                            activeSport === sport.id 
                                ? 'text-white border-blue-500' 
                                : 'text-slate-500 border-transparent hover:text-slate-300'
                        }`}
                    >
                        {sport.icon} {sport.label}
                    </button>
                ))}
            </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="max-w-7xl mx-auto px-4 py-4 space-y-6">
        
        {loading && Object.keys(competitions).length === 0 && (
            <div className="flex justify-center py-20">
                <Radar size={40} className="animate-spin text-blue-500 opacity-20" />
            </div>
        )}

        <div className="space-y-6">
            {Object.entries(competitions).map(([compName, markets], compIdx) => (
                <div key={compName}>
                    <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2 px-1">
                        <span className="w-1 h-4 bg-blue-500 rounded-full"></span> {compName}
                    </h2>
                    
                    <div className="space-y-3">
                        {markets.map((event: any, eventIdx: any) => {
                            // Paywall Logic: Free users see only 1st competition, first 2 games
                            const isPaywalled = !isPaid && (compIdx > 0 || eventIdx >= 2);
                            
                            return (
                                <div key={event.stable_key} className="bg-[#161F32] border border-slate-700/50 rounded-xl overflow-hidden relative shadow-sm">
                                    {/* Event Header */}
                                    <div className="bg-[#0f1522]/50 px-3 py-2 border-b border-slate-800 flex justify-between items-center">
                                        <h3 className="text-slate-300 font-bold text-[11px] truncate pr-4">{event.name}</h3>
                                        <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">
                                            {event.in_play ? <span className="text-red-500 font-bold">LIVE</span> : formatTime(event.start_time)}
                                        </span>
                                    </div>
                                    
                                    {/* Selections List */}
                                    <div className={`divide-y divide-slate-800/50 ${isPaywalled ? 'blur-md select-none opacity-40 pointer-events-none' : ''}`}>
                                        {event.selections?.map((runner: any) => {
                                            
                                            // Calculate Best Price & Edge
                                            const books = [
                                                { name: 'Pin', p: runner.bookmakers.pinnacle },
                                                { name: activeSport === 'MMA' ? 'WH' : 'Lad', p: runner.bookmakers.ladbrokes },
                                                { name: 'PP', p: runner.bookmakers.paddypower }
                                            ];
                                            const best = books.reduce((acc, curr) => (curr.p > 1.0 && curr.p > acc.p) ? curr : acc, { name: '', p: 0 });
                                            
                                            let edge = 0;
                                            if (runner.exchange.lay > 1.0 && best.p > 1.0) {
                                                edge = ((best.p / runner.exchange.lay) - 1) * 100;
                                            }

                                            // Row Styling
                                            const hasEdge = edge > 0.01;
                                            const rowHighlight = hasEdge ? 'border-l-2 border-emerald-500 bg-emerald-500/5' : 'border-l-2 border-transparent';

                                            return (
                                                <div key={runner.id} className={`flex items-center px-3 py-2 justify-between gap-2 ${rowHighlight}`}>
                                                    
                                                    {/* LEFT: Info */}
                                                    <div className="min-w-0 flex-1">
                                                        <span className="text-white text-[13px] font-bold truncate block">{runner.name}</span>
                                                        {best.p > 0 && (
                                                            <div className="mt-0.5 flex items-center gap-1.5">
                                                                <span className="text-[10px] text-slate-500 font-mono">
                                                                    Best: <span className="text-slate-300">{best.p.toFixed(2)}</span>
                                                                </span>
                                                                {/* Only show edge % if relevant */}
                                                                <span className={`text-[10px] font-mono ${edge > 0 ? 'text-emerald-400 font-bold' : 'text-slate-600'}`}>
                                                                    ({edge > 0 ? '+' : ''}{edge.toFixed(1)}%)
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* RIGHT: Compact Grid */}
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="flex gap-1">
                                                            <PriceBox label="B" price={runner.exchange.back} type="back" />
                                                            <PriceBox label="L" price={runner.exchange.lay} type="lay" />
                                                        </div>
                                                        
                                                        <div className="w-px h-6 bg-slate-800 mx-0.5" />

                                                        <div className="flex gap-1">
                                                            <BookieBox label="PIN" price={runner.bookmakers.pinnacle} color="orange" isBest={best.name === 'Pin'} />
                                                            <BookieBox label={activeSport === 'MMA' ? "WH" : "LAD"} price={runner.bookmakers.ladbrokes} color="red" isBest={best.name === (activeSport === 'MMA' ? 'WH' : 'Lad')} />
                                                            <BookieBox label="PP" price={runner.bookmakers.paddypower} color="green" isBest={best.name === 'PP'} />
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {isPaywalled && <PaywallOverlay onUnlock={handleUnlock} />}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>

        {/* Empty State */}
        {!loading && Object.keys(competitions).length === 0 && (
             <div className="flex flex-col items-center justify-center py-24 text-slate-600">
                <AlertCircle size={48} className="mb-4 opacity-20" />
                <p className="text-lg font-medium">No active markets found</p>
            </div>
        )}
      </div>

      {/* PAYMENT MODAL */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#161F32] border border-blue-500/30 rounded-xl p-6 max-w-sm w-full shadow-2xl space-y-5">
                <div className="text-center space-y-1">
                    <h3 className="text-white font-bold text-lg leading-tight">Unlock Full Scanner</h3>
                    <p className="text-blue-400 font-mono font-bold text-lg">£5 / week</p>
                </div>
                
                <button 
                    onClick={handleActivateTrial}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg shadow-lg border border-emerald-400/50 flex flex-col items-center justify-center gap-0.5 transition-all group"
                >
                    <span className="text-sm group-hover:scale-105 transition-transform">ACTIVATE 24H FREE PASS</span>
                    <span className="text-[10px] opacity-90 font-medium text-emerald-100">No payment needed. Instant access.</span>
                </button>

                <div className="flex items-center justify-center gap-2 py-1 opacity-60">
                    <div className="h-px bg-slate-700 w-8"></div>
                    <span className="text-[9px] uppercase text-slate-500 font-bold">OR PAY FOR LIFETIME</span>
                    <div className="h-px bg-slate-700 w-8"></div>
                </div>

                <div className="bg-[#0B1120] p-4 rounded-lg text-sm text-slate-300 space-y-3 border border-slate-800 opacity-80">
                    <div className="leading-relaxed">
                        <span className="font-bold text-white block mb-1">1) Pay £5 on Revolut:</span>
                        <div className="mb-2 bg-black/30 border border-slate-700/50 rounded px-2 py-1 inline-block">
                            <span className="text-xs text-slate-400 mr-2">Ref:</span>
                            <span className="font-mono font-bold text-white select-all">{paymentRef}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <a href="https://revolut.me/gerardq0w5" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline break-all font-mono">
                                revolut.me/gerardq0w5
                            </a>
                            <button onClick={handleCopyLink} className="bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 transition-all min-w-[60px] justify-center">
                                {copied ? <Check size={10} /> : <Copy size={10} />}
                                {copied ? "Copied" : "Copy"}
                            </button>
                        </div>
                    </div>
                    <div className="leading-relaxed">
                        <span className="font-bold text-white block">2) DM @NBA_steamers</span>
                        <a href="https://t.me/NBA_steamers" target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-center w-full bg-[#229ED9] hover:bg-[#1f8rbc] text-white font-bold py-3 rounded-lg shadow-md transition-all text-xs">
                            DM on Telegram
                        </a>
                    </div>
                </div>

                <div className="flex flex-col gap-3 pt-2">
                    <button onClick={handleConfirmPayment} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg w-full transition-all shadow-lg border border-blue-500/50">I’VE PAID — UNLOCK</button>
                    <button onClick={() => setShowPaymentModal(false)} className="text-slate-500 hover:text-white font-medium text-xs py-2 uppercase tracking-wide transition-colors">Not now</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}