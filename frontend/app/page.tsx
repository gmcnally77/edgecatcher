'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { 
  RefreshCw, TrendingUp, Clock, Radio, Lock, Unlock, 
  Swords, Trophy, Dribbble, AlertCircle, Copy, Check, Search 
} from 'lucide-react';
import SteamersPanel from '@/components/SteamersPanel';

// --- CONFIG ---
const STEAMER_TEST_MODE = false;
// --------------

const SPORTS = [
  { id: 'MMA', label: 'MMA', icon: <Swords size={16} /> },
  { id: 'NFL', label: 'NFL', icon: <Trophy size={16} /> },
  { id: 'Basketball', label: 'Basketball', icon: <Dribbble size={16} /> },
];

// HELPER: Equality checks
const areSetsEqual = (a: Set<string>, b: Set<string>) => 
  a.size === b.size && [...a].every(x => b.has(x));

const areMapsEqual = (a: Map<string, any>, b: Map<string, any>) =>
  a.size === b.size &&
  [...a].every(([k, v]) => JSON.stringify(b.get(k)) === JSON.stringify(v));

// HELPER: Normalize strings
const normalizeKey = (str: string) => 
  str ? str.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

const groupData = (data: any[]) => {
  const competitions: Record<string, any[]> = {};

  data.forEach(row => {
    const sportKey = row.sport || '';
    const isTwoWaySport = ['NFL', 'NBA', 'Basketball', 'MMA', 'American Football', 'UFC']
        .some(s => sportKey.includes(s));

    const participants = row.event_name 
        ? row.event_name.split(/\s+v\s+|\s+@\s+|\s+vs\.?\s+/i) 
        : [];

    if (isTwoWaySport && participants.length === 2) {
        const p1 = normalizeKey(participants[0]);
        const p2 = normalizeKey(participants[1]);
        const runner = normalizeKey(row.runner_name);

        if (runner !== p1 && runner !== p2) return; 
    }

    const compName = row.competition || 'Other';
    if (!competitions[compName]) competitions[compName] = [];
    
    let market = competitions[compName].find(m => m.id === row.market_id);
    if (!market) {
        market = {
            id: row.market_id,
            name: row.event_name,
            start_time: row.start_time,
            volume: row.volume,
            in_play: row.in_play,
            market_status: row.market_status,
            selections: []
        };
        competitions[compName].push(market);
    }

    market.selections.push({
        id: row.id,
        name: row.runner_name,
        exchange: {
            back: row.back_price,
            lay: row.lay_price
        },
        bookmakers: {
            pinnacle: row.price_pinnacle, 
            ladbrokes: row.price_bet365,
            paddypower: row.price_paddy
        }
    });
  });

  Object.keys(competitions).forEach(key => {
      competitions[key].forEach(market => {
          if (market.selections && market.selections.length > 0) {
              market.selections.sort((a: any, b: any) => {
                  const participants = market.name
                    ? market.name.split(/\s+v\s+|\s+@\s+|\s+vs\.?\s+/i)
                        .map((p: string) => normalizeKey(p))
                    : [];
                  
                  const keyA = normalizeKey(a.name);
                  const keyB = normalizeKey(b.name);
                  const idxA = participants.indexOf(keyA);
                  const idxB = participants.indexOf(keyB);

                  if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                  if (idxA !== -1) return -1;
                  if (idxB !== -1) return 1;
                  return a.name.localeCompare(b.name);
              });
          }
      });
      
      competitions[key].sort((a, b) => {
          const timeDiff = new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
          if (timeDiff !== 0) return timeDiff;
          const nameDiff = a.name.localeCompare(b.name);
          if (nameDiff !== 0) return nameDiff;
          return a.id.localeCompare(b.id);
      });
  });

  return competitions;
};

export default function Home() {
  const [activeSport, setActiveSport] = useState('Basketball');
  const [competitions, setCompetitions] = useState<Record<string, any[]>>({});
  const [steamerEvents, setSteamerEvents] = useState<Set<string>>(new Set());
  const [steamerSignals, setSteamerSignals] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState(''); // NEW: Search State
  
  // PAYWALL STATE
  const [isPaid, setIsPaid] = useState(false);
  const [trialTimeLeft, setTrialTimeLeft] = useState<string>('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [copied, setCopied] = useState(false);
  
  // ... (Keep existing Paywall useEffects unchanged) ...
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

  // ... (Keep existing Paywall handlers unchanged) ...
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
  const STEAMERS_ONLY_ENABLED = (process.env.NEXT_PUBLIC_STEAMERS_ONLY || "0") === "1";

  const handleSteamersChange = useCallback(
    (newEvents: Set<string>, newSignals: Map<string, any>) => {
      setSteamerEvents(prev => areSetsEqual(prev, newEvents) ? prev : newEvents);
      setSteamerSignals(prev => areMapsEqual(prev, newSignals) ? prev : newSignals);
    }, 
    []
  );

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
      const heartbeatCutoff = new Date(now.getTime() - 300 * 1000); 

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
        <div className="max-w-7xl mx-auto px-4 pt-4">
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                    <div className="bg-blue-600/20 p-2 rounded-lg border border-blue-500/20">
                        <TrendingUp className="text-blue-500" size={20} />
                    </div>
                    <div className="flex flex-col">
                        <span className="block text-lg font-bold text-white leading-none">
                            NBA Scanner <span className="text-slate-500 text-sm ml-1">v2</span>
                        </span>
                    </div>
                    {!isPaid && (
                        <div className="ml-2 bg-red-500/10 border border-red-500/20 p-1.5 rounded text-red-400">
                            <Lock size={14} />
                        </div>
                    )}
                </div>
                <div className="flex flex-col items-end gap-1">
                    {trialTimeLeft && (
                        <span className="text-[10px] md:text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20 animate-pulse whitespace-nowrap">
                            Free Pass: {trialTimeLeft}
                        </span>
                    )}
                </div>
            </div>

            {/* SPORT TABS */}
            <div className="flex gap-6 border-b border-transparent overflow-x-auto no-scrollbar">
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

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        
        {/* LOGIC PROVIDER (Hidden) */}
        <SteamersPanel 
            activeSport={activeSport} 
            onSteamersChange={handleSteamersChange} 
        />

        {/* SEARCH BAR */}
        <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
                type="text"
                placeholder={`Find a ${activeSport === 'MMA' ? 'fight' : 'game'}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#161F32] border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
            />
        </div>

        {loading && Object.keys(competitions).length === 0 && (
            <div className="flex justify-center py-20">
                <RefreshCw size={40} className="animate-spin text-blue-500" />
            </div>
        )}

        {/* MAIN GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(() => { 
            let globalGameIndex = 0; 
            const allMarkets: any[] = [];
            
            // Flatten competitions into a single list for the grid
            Object.values(competitions).forEach(markets => {
                markets.forEach(m => allMarkets.push(m));
            });

            // Filter by Search
            const filteredMarkets = allMarkets.filter(m => 
                m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                m.selections.some((s: any) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
            );

            return filteredMarkets.map((event: any) => {
                const isPaywalled = !isPaid && globalGameIndex >= 3;
                globalGameIndex++;

                const isSuspended = event.market_status === 'SUSPENDED';
                const isInPlay = event.in_play;
                let borderClass = 'border-slate-800';
                if (isSuspended) borderClass = 'border-yellow-500/50';
                else if (isInPlay) borderClass = 'border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.1)]';

                return (
                    <div key={event.id} className={`bg-[#161F32] border ${borderClass} rounded-xl overflow-hidden relative group`}>
                        
                        {/* CARD HEADER */}
                        <div className="bg-[#0f1522] px-4 py-3 border-b border-slate-800 flex justify-between items-center">
                            <h3 className="text-slate-200 font-bold text-sm truncate flex-1 min-w-0 pr-2">
                                {event.name}
                            </h3>
                            <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                                {isInPlay && <span className="text-red-500 font-bold tracking-wider flex items-center gap-1"><Radio size={10} className="animate-pulse"/> IN PLAY</span>}
                                {!isInPlay && <span className="flex items-center gap-1"><Clock size={10}/> {formatTime(event.start_time)}</span>}
                                <span>Vol: £{event.volume?.toLocaleString()}</span>
                            </div>
                        </div>

                        {/* RUNNERS LIST */}
                        <div className={`p-4 space-y-3 ${isPaywalled ? 'blur-sm select-none opacity-40 pointer-events-none' : ''}`}>
                            {event.selections?.map((runner: any) => {
                                const signal = steamerSignals.get(runner.name);
                                
                                return (
                                    <div key={runner.id} className="flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-200 font-medium text-sm">{runner.name}</span>
                                            {/* BADGE: Only show if valid signal exists */}
                                            {signal && (
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                                    signal.label === 'STEAM' 
                                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                                }`}>
                                                    {signal.label}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex gap-2">
                                            {/* BACK */}
                                            <div className="w-16 h-10 bg-[#0f172a] border border-blue-500/30 rounded flex flex-col items-center justify-center">
                                                <span className="text-[7px] text-blue-500 uppercase font-bold leading-none mb-0.5">Back</span>
                                                <span className="text-sm font-bold text-blue-400 leading-none">{formatPrice(runner.exchange.back)}</span>
                                            </div>
                                            {/* LAY */}
                                            <div className="w-16 h-10 bg-[#1a0f14] border border-pink-500/40 rounded flex flex-col items-center justify-center">
                                                <span className="text-[7px] text-pink-500 uppercase font-bold leading-none mb-0.5">Lay</span>
                                                <span className="text-sm font-bold text-pink-400 leading-none">{formatPrice(runner.exchange.lay)}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* PAYWALL OVERLAY */}
                        {isPaywalled && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-[2px]">
                                <button 
                                    onClick={handleUnlock}
                                    className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-4 py-2 rounded-lg shadow-xl border border-blue-400/50 flex items-center gap-2 hover:scale-105 transition-all"
                                >
                                    <Lock size={12} className="text-yellow-400" />
                                    Unlock
                                </button>
                            </div>
                        )}
                    </div>
                );
            });
        })()}
        </div>
        
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