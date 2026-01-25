'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { 
  RefreshCw, TrendingUp, Clock, Radio, Lock, Unlock, 
  Swords, Trophy, Dribbble, AlertCircle, Copy, Check, Search,
  Radar, AlertTriangle
} from 'lucide-react';

// --- CONSTANTS & HELPERS ---

const SPORTS = [
  { id: 'MMA', label: 'MMA', icon: <Swords size={16} /> },
  { id: 'NFL', label: 'NFL', icon: <Trophy size={16} /> },
  { id: 'Basketball', label: 'Basketball', icon: <Dribbble size={16} /> },
];

const normalizeKey = (str: string) => 
  str ? str.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

const formatTime = (isoString: string) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString('en-GB', { 
        weekday: 'short', hour: '2-digit', minute: '2-digit' 
    });
};

const formatPrice = (p: number) => (p && p > 1 ? p.toFixed(2) : '—');

// --- DATA GROUPING ENGINE (Unchanged) ---
const groupData = (data: any[]) => {
  const competitions: Record<string, any[]> = {};

  // 1. FRESHNESS SORT
  data.sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());

  data.forEach(row => {
    const compName = row.competition || 'Other';
    if (!competitions[compName]) competitions[compName] = [];
    
    // 2. DEDUP
    let market = competitions[compName].find(m => 
        m.id === row.market_id || 
        (m.name === row.event_name && Math.abs(new Date(m.start_time).getTime() - new Date(row.start_time).getTime()) < 3600000)
    );

    if (!market) {
        // STABLE KEY GENERATION
        const stableKey = `${row.event_name}_${row.start_time}`;

        market = {
            id: row.market_id,
            stable_key: stableKey,
            name: row.event_name,
            start_time: row.start_time,
            volume: row.volume,
            in_play: row.in_play,
            market_status: row.market_status,
            selections: []
        };
        competitions[compName].push(market);
    } else {
        if (market.id !== row.market_id) return;
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

  // 3. STABLE SORT
  Object.keys(competitions).forEach(key => {
      competitions[key].sort((a, b) => {
          if (a.in_play && !b.in_play) return -1;
          if (!a.in_play && b.in_play) return 1;
          const timeDiff = new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.name.localeCompare(b.name);
      });
      
      competitions[key].forEach(market => {
          market.selections.sort((a: any, b: any) => a.name.localeCompare(b.name));
      });
  });

  return competitions;
};

// --- MAIN PAGE COMPONENT ---

export default function Home() {
  const [activeSport, setActiveSport] = useState('Basketball');
  const [competitions, setCompetitions] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // PAYWALL STATE
  const [isPaid, setIsPaid] = useState(false);
  const [trialTimeLeft, setTrialTimeLeft] = useState<string>('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [copied, setCopied] = useState(false);
  
  // --- EFFECTS (Timers & Fetching) ---
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
                setTrialTimeLeft(`${h}h ${m}m remaining`);
            }
        } else {
            setTrialTimeLeft('');
        }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const paidStatus = typeof window !== 'undefined' && localStorage.getItem('paid') === 'true';
    const trialStart = typeof window !== 'undefined' ? localStorage.getItem('trial_start') : null;
    const isTrialValid = trialStart && (Date.now() - parseInt(trialStart) < 24 * 60 * 60 * 1000);
    setIsPaid(paidStatus || !!isTrialValid);
    supabase.from('app_events').insert({ 
        event: 'page_view',
        metadata: { 
            ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'bot',
            ref: typeof document !== 'undefined' ? document.referrer : ''
        }
    }).then(() => {});
  }, []);

  const handleUnlock = () => {
    setPaymentRef(`NBA-${Math.floor(1000 + Math.random() * 9000)}`);
    setShowPaymentModal(true);
  };
  const handleConfirmPayment = () => {
    localStorage.setItem('paid', 'true');
    setIsPaid(true);
    setShowPaymentModal(false);
  };
  const handleCopyLink = () => {
    navigator.clipboard.writeText("https://revolut.me/gerardq0w5");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const handleActivateTrial = () => {
    localStorage.setItem('trial_start', Date.now().toString());
    setIsPaid(true);
    setShowPaymentModal(false);
    supabase.from('app_events').insert({ event: 'trial_activated' }).then(() => {});
  };

  const SCOPE_MODE = process.env.NEXT_PUBLIC_SCOPE_MODE || "";
  const visibleSports = SCOPE_MODE.startsWith("NBA_PREMATCH_ML") 
    ? SPORTS.filter(s => s.id === 'Basketball' || s.id === 'MMA') 
    : SPORTS;

  useEffect(() => {
    if (SCOPE_MODE.startsWith("NBA_PREMATCH_ML") && activeSport !== 'Basketball' && activeSport !== 'MMA') {
      setActiveSport('Basketball');
    }
  }, []);

  const fetchPrices = async () => {
    const dbCutoff = new Date();
    dbCutoff.setHours(dbCutoff.getHours() - 24); 

    let { data, error } = await supabase
      .from('market_feed')
      .select('*')
      .eq('sport', activeSport)
      .gt('start_time', dbCutoff.toISOString())
      .order('start_time', { ascending: true });

    if (!error && data) {
      const now = new Date();
      const heartbeatCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const activeRows = data.filter((row: any) => {
        if (row.last_updated && new Date(row.last_updated) < heartbeatCutoff) return false;
        if (row.market_status === 'CLOSED' || row.market_status === 'SETTLED') return false;
        if (SCOPE_MODE.startsWith('NBA_PREMATCH_ML') && (row.in_play || new Date(row.start_time) <= now)) return false;
        return true; 
      });

      try {
          const grouped = groupData(activeRows);
          setCompetitions(grouped);
          const latestTs = activeRows.reduce((max: number, r: any) => {
              const ts = r.last_updated ? new Date(r.last_updated).getTime() : 0;
              return ts > max ? ts : max;
          }, 0);
          if (latestTs > 0) setLastUpdated(new Date(latestTs).toLocaleTimeString());
      } catch (e) { console.error(e); }
    }
    setLoading(false);
  };

  useEffect(() => {
    setCompetitions({});
    setLoading(true);
    fetchPrices();
    const interval = setInterval(fetchPrices, 1000); 
    return () => clearInterval(interval);
  }, [activeSport]);


  // --- RENDER ---
  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-300 font-sans selection:bg-blue-500/30 selection:text-blue-200">
      
      {/* HEADER SECTION */}
      <div className="sticky top-0 z-50 bg-[#0B1120]/95 backdrop-blur-md border-b border-slate-800 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 pt-4 pb-2">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
                
                {/* BRANDING */}
                <div className="flex items-center gap-3">
                    <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-2.5 rounded-xl border border-blue-400/20 shadow-lg shadow-blue-900/20">
                        <TrendingUp className="text-white" size={20} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col">
                        <span className="block text-xl font-bold text-white tracking-tight leading-none">
                            EdgeScanner
                        </span>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] uppercase font-bold text-yellow-400 tracking-widest bg-yellow-400/10 px-1.5 rounded border border-yellow-400/20">
                                PRO
                            </span>
                            {!isPaid && (
                                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                    <Lock size={10} /> Limited View
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                
                {/* CONTROLS */}
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="bg-[#161F32] px-3 py-1.5 rounded-lg border border-slate-700/50 flex items-center gap-2">
                        <Radar size={12} className="text-blue-400 animate-pulse" />
                        <span className="text-xs font-bold text-blue-100 uppercase tracking-wide">Live Scanner</span>
                    </div>

                    {trialTimeLeft && (
                        <div className="hidden md:flex flex-col items-end">
                             <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">
                                Trial Active
                            </span>
                             <span className="text-[10px] font-mono text-emerald-500/80">
                                {trialTimeLeft}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* SPORT TABS (Segmented Control Style) */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                {visibleSports.map((sport) => (
                    <button 
                        key={sport.id} 
                        onClick={() => setActiveSport(sport.id)} 
                        className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap border ${
                            activeSport === sport.id 
                                ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20' 
                                : 'bg-[#161F32] border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                        }`}
                    >
                        {sport.icon} {sport.label}
                    </button>
                ))}
            </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        
        {/* COMPACT SEARCH BAR */}
        <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input 
                type="text"
                placeholder="Search..." // Shortened for mobile
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#161F32] border border-slate-700 rounded-lg py-2.5 pl-9 pr-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600"
            />
        </div>

        {loading && Object.keys(competitions).length === 0 && (
            <div className="flex justify-center py-20">
                <RefreshCw size={40} className="animate-spin text-blue-500" />
            </div>
        )}

        {/* --- MAIN CONTENT (REFACTORED) --- */}
        {(() => { 
            let globalGameIndex = 0; 
            
            const filterMarkets = (markets: any[]) => markets.filter(m => 
                m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                m.selections.some((s: any) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
            );

            return (
                <div className="space-y-8">
                    {Object.entries(competitions).map(([compName, markets]) => {
                        const filtered = filterMarkets(markets);
                        if (filtered.length === 0) return null;

                        return (
                            <div key={compName}>
                                <h2 className="text-slate-400 font-bold text-xs uppercase tracking-widest mb-3 flex items-center gap-2 px-1">
                                    {compName}
                                </h2>
                                
                                <div className="space-y-3">
                                    {filtered.map((event: any) => {
                                        const isPaywalled = !isPaid && globalGameIndex >= 3;
                                        globalGameIndex++;
                                        
                                        return (
                                            <MarketCard 
                                                key={event.stable_key} 
                                                event={event} 
                                                activeSport={activeSport} 
                                                isPaid={isPaid} 
                                                isPaywalled={isPaywalled}
                                                onUnlock={handleUnlock}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        })()}
        
        {/* EMPTY STATE */}
        {Object.keys(competitions).length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-600">
                <AlertCircle size={48} className="mb-4 opacity-20" />
                <p className="text-lg font-medium">No active markets found for {activeSport}</p>
            </div>
        )}
      </div>

      {/* PAYMENT MODAL */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#161F32] border border-blue-500/30 rounded-xl p-6 max-w-sm w-full shadow-2xl space-y-5 relative">
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
                <div className="bg-[#0B1120] p-4 rounded-lg text-sm text-slate-300 space-y-3 border border-slate-800 opacity-80 hover:opacity-100 transition-opacity">
                    <div className="leading-relaxed">
                        <span className="font-bold text-white block mb-1">1) Pay £5 on Revolut:</span>
                        <div className="mb-2 bg-black/30 border border-slate-700/50 rounded px-2 py-1 inline-block">
                            <span className="text-xs text-slate-400 mr-2">Payment Ref:</span>
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
                        <span className="font-bold text-white block">2) Then DM @NBA_steamers</span>
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

// --- NEW TRADER-GRADE COMPONENTS ---

const ExchangeBox = ({ type, price }: { type: 'back' | 'lay'; price: number }) => (
  <div className={`flex flex-col items-center justify-center h-full w-full rounded-sm border ${
    type === 'back' 
      ? 'bg-blue-950/20 border-blue-900/30' 
      : 'bg-pink-950/20 border-pink-900/30'
  }`}>
    <span className={`text-[9px] font-bold uppercase leading-none mb-0.5 ${
      type === 'back' ? 'text-blue-500/70' : 'text-pink-500/70'
    }`}>
      {type === 'back' ? 'B' : 'L'}
    </span>
    <span className={`font-mono text-sm font-bold tracking-tighter ${
      type === 'back' ? 'text-blue-400' : 'text-pink-400'
    }`}>
      {formatPrice(price)}
    </span>
  </div>
);

const BookieBox = ({ label, price, isBest, hasEdge }: { label: string, price: number, isBest: boolean, hasEdge: boolean }) => {
  // Visual Logic:
  // 1. Edge = Green Background (Action Signal)
  // 2. Best Price = Yellow Border (Target Signal)
  // 3. Normal = Muted (Noise Reduction)
  
  let containerClass = "bg-slate-800/50 border-slate-700 text-slate-500";
  if (hasEdge) containerClass = "bg-emerald-600 border-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.2)]";
  else if (isBest) containerClass = "bg-slate-800 border-yellow-500/80 text-yellow-400";

  return (
    <div className={`flex flex-col items-center justify-center h-full w-full rounded border transition-all ${containerClass}`}>
      <span className={`text-[9px] font-bold uppercase leading-none mb-0.5 ${hasEdge ? 'text-emerald-100' : 'opacity-60'}`}>
        {label}
      </span>
      <span className="font-mono text-sm font-bold tracking-tighter">
        {formatPrice(price)}
      </span>
    </div>
  );
};

const RunnerRow = ({ runner, activeSport }: { runner: any, activeSport: string }) => {
  const books = [
    { name: 'Pin', p: runner.bookmakers.pinnacle },
    { name: activeSport === 'MMA' ? 'WH' : 'Lad', p: runner.bookmakers.ladbrokes },
    { name: 'PP', p: runner.bookmakers.paddypower }
  ];

  // Find Best Bookie
  const best = books.reduce((acc, curr) => (curr.p > 1.0 && curr.p > acc.p) ? curr : acc, { name: '', p: 0 });
  
  // Calc Edge
  let edge = 0;
  let hasEdge = false;
  let edgeColor = 'text-slate-600';

  if (runner.exchange.lay > 1.0 && best.p > 1.0) {
    edge = ((best.p / runner.exchange.lay) - 1) * 100;
    if (edge > 0.01) {
      hasEdge = true;
      edgeColor = 'text-emerald-400 font-bold';
    } else if (edge > -0.01) {
      edgeColor = 'text-amber-400';
    }
  }

  return (
    <div className="group border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors last:border-0">
      
      {/* === MOBILE LAYOUT (Stacked) === */}
      <div className="md:hidden py-2.5 px-3">
        {/* Header: Name + Edge Badge */}
        <div className="flex justify-between items-center mb-2">
          <span className="text-slate-200 font-medium text-sm truncate pr-2">{runner.name}</span>
          {edge !== 0 && (
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${hasEdge ? 'bg-emerald-500/10' : 'bg-slate-800'}`}>
              <span className={`font-mono text-xs ${edgeColor}`}>
                {edge > 0 ? '+' : ''}{edge.toFixed(1)}%
              </span>
            </div>
          )}
        </div>

        {/* Execution Grid: 5 Columns (2 Exchange, 3 Bookies) */}
        <div className="grid grid-cols-5 gap-1.5 h-11">
           {/* Exchange Group (Left) */}
           <div className="col-span-2 grid grid-cols-2 gap-px bg-slate-900 rounded border border-slate-800 overflow-hidden">
             <ExchangeBox type="back" price={runner.exchange.back} />
             <ExchangeBox type="lay" price={runner.exchange.lay} />
           </div>
           
           {/* Bookies Group (Right) */}
           <BookieBox label="PIN" price={runner.bookmakers.pinnacle} isBest={best.name === 'Pin'} hasEdge={best.name === 'Pin' && hasEdge} />
           <BookieBox label={activeSport === 'MMA' ? "WH" : "LAD"} price={runner.bookmakers.ladbrokes} isBest={best.name === (activeSport === 'MMA' ? "WH" : "Lad")} hasEdge={best.name === (activeSport === 'MMA' ? "WH" : "Lad") && hasEdge} />
           <BookieBox label="PP" price={runner.bookmakers.paddypower} isBest={best.name === 'PP'} hasEdge={best.name === 'PP' && hasEdge} />
        </div>
      </div>

      {/* === DESKTOP LAYOUT (Horizontal Terminal) === */}
      <div className="hidden md:grid grid-cols-12 items-center px-4 py-2 gap-4 h-14">
         {/* Name (Cols 1-4) */}
         <div className="col-span-4 flex items-center gap-2">
            <span className="text-slate-300 font-medium text-sm truncate">{runner.name}</span>
         </div>

         {/* Edge (Col 5) */}
         <div className="col-span-1 text-right">
             {edge !== 0 && <span className={`font-mono text-sm ${edgeColor}`}>{edge > 0 ? '+' : ''}{edge.toFixed(1)}%</span>}
         </div>

         {/* Exchange (Cols 6-8) */}
         <div className="col-span-3 grid grid-cols-2 gap-2 max-w-[140px] ml-auto">
            <ExchangeBox type="back" price={runner.exchange.back} />
            <ExchangeBox type="lay" price={runner.exchange.lay} />
         </div>

         {/* Bookies (Cols 9-12) */}
         <div className="col-span-4 grid grid-cols-3 gap-2">
            <BookieBox label="PIN" price={runner.bookmakers.pinnacle} isBest={best.name === 'Pin'} hasEdge={best.name === 'Pin' && hasEdge} />
            <BookieBox label={activeSport === 'MMA' ? "WH" : "LAD"} price={runner.bookmakers.ladbrokes} isBest={best.name === (activeSport === 'MMA' ? "WH" : "Lad")} hasEdge={best.name === (activeSport === 'MMA' ? "WH" : "Lad") && hasEdge} />
            <BookieBox label="PP" price={runner.bookmakers.paddypower} isBest={best.name === 'PP'} hasEdge={best.name === 'PP' && hasEdge} />
         </div>
      </div>
    </div>
  );
};

const MarketCard = ({ event, activeSport, isPaid, isPaywalled, onUnlock }: any) => {
    const isSuspended = event.market_status === 'SUSPENDED';
    const isInPlay = event.in_play;

    // Status Styling
    let statusBorder = 'border-slate-800';
    let statusBg = 'bg-[#161F32]';
    if (isSuspended) { statusBorder = 'border-amber-500/40'; statusBg = 'bg-amber-950/10'; }
    if (isInPlay) { statusBorder = 'border-red-500/40'; statusBg = 'bg-red-950/10'; }

    return (
        <div className={`relative rounded-lg border ${statusBorder} ${statusBg} overflow-hidden mb-3 shadow-sm`}>
            
            {/* Header Strip */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900/50 border-b border-slate-800">
                <div className="flex items-center gap-2">
                   {isInPlay && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                   <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      {isInPlay ? 'Live In-Play' : formatTime(event.start_time)}
                   </span>
                </div>
                {/* Desktop Headers (Hidden on Mobile) */}
                <div className="hidden md:flex gap-12 text-[10px] font-bold text-slate-600 uppercase tracking-widest mr-8">
                    <span>Edge</span>
                    <span className="mr-8">Exchange</span>
                    <span>Sportsbooks</span>
                </div>
            </div>

            {/* Runners List */}
            <div className={`bg-[#0f1522] ${isPaywalled ? 'blur-sm select-none opacity-50 pointer-events-none' : ''}`}>
                {event.selections?.map((runner: any) => (
                    <RunnerRow key={runner.id} runner={runner} activeSport={activeSport} />
                ))}
            </div>

            {/* Paywall Overlay */}
            {isPaywalled && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-[1px]">
                    <button 
                        onClick={onUnlock}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded shadow-lg border border-blue-400/50 flex items-center gap-2 transition-transform hover:scale-105"
                    >
                        <Lock size={12} className="text-yellow-400" />
                        Unlock Scanner
                    </button>
                </div>
            )}
        </div>
    );
};