'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { 
  RefreshCw, TrendingUp, Clock, Radio, Lock, Unlock, 
  Swords, Trophy, Dribbble, AlertCircle, Copy, Check, Search,
  Radar 
} from 'lucide-react';

const SPORTS = [
  { id: 'MMA', label: 'MMA', icon: <Swords size={16} /> },
  { id: 'NFL', label: 'NFL', icon: <Trophy size={16} /> },
  { id: 'Basketball', label: 'Basketball', icon: <Dribbble size={16} /> },
];

// HELPER: Normalize strings
const normalizeKey = (str: string) => 
  str ? str.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

// 🚨 DATA GROUPING ENGINE (With Stable Keys)
const groupData = (data: any[]) => {
  const competitions: Record<string, any[]> = {};

  // 1. FRESHNESS SORT: Process newest updates first to kill zombies
  data.sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());

  data.forEach(row => {
    const compName = row.competition || 'Other';
    if (!competitions[compName]) competitions[compName] = [];
    
    // 2. DEDUP: Find existing by ID or Fuzzy Name Match
    let market = competitions[compName].find(m => 
        m.id === row.market_id || 
        (m.name === row.event_name && Math.abs(new Date(m.start_time).getTime() - new Date(row.start_time).getTime()) < 3600000)
    );

    if (!market) {
        // 🛑 STABLE KEY GENERATION (The Fix for Jumping UI)
        const stableKey = `${row.event_name}_${row.start_time}`;

        market = {
            id: row.market_id,
            stable_key: stableKey, // <--- Used for React Keys
            name: row.event_name,
            start_time: row.start_time,
            volume: row.volume,
            in_play: row.in_play,
            market_status: row.market_status,
            selections: []
        };
        competitions[compName].push(market);
    } else {
        if (market.id !== row.market_id) return; // Ignore duplicate/zombie row
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

  // 3. STABLE SORT: Force strict order by Time -> Name
  Object.keys(competitions).forEach(key => {
      competitions[key].sort((a, b) => {
          // Rule 1: Live games first
          if (a.in_play && !b.in_play) return -1;
          if (!a.in_play && b.in_play) return 1;

          // Rule 2: Start Time (Soonest first)
          const timeDiff = new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
          if (timeDiff !== 0) return timeDiff;

          // Rule 3: Alphabetical (Tie-breaker)
          return a.name.localeCompare(b.name);
      });
      
      // Sort Selections A-Z
      competitions[key].forEach(market => {
          market.selections.sort((a: any, b: any) => a.name.localeCompare(b.name));
      });
  });

  return competitions;
};

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

  // --- REPLACED FETCHING LOGIC (Robust & Debuggable) ---
  useEffect(() => {
    let isMounted = true; // Prevents "zombie" updates

    const runFetch = async () => {
      // 1. Setup time window (24h back)
      const dbCutoff = new Date();
      dbCutoff.setHours(dbCutoff.getHours() - 24); 

      // console.log(`🚀 Fetching for ${activeSport}...`);

      // 2. Fetch from Supabase
      let { data, error } = await supabase
        .from('market_feed')
        .select('*')
        .eq('sport', activeSport)
        .gt('start_time', dbCutoff.toISOString())
        .order('start_time', { ascending: true });

      // 3. Safety Check: Did the user switch tabs while we were waiting?
      if (!isMounted) return; 

      if (error) {
          console.error("Supabase Error:", error);
          return;
      }

      if (data) {
        // DIAGNOSTIC LOGS: Use these in Console to debug empty screens
        console.log(`✅ RAW DATA for ${activeSport}:`, data.length, "rows"); 
        
        const now = new Date();
        const heartbeatCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // 4. Filter Logic
        const activeRows = data.filter((row: any) => {
            // Drop stale data (older than 24h)
            if (row.last_updated && new Date(row.last_updated) < heartbeatCutoff) return false;
            
            // Drop Closed/Settled markets
            if (row.market_status === 'CLOSED' || row.market_status === 'SETTLED') return false;

            // Strict NBA Mode Checks
            if (SCOPE_MODE.startsWith('NBA_PREMATCH_ML')) {
                // If the exchange says it's In-Play, hide it
                if (row.in_play) return false;

                // If start time was 6+ hours ago, hide it (likely finished)
                const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
                if (new Date(row.start_time).getTime() < sixHoursAgo) return false;
            }
            return true; 
        });

        console.log(`🛡️ FILTERED DATA for ${activeSport}:`, activeRows.length, "rows");

        try {
            const grouped = groupData(activeRows);
            setCompetitions(grouped);
            
            // Update "Last Updated" timestamp
            const latestTs = activeRows.reduce((max: number, r: any) => {
                const ts = r.last_updated ? new Date(r.last_updated).getTime() : 0;
                return ts > max ? ts : max;
            }, 0);
            if (latestTs > 0) setLastUpdated(new Date(latestTs).toLocaleTimeString());
        } catch (e) { console.error(e); }
      }
      setLoading(false);
    };

    // Reset state immediately when sport changes
    setCompetitions({});
    setLoading(true);
    
    runFetch(); 
    const interval = setInterval(runFetch, 2000); // Fetch every 2s

    return () => {
        isMounted = false; // Cleanup flag
        clearInterval(interval);
    };
  }, [activeSport]);
  // -----------------------------------------------------

  const formatTime = (isoString: string) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString('en-GB', { 
        weekday: 'short', hour: '2-digit', minute: '2-digit' 
    });
  };

  const formatPrice = (price: number | null) => {
      if (!price || price <= 1.0) return '—';
      return price.toFixed(2);
  };

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-300 font-sans selection:bg-blue-500/30 selection:text-blue-200">
      
      {/* HEADER SECTION */}
      <div className="sticky top-0 z-50 bg-[#0B1120]/95 backdrop-blur-md border-b border-slate-800 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 pt-4 pb-2">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-2 md:mb-4 gap-4">
                
                {/* BRANDING */}
                <div className="flex items-center gap-3">
                    <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-2.5 rounded-xl border border-blue-400/20 shadow-lg shadow-blue-900/20">
                        <TrendingUp className="text-white" size={20} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col">
                        <span className="block text-xl font-bold text-white tracking-tight leading-none">
                            EdgeCatcher
                        </span>
                        <div className="flex items-center gap-2 mt-0.5">
                            {/* GOLD PRO BADGE */}
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
                    {/* LIVE INDICATOR */}
                    <div className="bg-[#161F32] px-3 py-1.5 rounded-lg border border-slate-700/50 flex items-center gap-2">
                        <Radar size={12} className="text-blue-400 animate-pulse" />
                        <span className="text-xs font-bold text-blue-100 uppercase tracking-wide">Live Price Cather</span>
                    </div>

                    {/* FREE PASS STATUS */}
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

            {/* SPORT TABS */}
            <div className="flex gap-6 border-b border-transparent overflow-x-auto no-scrollbar touch-pan-x">
                {visibleSports.map((sport) => (
                    <button 
                        key={sport.id} 
                        onClick={() => setActiveSport(sport.id)} 
                        className={`flex items-center gap-2 pb-3 text-sm font-bold transition-all border-b-2 whitespace-nowrap ${
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

      <div className="max-w-7xl mx-auto px-4 py-4 md:py-6 space-y-6">
        
        {/* SEARCH BAR (REMOVED) */}

        {loading && Object.keys(competitions).length === 0 && (
            <div className="flex justify-center py-20">
                <RefreshCw size={40} className="animate-spin text-blue-500" />
            </div>
        )}

        {/* --- MAIN CONTENT (SCANNER ONLY) --- */}
        {(() => { 
            let globalGameIndex = 0; 
            
            const filterMarkets = (markets: any[]) => markets.filter(m => 
                m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                m.selections.some((s: any) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
            );

            // ============================================
            // MODE: SCANNER LIST (Detailed)
            // ============================================
            return (
                <div className="space-y-8">
                    {Object.entries(competitions).map(([compName, markets]) => {
                        const filtered = filterMarkets(markets);
                        if (filtered.length === 0) return null;

                        return (
                            <div key={compName}>
                                <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
                                    <span className="w-1 h-6 bg-blue-500 rounded-full"></span> {compName}
                                </h2>
                                <div className="space-y-4">
                                    {filtered.map((event: any) => {
                                        const isPaywalled = !isPaid && globalGameIndex >= 3;
                                        globalGameIndex++;
                                        
                                        const isSuspended = event.market_status === 'SUSPENDED';
                                        const isInPlay = event.in_play;
                                        let borderClass = 'border-slate-700/50';
                                        if (isSuspended) borderClass = 'border-yellow-500/50';
                                        else if (isInPlay) borderClass = 'border-red-500/50';

                                        return (
                                            // 🛑 STABLE KEY
                                            <div key={event.stable_key} className={`bg-[#161F32] border ${borderClass} rounded-xl overflow-hidden relative`}>
                                                <div className="bg-[#0f1522] px-3 py-3 md:px-4 border-b border-slate-800 flex justify-between items-center">
                                                    <h3 className="text-slate-200 font-bold text-sm">{event.name}</h3>
                                                    <div className="flex gap-2 text-xs text-slate-500">
                                                        {isInPlay ? <span className="text-red-500 font-bold">LIVE</span> : formatTime(event.start_time)}
                                                    </div>
                                                </div>
                                                
                                                <div className={`divide-y divide-slate-800 ${isPaywalled ? 'blur-sm select-none opacity-40 pointer-events-none' : ''}`}>
                                                    {event.selections?.map((runner: any) => {
                                                        
                                                        // RESTORED & FIXED VALUE LOGIC
                                                        let selectionBorder = "border-transparent";
                                                        let bestBookPrice = 0;
                                                        let bestBookName = "";
                                                        let valueText = null;

                                                        if (runner.exchange.lay > 1.0) {
                                                            const books = [
                                                                { name: 'Pin', p: runner.bookmakers.pinnacle },
                                                                { name: activeSport === 'MMA' ? 'WH' : 'Lad', p: runner.bookmakers.ladbrokes },
                                                                { name: 'PP', p: runner.bookmakers.paddypower }
                                                            ];

                                                            const best = books.reduce((acc, curr) => (curr.p > 1.0 && curr.p > acc.p) ? curr : acc, { name: '', p: 0 });
                                                            bestBookPrice = best.p;
                                                            bestBookName = best.name;

                                                            if (bestBookPrice > 1.0) {
                                                                // Formula: ((Bookie / Lay) - 1) * 100
                                                                const edge = ((bestBookPrice / runner.exchange.lay) - 1) * 100;
                                                                
                                                                // COLOR LOGIC: Green if > 0, Yellow if > -0.01, else Gray
                                                                let textColor = 'text-slate-500';
                                                                if (edge > 0.01) textColor = 'text-emerald-400';
                                                                else if (edge > -0.01) textColor = 'text-amber-400';
                                                                
                                                                const sign = edge > 0 ? '+' : '';

                                                                // ALWAYS SHOW TEXT (Even if negative)
                                                                valueText = (
                                                                     <span className="text-xs md:text-[10px] text-slate-500 mt-1 font-mono block">
                                                                         Best: <span className="text-slate-300 font-bold">{bestBookName} {bestBookPrice.toFixed(2)}</span> <span className={textColor}>({sign}{edge.toFixed(1)}%)</span>
                                                                     </span>
                                                                );

                                                                // STRICT BORDER LOGIC (Only highlights on actual opportunities)
                                                                if (edge > 0.01) {
                                                                    selectionBorder = "border-l-4 border-l-emerald-500 bg-emerald-500/5";
                                                                } else if (edge >= -0.01) {
                                                                    selectionBorder = "border-l-4 border-l-amber-500 bg-amber-500/5";
                                                                }
                                                            }
                                                        }

                                                        return (
                                                            <div key={runner.id} className={`flex flex-col md:flex-row md:items-center px-3 py-3 md:px-4 gap-4 md:gap-3 ${selectionBorder}`}>
                                                                {/* NAME */}
                                                                <div className="md:w-1/3 flex flex-col justify-center">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-white font-medium">{runner.name}</span>
                                                                    </div>
                                                                    {valueText}
                                                                </div>

                                                                {/* PRICES - STRICT GRID */}
                                                                <div className="flex flex-1 gap-2 md:gap-2 items-center justify-between md:justify-end overflow-hidden">
                                                                    {/* EXCHANGE GROUP */}
                                                                    <div className="flex gap-1 flex-none">
                                                                        <PriceBox label="BACK" price={runner.exchange.back} type="back" />
                                                                        <PriceBox label="LAY" price={runner.exchange.lay} type="lay" />
                                                                    </div>
                                                                    
                                                                    {/* DIVIDER */}
                                                                    <div className="w-px h-8 bg-slate-800 mx-1 flex-none"></div>

                                                                    {/* BOOKIES GROUP */}
                                                                    <div className="flex gap-1 flex-none">
                                                                        <BookieBox 
                                                                            label="PIN" 
                                                                            price={runner.bookmakers.pinnacle} 
                                                                            color="orange" 
                                                                            isBest={bestBookName === 'Pin'}
                                                                        />
                                                                        <BookieBox 
                                                                            label={activeSport === 'MMA' ? "WH" : "LAD"} 
                                                                            price={runner.bookmakers.ladbrokes} 
                                                                            color="red" 
                                                                            isBest={bestBookName === (activeSport === 'MMA' ? "WH" : "Lad")}
                                                                        />
                                                                        <BookieBox 
                                                                            label="PP" 
                                                                            price={runner.bookmakers.paddypower} 
                                                                            color="green" 
                                                                            isBest={bestBookName === 'PP'}
                                                                        />
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

      {/* PAYMENT MODAL (UNCHANGED) */}
      {showPaymentModal && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <div className="bg-[#161F32] border border-blue-500/30 rounded-xl p-6 max-w-sm w-full shadow-2xl space-y-5 relative">
      <div className="text-center space-y-1">
        <h3 className="text-white font-bold text-lg leading-tight">Unlock Full Catcher</h3>
        <p className="text-blue-400 font-mono font-bold text-lg">£25 / month</p>
      </div>
      
      <div className="w-full bg-emerald-600/20 text-emerald-400 font-bold py-3 rounded-lg border border-emerald-500/30 flex flex-col items-center justify-center gap-0.5">
        <span className="text-xs uppercase tracking-wider">Money Back Guarantee</span>
        <span className="text-[10px] opacity-90 font-medium">Make Money Month One or Your Money Back</span>
      </div>

      <div className="bg-[#0B1120] p-4 rounded-lg text-sm text-slate-300 space-y-4 border border-slate-800">
        <div className="leading-relaxed">
          <span className="font-bold text-white block mb-2 text-xs uppercase tracking-tight">Step 1: Secure Payment</span>
          <a 
            href="https://buy.stripe.com/7sY9ASeya3bT7i30sr6sw01" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex items-center justify-center w-full bg-[#635BFF] hover:bg-[#5851e5] text-white font-bold py-4 rounded-lg shadow-lg transition-all text-sm group"
          >
            Pay with Stripe
          </a>
          <div className="mt-3 flex items-center justify-between bg-black/30 border border-slate-700/50 rounded px-3 py-2">
            <span className="text-[10px] text-slate-500 font-bold uppercase">Payment Ref:</span>
            <span className="font-mono font-bold text-white">{paymentRef}</span>
          </div>
        </div>

        <div className="leading-relaxed border-t border-slate-800 pt-4">
          <span className="font-bold text-white block mb-2 text-xs uppercase tracking-tight">Step 2: Instant Activation</span>
          <a 
            href="https://t.me/exchange_steamers_bot" 
            target="_blank" 
            rel="noreferrer" 
            className="flex items-center justify-center w-full bg-[#229ED9] hover:bg-[#1e8ebc] text-white font-bold py-3 rounded-lg shadow-md transition-all text-xs"
          >
            Message @Exchange_Steamers_Bot to Unlock
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <button 
          onClick={handleConfirmPayment} 
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 rounded-lg w-full transition-all text-xs border border-slate-700"
        >
          I’VE PAID — REFRESH ACCESS
        </button>
        <button 
          onClick={() => setShowPaymentModal(false)} 
          className="text-slate-500 hover:text-white font-medium text-[10px] py-2 uppercase tracking-widest transition-colors mx-auto"
        >
          Not now
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
}

// --- STRICT & DISCIPLINED COMPONENTS ---

const PriceBox = ({ label, price, type }: any) => (
    <div className={`w-[52px] h-[48px] md:h-[44px] rounded flex flex-col items-center justify-center border flex-none ${type === 'back' ? 'bg-[#0f172a] border-blue-500/30' : 'bg-[#1a0f14] border-pink-500/40'}`}>
        <span className={`text-[10px] md:text-[9px] font-bold leading-none mb-0.5 uppercase ${type === 'back' ? 'text-blue-500' : 'text-pink-500'}`}>{label}</span>
        <span className={`text-sm font-bold leading-none ${type === 'back' ? 'text-blue-400' : 'text-pink-400'}`}>{price ? price.toFixed(2) : '—'}</span>
    </div>
);

const BookieBox = ({ label, price, color, isBest }: any) => {
    // 🎨 Improved Styling: Standardized widths + Glow for Best Price
    const gradients: any = {
        orange: 'from-orange-900/40 to-orange-950/40 border-orange-500/30 text-orange-200',
        red: 'from-red-900/40 to-red-950/40 border-red-500/30 text-red-200',
        green: 'from-emerald-900/40 to-emerald-950/40 border-emerald-500/30 text-emerald-200',
    };
    
    // Highlight logic: Bright border + lighter BG, NO SCALING to prevent layout shifts
    const activeStyle = isBest 
        ? `border-${color === 'orange' ? 'orange' : color === 'red' ? 'red' : 'emerald'}-400 bg-white/5 shadow-[0_0_10px_rgba(255,255,255,0.1)]`
        : 'opacity-60 grayscale-[0.5]';

    const baseStyle = gradients[color] || gradients.orange;

    return (
        <div className={`w-[52px] h-[48px] md:h-[44px] rounded flex flex-col items-center justify-center border transition-all flex-none bg-gradient-to-b ${baseStyle} ${activeStyle}`}>
            <span className="text-[10px] md:text-[9px] font-bold leading-none mb-0.5 uppercase opacity-90">{label}</span>
            <span className={`text-sm font-bold leading-none ${isBest ? 'text-white' : ''}`}>{price && price > 1 ? price.toFixed(2) : '—'}</span>
        </div>
    );
};

const PaywallOverlay = ({ onUnlock }: any) => (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-[2px]">
        <button 
            onClick={onUnlock}
            className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-4 py-2 rounded-lg shadow-xl border border-blue-400/50 flex items-center gap-2 hover:scale-105 transition-all"
        >
            <Lock size={12} className="text-yellow-400" />
            Unlock
        </button>
    </div>
);