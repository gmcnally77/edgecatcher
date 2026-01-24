'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { RefreshCw, TrendingUp, Clock, Radio, Lock, Unlock, Swords, Trophy, Dribbble, AlertCircle, Copy, Check } from 'lucide-react';
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
  const [activeSport, setActiveSport] = useState('Basketball'); // ✅ DEFAULT: BASKETBALL
  const [competitions, setCompetitions] = useState<Record<string, any[]>>({});
  const [steamerEvents, setSteamerEvents] = useState<Set<string>>(new Set());
  const [steamerSignals, setSteamerSignals] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  
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
    // Check local storage on mount
    const paidStatus = typeof window !== 'undefined' && localStorage.getItem('paid') === 'true';
    const trialStart = typeof window !== 'undefined' ? localStorage.getItem('trial_start') : null;
    
    // Check if trial is active (less than 24 hours old)
    const isTrialValid = trialStart && (Date.now() - parseInt(trialStart) < 24 * 60 * 60 * 1000);
    
    setIsPaid(paidStatus || !!isTrialValid);

    // 📊 TRACKING: Log Page View
    supabase.from('app_events').insert({ 
        event: 'page_view',
        metadata: { 
            ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'bot',
            ref: typeof document !== 'undefined' ? document.referrer : ''
        }
    }).then(() => {});
  }, []);

  const handleUnlock = () => {
    console.info("paywall_open");
    setPaymentRef(`NBA-${Math.floor(1000 + Math.random() * 9000)}`);
    setShowPaymentModal(true);
  };

  const handleConfirmPayment = () => {
    console.info("unlock_clicked");
    localStorage.setItem('paid', 'true');
    setIsPaid(true);
    setShowPaymentModal(false);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText("https://revolut.me/gerardq0w5");
    setCopied(true);
    console.info("revolut_copy");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleResetPaywall = () => {
    localStorage.removeItem('paid');
    localStorage.removeItem('trial_start');
    setIsPaid(false);
  };

  const handleActivateTrial = () => {
    console.info("trial_start");
    localStorage.setItem('trial_start', Date.now().toString());
    setIsPaid(true);
    setShowPaymentModal(false);
    // Non-blocking track
    supabase.from('app_events').insert({ event: 'trial_activated' }).then(() => {});
  };

  const SCOPE_MODE = process.env.NEXT_PUBLIC_SCOPE_MODE || "";
  const STEAMERS_ONLY_ENABLED = (process.env.NEXT_PUBLIC_STEAMERS_ONLY || "0") === "1";

  // STABLE CALLBACK
  const handleSteamersChange = useCallback(
    (newEvents: Set<string>, newSignals: Map<string, any>) => {
      setSteamerEvents(prev => 
        areSetsEqual(prev, newEvents) ? prev : newEvents
      );
      setSteamerSignals(prev => 
        areMapsEqual(prev, newSignals) ? prev : newSignals
      );
    }, 
    []
  );

  const visibleSports = SCOPE_MODE.startsWith("NBA_PREMATCH_ML") 
    ? SPORTS.filter(s => s.id === 'Basketball' || s.id === 'MMA') 
    : SPORTS;

  useEffect(() => {
    // Only force Basketball if not landing on a valid visible sport
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
      .order('start_time', { ascending: true })
      .order('event_name', { ascending: true })
      .order('market_id', { ascending: true });

    if (!error && data) {
      const now = new Date();
      // Relaxed heartbeat (60m)
      const heartbeatCutoff = new Date(now.getTime() - 3600 * 1000); 

      const activeRows = data.filter((row: any) => {
        if (row.last_updated && new Date(row.last_updated) < heartbeatCutoff) return false;
        if (row.market_status === 'CLOSED' || row.market_status === 'SETTLED') return false;
        
        // SCOPE GUARD: Strict Pre-match
        if (SCOPE_MODE.startsWith('NBA_PREMATCH_ML') && (row.in_play || new Date(row.start_time) <= now)) return false;
        
        return true; 
      });

      console.log("CORE_DIAG:", { 
          sport: activeSport, 
          raw: data.length, 
          filtered: activeRows.length, 
          steamers: steamerEvents.size,
          steamers_enabled: STEAMERS_ONLY_ENABLED
      });

      try {
          const grouped = groupData(activeRows);
          setCompetitions(grouped);
          
          // CALCULATE LAST API CALL: Find the most recent timestamp in the data
          const latestTs = activeRows.reduce((max: number, r: any) => {
              const ts = r.last_updated ? new Date(r.last_updated).getTime() : 0;
              return ts > max ? ts : max;
          }, 0);

          // Update UI with the actual data time (fallback to now if data is empty)
          if (latestTs > 0) {
              setLastUpdated(new Date(latestTs).toLocaleTimeString());
          } else {
              setLastUpdated(new Date().toLocaleTimeString());
          }
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
      
      <div className="sticky top-0 z-50 bg-[#0B1120]/95 backdrop-blur-md border-b border-slate-800 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 pt-4">
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                    <div className="bg-blue-600/20 p-2 rounded-lg border border-blue-500/20">
                        <TrendingUp className="text-blue-500" size={20} />
                    </div>
                    <div className="flex flex-col">
                        <span className="block text-lg font-bold text-white leading-none">
                            Pre-Match Steamers <span className="text-blue-500 text-xs ml-1 tracking-widest">(Daily)</span>
                        </span>
                    </div>
                    {!isPaid && (
                        <div className="ml-2 bg-red-500/10 border border-red-500/20 p-1.5 rounded text-red-400" title="Free Mode (Limited View)">
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
                    <span className="text-xs font-mono text-slate-500 hidden sm:block">UPDATED: {lastUpdated}</span>
                </div>
            </div>
            
            {/* SUB-LABEL */}
            <div className="mb-4 -mt-2 space-y-1">
                <p className="text-[10px] md:text-xs text-slate-300 font-medium tracking-wide">
                    Pre-match only · Moneyline · Best bookmaker price vs exchange
                </p>
                <p className="text-[10px] text-slate-500">
                    Tracking prices that are arbs versus 100% price.
                    <span className="block sm:inline sm:ml-2 text-slate-600 italic">Updated continuously until the off.</span>
                </p>
            </div>

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

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        
        <SteamersPanel 
            activeSport={activeSport} 
            onSteamersChange={handleSteamersChange} 
        />

        {loading && Object.keys(competitions).length === 0 && (
            <div className="flex justify-center py-20">
                <RefreshCw size={40} className="animate-spin text-blue-500" />
            </div>
        )}

        {/* PAYWALL: Initialize global index counter for rendered games */}
        {(() => { let globalGameIndex = 0; return Object.entries(competitions).map(([compName, markets]) => {
            const shouldFilter = (activeSport === 'Basketball') && STEAMERS_ONLY_ENABLED && steamerEvents.size > 0;
            
            const visibleMarkets = shouldFilter
                ? markets.filter((m: any) => steamerEvents.has(m.name))
                : markets;

            if (visibleMarkets.length === 0) return null;

            return (
            <div key={compName}>
                <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
                    <span className="w-1 h-6 bg-blue-500 rounded-full"></span> {compName}
                </h2>
                <div className="grid grid-cols-1 gap-4">
                    {visibleMarkets.map((event: any) => {
                        // PAYWALL LOGIC: Lock if index >= 3 and not paid
                        const isPaywalled = !isPaid && globalGameIndex >= 3;
                        globalGameIndex++; // Increment for next game

                        const isSuspended = event.market_status === 'SUSPENDED';
                        const isInPlay = event.in_play;
                        let borderClass = 'border-slate-700/50';
                        if (isSuspended) borderClass = 'border-yellow-500/50';
                        else if (isInPlay) borderClass = 'border-red-500/50';

                        return (
                        <div key={event.id} className="space-y-4">
                            {!isPaid && globalGameIndex === 4 && (
                                <div className="flex items-center gap-4 pt-2">
                                    <div className="h-px bg-slate-700 flex-1"></div>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                                        Free Preview — Full Access Below
                                    </span>
                                    <div className="h-px bg-slate-700 flex-1"></div>
                                </div>
                            )}
                        <div className={`bg-[#161F32] border ${borderClass} rounded-xl overflow-hidden hover:border-blue-500/30 transition-all min-h-[160px]`}>
                            <div className="bg-[#0f1522] px-4 py-3 border-b border-slate-800 flex justify-between items-center">
                                <h3 className="text-slate-200 font-bold text-sm truncate flex-1 min-w-0 pr-2">
                                    {event.name}
                                </h3>
                                <div className="flex items-center gap-2 text-slate-500 text-xs whitespace-nowrap">
                                    {isSuspended 
                                        ? <span className="flex gap-1 text-yellow-500 font-bold"><Lock size={12}/> SUSP</span> 
                                        : isInPlay 
                                            ? <span className="flex gap-1 text-red-500 font-bold"><Radio size={12}/> LIVE</span> 
                                            : <span className="flex gap-1"><Clock size={12}/> {formatTime(event.start_time)}</span>}
                                </div>
                            </div>

                            {/* EVENT SCROLL CONTAINER: Syncs scrolling for all runners */}
                            <div className={`divide-y divide-slate-800 overflow-x-auto no-scrollbar scrollbar-gutter-stable ${isSuspended ? 'opacity-50 pointer-events-none' : ''}`}>
                                {event.selections?.map((runner: any) => (
                                    <div key={runner.id} className="flex flex-col md:flex-row md:items-center px-4 py-3 gap-3 md:gap-4 hover:bg-slate-800/30 transition-colors w-full md:min-w-[600px]">
                                        {/* STICKY NAME COLUMN */}
                                        <div className="w-full md:w-auto md:flex-1 md:min-w-[120px] md:sticky md:left-0 relative z-0 md:z-10 bg-[#161F32] border-b md:border-b-0 md:border-r border-slate-800/50 pb-2 md:pb-0 pr-0 md:pr-4">
                                            <div className="flex items-center gap-2">
                                                <span className="text-white font-medium text-lg block leading-tight">
                                                    {runner.name}
                                                </span>
                                                
                                                {/* BADGE LOGIC */}
                                                {(() => {
                                                    const sigData = steamerSignals.get(runner.name);
                                                    if (!sigData) return null;

                                                    const now = Date.now();
                                                    const start = new Date(event.start_time).getTime();
                                                    const minsUntilStart = (start - now) / 60000;
                                                    
                                                    if (minsUntilStart < 10) return null;

                                                    // ✅ TEST MODE: 0 Volume requirement
                                                    const minVol = STEAMER_TEST_MODE ? 0 : 200;
                                                    if ((event.volume || 0) < minVol) return null;

                                                    const isSteam = sigData.label === 'STEAMER';
                                                    const arrow = isSteam ? '↑' : '↓';
                                                    const pct = Math.abs(sigData.pct * 100).toFixed(1);
                                                    
                                                    const baseStyle = "text-[9px] font-bold px-1.5 py-0.5 " +
                                                                    "rounded border flex items-center gap-1";
                                                    
                                                    const colorStyle = isSteam
                                                        ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                                                        : "bg-pink-500/20 text-pink-300 border-pink-500/30";

                                                    return (
                                                        <span className={`${baseStyle} ${colorStyle}`}>
                                                            <span>STEAM {arrow}</span>
                                                            <span className="opacity-80">|</span>
                                                            <span>{pct}%</span>
                                                        </span>
                                                    );
                                                })()}
                                            </div>

                                            {/* VALUE CALC: Best Book vs Exchange Mid (Gated >5% Spread) */}
                                            {(() => {
                                                const { back, lay } = runner.exchange;
                                                
                                                // GATE 1: Strict Liquidity (Must have both Back & Lay)
                                                if (!back || back <= 1.0 || !lay || lay <= 1.0) return null;

                                                const mid = (back + lay) / 2;
                                                const spreadPct = ((lay - back) / mid) * 100;

                                                // GATE 2: Max 5% Spread Allowed
                                                if (spreadPct > 5.0) return null;

                                                const books = [
                                                    { label: 'Pin', p: runner.bookmakers.pinnacle },
                                                    { label: 'Lad', p: runner.bookmakers.ladbrokes },
                                                    { label: 'PP', p: runner.bookmakers.paddypower }
                                                ];
                                                
                                                // Find best book (Max price > 1.0)
                                                const best = books.reduce((acc, curr) => (curr.p > 1.0 && curr.p > acc.p) ? curr : acc, { label: '', p: 0 });
                                                
                                                if (best.p <= 1.0) return null;

                                                const diff = ((best.p / mid) - 1) * 100;
                                                const sign = diff > 0 ? '+' : '';
                                                const diffColor = diff > 0 ? 'text-green-400' : 'text-slate-500';

                                                return (
                                                    <div className="text-[10px] text-slate-500 mt-1 font-mono leading-none">
                                                        Best: <span className="text-slate-300 font-bold">{best.label} {best.p.toFixed(2)}</span> <span className={diffColor}>({sign}{diff.toFixed(1)}% vs mid)</span>
                                                    </div>
                                                );
                                            })()}
                                        </div>

                                            {/* PRICE SECTION: PRO-TRADER RESPONSIVE UI */}
                                            <div className="w-full md:w-auto mt-3 md:mt-0">
                                                <div className={`flex flex-col md:flex-row md:items-center gap-2 ${isPaywalled ? 'blur-sm select-none opacity-40 pointer-events-none' : ''}`}>
                                                    
                                                    {/* DECK 1: THE EXCHANGE (Reference) */}
                                                    <div className="flex w-full md:w-auto gap-2">
                                                        {/* BACK */}
                                                        <div className="flex-1 md:w-[70px] h-[44px] md:h-[50px] rounded-lg bg-[#0f172a] border border-blue-500/30 flex flex-col justify-center items-center">
                                                            <span className="text-[9px] text-blue-500 font-bold uppercase tracking-wider">Back</span>
                                                            <span className="text-base md:text-lg font-mono font-bold text-blue-400 leading-none">{formatPrice(runner.exchange.back)}</span>
                                                        </div>
                                                        {/* LAY (The Benchmark) */}
                                                        <div className="flex-1 md:w-[70px] h-[44px] md:h-[50px] rounded-lg bg-[#1a0f14] border border-pink-500/40 flex flex-col justify-center items-center relative overflow-hidden">
                                                            {/* Subtle Glow for Value Benchmark */}
                                                            <div className="absolute inset-0 bg-pink-500/5"></div>
                                                            <span className="text-[9px] text-pink-500 font-bold uppercase tracking-wider relative z-10">Lay</span>
                                                            <span className="text-base md:text-lg font-mono font-bold text-pink-400 leading-none relative z-10">{formatPrice(runner.exchange.lay)}</span>
                                                        </div>
                                                    </div>

                                                    {/* DIVIDER (Desktop Only) */}
                                                    <div className="hidden md:block w-px h-8 bg-slate-700/50 mx-1"></div>
                                                
                                                    {/* DECK 2: THE BOOKIES (Targets) */}
                                                    <div className="flex w-full md:w-auto gap-2">
                                                        
                                                        {/* PINNACLE */}
                                                        <div className="flex-1 md:w-[70px] h-[44px] md:h-[50px] rounded-lg flex flex-col justify-center items-center cursor-default 
                                                            bg-gradient-to-b from-[#ff8c00] to-[#e65100] 
                                                            border-t border-white/20 shadow-lg shadow-orange-900/10">
                                                            <span className="text-[8px] text-orange-100 font-bold uppercase mb-0.5 opacity-90 tracking-wide">Pin</span>
                                                            <span className="text-base md:text-lg font-mono font-bold text-white leading-none drop-shadow-sm">
                                                                {formatPrice(runner.bookmakers.pinnacle)}
                                                            </span>
                                                        </div>

                                                        {/* LADBROKES / WILLIAM HILL */}
                                                        {(() => {
                                                            const isWilliamHill = activeSport === 'MMA';
                                                            return (
                                                                <div className={`flex-1 md:w-[70px] h-[44px] md:h-[50px] rounded-lg flex flex-col justify-center items-center cursor-default 
                                                                    border-t border-white/20 shadow-lg 
                                                                    ${isWilliamHill 
                                                                        ? 'bg-gradient-to-b from-[#003062] to-[#00152e] shadow-blue-900/20' // WH: Navy/Gold
                                                                        : 'bg-gradient-to-b from-[#E4002B] to-[#960018] shadow-red-900/20'   // Lad: Red
                                                                    }`}>
                                                                    <span className={`text-[8px] font-bold uppercase mb-0.5 opacity-90 tracking-wide 
                                                                        ${isWilliamHill ? 'text-[#FDB913]' : 'text-white'}`}>
                                                                        {isWilliamHill ? 'Wm Hill' : 'Lad'}
                                                                    </span>
                                                                    <span className="text-base md:text-lg font-mono font-bold text-white leading-none drop-shadow-sm">
                                                                        {formatPrice(runner.bookmakers.ladbrokes)}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* PADDY POWER */}
                                                        <div className="flex-1 md:w-[70px] h-[44px] md:h-[50px] rounded-lg flex flex-col justify-center items-center cursor-default 
                                                            bg-gradient-to-b from-[#005c40] to-[#002b1e] 
                                                            border-t border-white/20 shadow-lg shadow-green-900/10">
                                                            <span className="text-[8px] text-[#D2E600] font-bold uppercase mb-0.5 opacity-90 tracking-wide">Paddy</span>
                                                            <span className="text-base md:text-lg font-mono font-bold text-white leading-none drop-shadow-sm">
                                                                {formatPrice(runner.bookmakers.paddypower)}
                                                            </span>
                                                        </div>

                                                    </div>
                                                </div>
                                                
                                                {/* PAYWALL CTA */}
                                                {isPaywalled && (
                                                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-[2px] rounded-xl border border-white/10">
                                                         <div className="flex flex-col items-center gap-1.5 p-2 transform scale-95">
                                                            <button 
                                                                onClick={handleUnlock}
                                                                className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-4 py-2 rounded-lg shadow-xl border border-blue-400/50 transition-all flex items-center gap-2 hover:scale-105"
                                                            >
                                                                <Lock size={12} className="text-yellow-400" />
                                                                Unlock
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        </div>
                    )})}
                </div>
            </div>
            );
        }); })()}
        
        {Object.keys(competitions).length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-600">
                <AlertCircle size={48} className="mb-4 opacity-20" />
                <p className="text-lg font-medium">No active markets found for {activeSport}</p>
            </div>
        )}

        <div className="text-center pt-8 pb-2 opacity-50">
            <p className="text-[10px] text-slate-700">No guarantees. This shows price discrepancies — not predictions.</p>
        </div>
      </div>

      {/* PAYMENT MODAL */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#161F32] border border-blue-500/30 rounded-xl p-6 max-w-sm w-full shadow-2xl space-y-5 relative">
                
                <div className="text-center space-y-1">
                    <h3 className="text-white font-bold text-lg leading-tight">Unlock Today&apos;s NBA Steamers (Daily)</h3>
                    <p className="text-blue-400 font-mono font-bold text-lg">£5 / week</p>
                </div>

                {/* 24H TRIAL CTA */}
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
                            <button 
                                onClick={handleCopyLink}
                                className="bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 transition-all min-w-[60px] justify-center"
                            >
                                {copied ? <Check size={10} /> : <Copy size={10} />}
                                {copied ? "Copied" : "Copy"}
                            </button>
                        </div>
                    </div>
                    <div className="leading-relaxed">
                        <span className="font-bold text-white block">2) Then DM @NBA_steamers with:</span>
                        <span className="block text-slate-400 pl-3 mt-1 text-xs">• your email</span>
                        <span className="block text-slate-400 pl-3 text-xs">• a screenshot of payment</span>
                        
                        <a 
                            href="https://t.me/NBA_steamers" 
                            target="_blank" 
                            rel="noreferrer"
                            onClick={() => console.info("telegram_click")}
                            className="mt-3 flex items-center justify-center w-full bg-[#229ED9] hover:bg-[#1f8rbc] text-white font-bold py-3 rounded-lg shadow-md transition-all text-xs"
                        >
                            DM on Telegram
                        </a>
                    </div>
                    <p className="text-[10px] text-slate-500 italic pt-1 border-t border-slate-800/50">
                        Access is granted manually.
                    </p>
                </div>

                <div className="flex flex-col gap-3 pt-2">
                    <button 
                        onClick={handleConfirmPayment} 
                        className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg w-full transition-all shadow-lg border border-blue-500/50"
                    >
                        I’VE PAID — UNLOCK
                    </button>
                    <button 
                        onClick={() => setShowPaymentModal(false)} 
                        className="text-slate-500 hover:text-white font-medium text-xs py-2 uppercase tracking-wide transition-colors"
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