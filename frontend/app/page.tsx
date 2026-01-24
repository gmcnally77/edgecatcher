'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { TrendingUp, Swords, Trophy, Dribbble, Check, Copy } from 'lucide-react';
import SteamersPanel from '@/components/SteamersPanel';
import ScannerCard from '@/components/ScannerCard';

// --- CONFIG ---
const STEAMER_TEST_MODE = true; 
const SPORTS = [
  { id: 'MMA', label: 'MMA', icon: <Swords size={16} /> },
  { id: 'NFL', label: 'NFL', icon: <Trophy size={16} /> },
  { id: 'Basketball', label: 'Basketball', icon: <Dribbble size={16} /> },
];
// --------------

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
      <div className="max-w-2xl mx-auto px-3 py-4 space-y-4">
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

                return (
                    <ScannerCard 
                        key={event.id}
                        event={event}
                        steamerSignals={steamerSignals}
                        pinned={pinned}
                        onTogglePin={togglePin}
                        isPaywalled={isPaywalled}
                        onUnlock={handleUnlock}
                    />
                );
            })
        )}
      </div>

      {/* PAYMENT MODAL */}
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