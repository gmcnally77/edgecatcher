'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { 
  RefreshCw, TrendingUp, Clock, Radio, Lock, Unlock, 
  Swords, Trophy, Dribbble, AlertCircle, Copy, Check, Search,
  Zap 
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
  const [viewMode, setViewMode] = useState<'scanner' | 'steamers'>('scanner'); 
  const [competitions, setCompetitions] = useState<Record<string, any[]>>({});
  const [steamerEvents, setSteamerEvents] = useState<Set<string>>(new Set());
  const [steamerSignals, setSteamerSignals] = useState<Map<string, any>>(new Map());
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
                            <span className="text-[10px] uppercase font-bold text-blue-400 tracking-widest bg-blue-400/10 px-1.5 rounded">
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
                     {/* SEGMENTED CONTROL (TOGGLE) */}
                    <div className="flex bg-[#161F32] p-1 rounded-lg border border-slate-700/50 relative w-full md:w-auto">
                        <button 
                            onClick={() => setViewMode('scanner')}
                            className={`flex-1 md:flex-none px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
                                viewMode === 'scanner' 
                                ? 'bg-blue-600 text-white shadow-md' 
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            Scanner
                        </button>
                        <button 
                            onClick={() => setViewMode('steamers')}
                            className={`flex-1 md:flex-none px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                                viewMode === 'steamers' 
                                ? 'bg-blue-600 text-white shadow-md' 
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            <Zap size={12} className={viewMode === 'steamers' ? 'text-yellow-300 fill-yellow-300' : ''} />
                            Steam Grid
                        </button>
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
                className="w-full bg-[#161F32] border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600"
            />
        </div>

        {loading && Object.keys(competitions).length === 0 && (
            <div className="flex justify-center py-20">
                <RefreshCw size={40} className="animate-spin text-blue-500" />
            </div>
        )}

        {/* --- MAIN CONTENT SWITCHER --- */}
        {(() => { 
            let globalGameIndex = 0; 
            const allMarkets: any[] = [];
            
            const filterMarkets = (markets: any[]) => markets.filter(m => 
                m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                m.selections.some((s: any) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
            );

            // ============================================
            // MODE A: STEAMER GRID (Visual, Simple)
            // ============================================
            if (viewMode === 'steamers') {
                Object.values(competitions).forEach(markets => markets.forEach(m => allMarkets.push(m)));
                const filtered = filterMarkets(allMarkets);

                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filtered.map((event: any) => {
                            const isPaywalled = !isPaid && globalGameIndex >= 3;
                            globalGameIndex++;

                            const isSuspended = event.market_status === 'SUSPENDED';
                            const isInPlay = event.in_play;
                            let borderClass = 'border-slate-800';
                            if (isSuspended) borderClass = 'border-yellow-500/50';
                            else if (isInPlay) borderClass = 'border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.1)]';

                            return (
                                <div key={event.id} className={`bg-[#161F32] border ${borderClass} rounded-xl overflow-hidden relative group`}>
                                    <div className="bg-[#0f1522] px-4 py-3 border-b border-slate-800 flex justify-between items-center">
                                        <h3 className="text-slate-200 font-bold text-sm truncate flex-1 min-w-0 pr-2">{event.name}</h3>
                                        <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                                            {isInPlay && <span className="text-red-500 font-bold tracking-wider flex items-center gap-1"><Radio size={10} className="animate-pulse"/> IN PLAY</span>}
                                            {!isInPlay && <span className="flex items-center gap-1"><Clock size={10}/> {formatTime(event.start_time)}</span>}
                                            <span>Vol: £{event.volume?.toLocaleString()}</span>
                                        </div>
                                    </div>
                                    <div className={`p-4 space-y-3 ${isPaywalled ? 'blur-sm select-none opacity-40 pointer-events-none' : ''}`}>
                                        {event.selections?.map((runner: any) => {
                                            const signal = steamerSignals.get(runner.name);
                                            return (
                                                <div key={runner.id} className="flex justify-between items-center">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-slate-200 font-medium text-sm">{runner.name}</span>
                                                        {signal && (
                                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                                                signal.label === 'STEAM' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                                            }`}>{signal.label}</span>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <div className="w-16 h-10 bg-[#0f172a] border border-blue-500/30 rounded flex flex-col items-center justify-center">
                                                            <span className="text-[7px] text-blue-500 uppercase font-bold leading-none mb-0.5">Back</span>
                                                            <span className="text-sm font-bold text-blue-400 leading-none">{formatPrice(runner.exchange.back)}</span>
                                                        </div>
                                                        <div className="w-16 h-10 bg-[#1a0f14] border border-pink-500/40 rounded flex flex-col items-center justify-center">
                                                            <span className="text-[7px] text-pink-500 uppercase font-bold leading-none mb-0.5">Lay</span>
                                                            <span className="text-sm font-bold text-pink-400 leading-none">{formatPrice(runner.exchange.lay)}</span>
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
                );
            }

            // ============================================
            // MODE B: SCANNER LIST (Detailed, Restored & Polished)
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
                                            <div key={event.id} className={`bg-[#161F32] border ${borderClass} rounded-xl overflow-hidden relative`}>
                                                <div className="bg-[#0f1522] px-4 py-3 border-b border-slate-800 flex justify-between items-center">
                                                    <h3 className="text-slate-200 font-bold text-sm">{event.name}</h3>
                                                    <div className="flex gap-2 text-xs text-slate-500">
                                                        {isInPlay ? <span className="text-red-500 font-bold">LIVE</span> : formatTime(event.start_time)}
                                                    </div>
                                                </div>
                                                
                                                <div className={`divide-y divide-slate-800 ${isPaywalled ? 'blur-sm select-none opacity-40 pointer-events-none' : ''}`}>
                                                    {event.selections?.map((runner: any) => {
                                                        const signal = steamerSignals.get(runner.name);
                                                        
                                                        // RESTORED VALUE LOGIC
                                                        let selectionBorder = "border-transparent";
                                                        let bestBookPrice = 0;
                                                        let bestBookName = "";
                                                        let valueText = null;

                                                        if (runner.exchange.back > 1.0 && runner.exchange.lay > 1.0) {
                                                            const mid = (runner.exchange.back + runner.exchange.lay) / 2;
                                                            
                                                            const books = [
                                                                { name: 'Pin', p: runner.bookmakers.pinnacle },
                                                                { name: activeSport === 'MMA' ? 'WH' : 'Lad', p: runner.bookmakers.ladbrokes },
                                                                { name: 'PP', p: runner.bookmakers.paddypower }
                                                            ];

                                                            // Find best bookie
                                                            const best = books.reduce((acc, curr) => (curr.p > 1.0 && curr.p > acc.p) ? curr : acc, { name: '', p: 0 });
                                                            bestBookPrice = best.p;
                                                            bestBookName = best.name;

                                                            if (bestBookPrice > 1.0) {
                                                                const diff = ((bestBookPrice / mid) - 1) * 100;
                                                                
                                                                // Restore Value Text & Styling
                                                                if (diff > -5.0) { 
                                                                     const sign = diff > 0 ? '+' : '';
                                                                     const color = diff > 0 ? 'text-green-400' : 'text-slate-500';
                                                                     valueText = (
                                                                         <span className="text-[10px] text-slate-500 mt-1 font-mono block">
                                                                             Best: <span className="text-slate-300 font-bold">{bestBookName} {bestBookPrice.toFixed(2)}</span> <span className={color}>({sign}{diff.toFixed(1)}%)</span>
                                                                         </span>
                                                                     );
                                                                }

                                                                if (diff > 0.01) selectionBorder = "border-l-4 border-l-emerald-500 bg-emerald-500/5";
                                                                else if (diff >= -0.01) selectionBorder = "border-l-4 border-l-amber-500 bg-amber-500/5";
                                                            }
                                                        }

                                                        return (
                                                            <div key={runner.id} className={`flex flex-col md:flex-row md:items-center px-4 py-3 gap-3 ${selectionBorder}`}>
                                                                {/* NAME + SIGNAL */}
                                                                <div className="md:w-1/3 flex flex-col justify-center">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-white font-medium">{runner.name}</span>
                                                                        {signal && (
                                                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${signal.label === 'STEAM' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                                                                {signal.label}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    {/* RESTORED VALUE TEXT */}
                                                                    {valueText}
                                                                </div>

                                                                {/* PRICES - STRICT GRID */}
                                                                <div className="flex flex-1 gap-2 items-center justify-start md:justify-end overflow-hidden">
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

// --- STRICT & DISCIPLINED COMPONENTS ---

const PriceBox = ({ label, price, type }: any) => (
    <div className={`w-[52px] h-[44px] rounded flex flex-col items-center justify-center border flex-none ${type === 'back' ? 'bg-[#0f172a] border-blue-500/30' : 'bg-[#1a0f14] border-pink-500/40'}`}>
        <span className={`text-[9px] font-bold leading-none mb-0.5 uppercase ${type === 'back' ? 'text-blue-500' : 'text-pink-500'}`}>{label}</span>
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
        <div className={`w-[52px] h-[44px] rounded flex flex-col items-center justify-center border transition-all flex-none bg-gradient-to-b ${baseStyle} ${activeStyle}`}>
            <span className="text-[9px] font-bold leading-none mb-0.5 uppercase opacity-90">{label}</span>
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