'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { TrendingUp, Swords, Trophy, Dribbble, Pin, Lock, Copy, Check } from 'lucide-react';
import SteamersPanel from '@/components/SteamersPanel';

// --- CONFIG ---
const STEAMER_TEST_MODE = true; 
const SPORTS = [
  { id: 'MMA', label: 'MMA', icon: <Swords size={16} /> },
  { id: 'NFL', label: 'NFL', icon: <Trophy size={16} /> },
  { id: 'Basketball', label: 'Basketball', icon: <Dribbble size={16} /> },
];
// --------------

// --- VISUAL COMPONENTS (Defined locally to prevent import errors) ---

const PriceBtn = ({ label, price, type }: any) => {
    // Exact match for the Blue/Pink Exchange Buttons
    const bg = type === 'back' ? 'bg-[#0c1829] border-[#1e3a8a]' : 'bg-[#251016] border-[#831843]';
    const text = type === 'back' ? 'text-blue-300' : 'text-pink-300';
    const labelColor = type === 'back' ? 'text-blue-500' : 'text-pink-500';

    return (
        <div className={`col-span-1 h-12 rounded border flex flex-col items-center justify-center ${bg}`}>
            <span className={`text-[9px] font-bold uppercase ${labelColor}`}>{label}</span>
            <span className={`text-sm font-bold ${text}`}>{price?.toFixed(2) || '-'}</span>
        </div>
    );
};

const BookieBtn = ({ label, price, color }: any) => {
    // Exact match for the Bookie Buttons
    const styles: any = {
        orange: "bg-[#2a1708] border-orange-900/50 text-orange-200", // Pinnacle style
        slate: "bg-[#1e293b] border-slate-700/50 text-slate-300",    // Ladbrokes style
        emerald: "bg-[#062c23] border-emerald-900/50 text-emerald-300" // Paddy style
    };
    const s = styles[color] || styles.slate;

    return (
        <div className={`col-span-1 h-12 rounded border flex flex-col items-center justify-center ${s}`}>
             <span className="text-[9px] font-bold uppercase opacity-60">{label}</span>
             <span className="text-sm font-bold">{price > 1 ? price.toFixed(2) : '-'}</span>
        </div>
    );
};

export default function Home() {
  const [activeSport, setActiveSport] = useState('Basketball');
  const [viewMode, setViewMode] = useState<'scanner' | 'steamers'>('scanner'); 
  const [competitions, setCompetitions] = useState<Record<string, any[]>>({});
  const [steamerEvents, setSteamerEvents] = useState<Set<string>>(new Set());
  const [steamerSignals, setSteamerSignals] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  
  // PAYWALL STATE
  const [isPaid, setIsPaid] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [copied, setCopied] = useState(false);

  // --- PINNING ---
  useEffect(() => {
    const saved = localStorage.getItem('pinned_runners');
    if (saved) {
        try { setPinned(new Set(JSON.parse(saved))); } catch(e) {}
    }
    const paid = localStorage.getItem('paid') === 'true';
    setIsPaid(paid);
  }, []);

  const togglePin = (name: string) => {
    const next = new Set(pinned);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPinned(next);
    localStorage.setItem('pinned_runners', JSON.stringify([...next]));
  };

  const handleSteamersChange = useCallback(
    (newEvents: Set<string>, newSignals: Map<string, any>) => {
      setSteamerEvents(newEvents);
      setSteamerSignals(newSignals);
    }, 
    []
  );

  // --- DATA FETCHING ---
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
        const comps: Record<string, any[]> = {};
        data.forEach((row: any) => {
            if (row.market_status === 'CLOSED') return;
            const comp = row.competition || 'Other';
            if (!comps[comp]) comps[comp] = [];
            
            let market = comps[comp].find(m => m.id === row.market_id);
            if (!market) {
                market = { 
                    id: row.market_id, name: row.event_name, start_time: row.start_time, 
                    volume: row.volume, in_play: row.in_play, selections: [] 
                };
                comps[comp].push(market);
            }
            market.selections.push({
                id: row.id, name: row.runner_name,
                exchange: { back: row.back_price, lay: row.lay_price },
                bookmakers: { pinnacle: row.price_pinnacle, ladbrokes: row.price_bet365, paddypower: row.price_paddy }
            });
        });
        setCompetitions(comps);
    }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    fetchPrices();
    const interval = setInterval(fetchPrices, 2000); 
    return () => clearInterval(interval);
  }, [activeSport]);

  const getFilteredMarkets = () => {
      const allMarkets: any[] = [];
      Object.values(competitions).forEach(markets => markets.forEach(m => allMarkets.push(m)));
      
      return allMarkets.filter(m => {
          if (viewMode === 'steamers' && !STEAMER_TEST_MODE) {
              return m.selections.some((s: any) => steamerEvents.has(s.name));
          }
          return true;
      });
  };

  const formatTime = (isoString: string) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const marketsToShow = getFilteredMarkets();
  let globalGameIndex = 0;

  // --- PAYWALL HANDLERS ---
  const handleUnlock = () => {
    setPaymentRef(`SCAN-${Math.floor(1000 + Math.random() * 9000)}`);
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

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-300 font-sans pb-20">
      
      {/* HEADER */}
      <div className="sticky top-0 z-50 bg-[#0B1120]/95 backdrop-blur-md border-b border-slate-800 px-4 pt-4 pb-2">
         <div className="flex justify-between items-center mb-4">
             <div className="flex items-center gap-2">
                 <div className="bg-blue-600 p-1.5 rounded-lg"><TrendingUp size={18} className="text-white"/></div>
                 <span className="text-lg font-bold text-white">Scanner v2</span>
             </div>
             <div className="flex bg-[#161F32] p-1 rounded-lg border border-slate-700">
                <button onClick={() => setViewMode('scanner')} className={`px-3 py-1 text-xs font-bold rounded ${viewMode === 'scanner' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Scan</button>
                <button onClick={() => setViewMode('steamers')} className={`px-3 py-1 text-xs font-bold rounded ${viewMode === 'steamers' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Steam</button>
             </div>
         </div>
         <div className="flex gap-6 overflow-x-auto no-scrollbar border-b border-slate-800/50">
            {SPORTS.map(s => (
                <button key={s.id} onClick={() => setActiveSport(s.id)} className={`pb-2 text-sm font-bold border-b-2 transition-colors ${activeSport === s.id ? 'text-white border-blue-500' : 'text-slate-500 border-transparent'}`}>
                    {s.label}
                </button>
            ))}
         </div>
      </div>

      {/* BODY */}
      <div className="max-w-3xl mx-auto px-3 py-4 space-y-4">
        {/* INVISIBLE CONTROLLER */}
        <SteamersPanel activeSport={activeSport} onSteamersChange={handleSteamersChange} />

        {loading && marketsToShow.length === 0 ? (
            <div className="text-center py-20 text-slate-600 animate-pulse">Loading Markets...</div>
        ) : marketsToShow.length === 0 ? (
            <div className="text-center py-20 text-slate-600">No active markets found</div>
        ) : (
            marketsToShow.map((event: any) => {
                const isPaywalled = !isPaid && globalGameIndex >= 3;
                globalGameIndex++;

                // SORT LOGIC: Pinned -> Steaming -> Normal
                const sortedRunners = [...event.selections].sort((a: any, b: any) => {
                    if (pinned.has(a.name) && !pinned.has(b.name)) return -1;
                    if (!pinned.has(a.name) && pinned.has(b.name)) return 1;
                    const sigA = steamerSignals.get(a.name);
                    const sigB = steamerSignals.get(b.name);
                    if (sigA && !sigB) return -1;
                    if (!sigA && sigB) return 1;
                    return 0;
                });

                return (
                    <div key={event.id} className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-lg relative">
                        {/* EVENT HEADER */}
                        <div className="bg-[#1f2937]/50 px-4 py-2 border-b border-slate-800 flex justify-between items-center">
                            <h3 className="text-slate-200 font-bold text-xs truncate pr-4">{event.name}</h3>
                            <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">
                                {event.in_play ? <span className="text-red-500 font-bold">● LIVE</span> : formatTime(event.start_time)}
                            </span>
                        </div>

                        {/* RUNNERS */}
                        <div className={`divide-y divide-slate-800 ${isPaywalled ? 'blur-sm select-none opacity-40 pointer-events-none' : ''}`}>
                            {sortedRunners.map((runner: any) => {
                                const signal = steamerSignals.get(runner.name);
                                const isPinned = pinned.has(runner.name);
                                
                                // BEST PRICE LOGIC
                                const books = [
                                    { n: 'Pin', p: runner.bookmakers.pinnacle },
                                    { n: 'Lad', p: runner.bookmakers.ladbrokes },
                                    { n: 'PP', p: runner.bookmakers.paddypower }
                                ].filter(b => b.p > 1);
                                const best = books.reduce((max, curr) => curr.p > max.p ? curr : max, { n: '', p: 0 });
                                
                                let diff = 0;
                                if (best.p > 1 && runner.exchange.back > 1) {
                                    const mid = (runner.exchange.back + runner.exchange.lay) / 2;
                                    diff = ((best.p / mid) - 1) * 100;
                                }

                                return (
                                    <div key={runner.id} className="p-3">
                                        {/* NAME ROW */}
                                        <div className="flex justify-between items-start mb-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`font-bold text-sm ${signal ? 'text-emerald-400' : 'text-slate-200'}`}>
                                                    {runner.name}
                                                </span>
                                                <button onClick={() => togglePin(runner.name)} className="opacity-50 hover:opacity-100 transition-opacity p-1">
                                                    <Pin size={12} className={isPinned ? "fill-blue-500 text-blue-500" : "text-slate-600"} />
                                                </button>
                                            </div>
                                            {signal && (
                                                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 rounded border border-emerald-500/20 font-mono flex items-center gap-1">
                                                    <TrendingUp size={10} />
                                                    {Math.abs(signal.pct * 100).toFixed(1)}% ({signal.timeDesc})
                                                </span>
                                            )}
                                        </div>

                                        {/* BEST PRICE ROW */}
                                        {best.p > 0 && (
                                            <div className="text-[10px] font-mono mb-2 flex items-center gap-1.5">
                                                <span className="text-slate-500">Best:</span>
                                                <span className="text-slate-300 font-bold">{best.n} {best.p.toFixed(2)}</span>
                                                <span className={diff > 0 ? "text-emerald-500" : "text-slate-600"}>
                                                    ({diff > 0 ? '+' : ''}{diff.toFixed(1)}%)
                                                </span>
                                            </div>
                                        )}

                                        {/* --- THE 5-COLUMN GRID (MOBILE FIX) --- */}
                                        <div className="grid grid-cols-5 gap-1.5">
                                            <PriceBtn label="BACK" price={runner.exchange.back} type="back" />
                                            <PriceBtn label="LAY" price={runner.exchange.lay} type="lay" />
                                            <BookieBtn label="PIN" price={runner.bookmakers.pinnacle} color="orange" />
                                            <BookieBtn label="LAD" price={runner.bookmakers.ladbrokes} color="slate" />
                                            <BookieBtn label="PP" price={runner.bookmakers.paddypower} color="emerald" />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {isPaywalled && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-[2px]">
                                <button onClick={handleUnlock} className="bg-blue-600 text-white text-[10px] font-bold px-4 py-2 rounded-lg flex items-center gap-2">
                                    <Lock size={12} className="text-yellow-400" /> Unlock
                                </button>
                            </div>
                        )}
                    </div>
                );
            })
        )}
      </div>

      {/* PAYMENT MODAL (KEPT AS IS) */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#161F32] border border-blue-500/30 rounded-xl p-6 max-w-sm w-full shadow-2xl space-y-5">
                <div className="text-center space-y-1">
                    <h3 className="text-white font-bold text-lg">Unlock Full Scanner</h3>
                    <p className="text-blue-400 font-mono font-bold text-lg">£5 / week</p>
                </div>
                <div className="bg-[#0B1120] p-4 rounded-lg text-sm text-slate-300 space-y-3 border border-slate-800">
                    <div className="leading-relaxed">
                        <span className="font-bold text-white block mb-1">Pay on Revolut:</span>
                        <div className="mb-2 bg-black/30 border border-slate-700/50 rounded px-2 py-1 inline-block">
                            <span className="text-xs text-slate-400 mr-2">Ref:</span>
                            <span className="font-mono font-bold text-white select-all">{paymentRef}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <a href="https://revolut.me/gerardq0w5" target="_blank" rel="noopener noreferrer" className="text-blue-400 font-mono text-xs">revolut.me/gerardq0w5</a>
                            <button onClick={handleCopyLink} className="bg-slate-700 text-white text-[10px] px-2 py-1 rounded">
                                {copied ? <Check size={10} /> : <Copy size={10} />}
                            </button>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-3">
                    <button onClick={handleConfirmPayment} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg w-full">I’VE PAID</button>
                    <button onClick={() => setShowPaymentModal(false)} className="text-slate-500 text-xs">Close</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}