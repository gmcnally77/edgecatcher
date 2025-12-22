'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { Search, RefreshCw, TrendingUp, Clock, Radio, Lock, Swords, Trophy, Dribbble, AlertCircle, Activity } from 'lucide-react';
import SteamersPanel from '@/components/SteamersPanel'; 

const SPORTS = [
  { id: 'MMA', label: 'MMA', icon: <Swords size={16} /> },
  { id: 'NFL', label: 'NFL', icon: <Trophy size={16} /> },
  { id: 'Basketball', label: 'Basketball', icon: <Dribbble size={16} /> },
];

// HELPER: Normalize strings for strict comparison
const normalizeKey = (str: string) => str ? str.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

const groupData = (data: any[]) => {
  const competitions: Record<string, any[]> = {};

  data.forEach(row => {
    // --- 1. STRICT 2-WAY NORMALIZATION (FILTERS JUNK) ---
    const sportKey = row.sport || '';
    const isTwoWaySport = ['NFL', 'NBA', 'Basketball', 'MMA', 'American Football', 'UFC'].some(s => sportKey.includes(s));

    // Derive Participants from Event Name (e.g. "Chiefs v Raiders")
    const participants = row.event_name ? row.event_name.split(/\s+v\s+|\s+@\s+|\s+vs\.?\s+/i) : [];

    if (isTwoWaySport && participants.length === 2) {
        const p1 = normalizeKey(participants[0]);
        const p2 = normalizeKey(participants[1]);
        const runner = normalizeKey(row.runner_name);

        // DROP anything that is not Home or Away (Kills "Draw", "Tie", junk)
        if (runner !== p1 && runner !== p2) {
            return; 
        }
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
            bet365: row.price_bet365, 
            paddypower: row.price_paddy
        }
    });
  });

  Object.keys(competitions).forEach(key => {
      competitions[key].forEach(market => {
          if (market.selections && market.selections.length > 0) {
              
              // --- 2. STABLE SORT (FIXES FLIPPING) ---
              market.selections.sort((a: any, b: any) => {
                  // Re-derive canonical order from Event Name
                  const participants = market.name
                    ? market.name.split(/\s+v\s+|\s+@\s+|\s+vs\.?\s+/i).map((p: string) => normalizeKey(p))
                    : [];
                  
                  const keyA = normalizeKey(a.name);
                  const keyB = normalizeKey(b.name);
                  
                  const idxA = participants.indexOf(keyA);
                  const idxB = participants.indexOf(keyB);

                  // Primary: Position in Event Name (Home vs Away)
                  if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                  
                  // Secondary: Keep Teams above "Draw" (if one leaks through)
                  if (idxA !== -1) return -1;
                  if (idxB !== -1) return 1;

                  // Fallback: Alphabetical (Deterministic)
                  return a.name.localeCompare(b.name);
              });
              // --- END STABLE SORT ---

          }
      });
      
      // Sort Competitions by Time -> Name -> ID
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
  const [activeSport, setActiveSport] = useState('MMA');
  const [competitions, setCompetitions] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

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
      // Relaxed to 10 minutes (600s) to prevent aggressive hiding due to clock drift
      const heartbeatCutoff = new Date(now.getTime() - 600 * 1000); 

      const activeRows = data.filter((row: any) => {
        if (row.last_updated && new Date(row.last_updated) < heartbeatCutoff) return false;
        if (row.market_status === 'CLOSED' || row.market_status === 'SETTLED') return false;
        return true; 
      });

      try {
          const grouped = groupData(activeRows);
          setCompetitions(grouped);
          setLastUpdated(new Date().toLocaleTimeString());
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
    return new Date(isoString).toLocaleDateString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
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
                    <span className="block text-lg font-bold text-white">INDEPENDENCE<span className="text-blue-500 text-xs ml-1 tracking-widest">STACK</span></span>
                </div>
                <span className="text-xs font-mono text-slate-500">UPDATED: {lastUpdated}</span>
            </div>

            <div className="flex gap-6 border-b border-transparent overflow-x-auto no-scrollbar">
                {SPORTS.map((sport) => (
                    <button key={sport.id} onClick={() => setActiveSport(sport.id)} className={`flex items-center gap-2 pb-3 text-sm font-bold transition-all border-b-2 whitespace-nowrap ${activeSport === sport.id ? 'text-white border-blue-500' : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
                        {sport.icon} {sport.label}
                    </button>
                ))}
            </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        
        <SteamersPanel activeSport={activeSport} />

        {loading && Object.keys(competitions).length === 0 && <div className="flex justify-center py-20"><RefreshCw size={40} className="animate-spin text-blue-500" /></div>}

        {Object.entries(competitions).map(([compName, markets]) => (
            <div key={compName}>
                <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2"><span className="w-1 h-6 bg-blue-500 rounded-full"></span> {compName}</h2>
                <div className="grid grid-cols-1 gap-4">
                    {markets.map((event: any) => {
                        const isSuspended = event.market_status === 'SUSPENDED';
                        const isInPlay = event.in_play;
                        let borderClass = 'border-slate-700/50';
                        if (isSuspended) borderClass = 'border-yellow-500/50';
                        else if (isInPlay) borderClass = 'border-red-500/50';

                        return (
                        <div key={event.id} className={`bg-[#161F32] border ${borderClass} rounded-xl overflow-hidden hover:border-blue-500/30 transition-all`}>
                            <div className="bg-[#0f1522] px-4 py-3 border-b border-slate-800 flex justify-between items-center">
                                <h3 className="text-slate-200 font-bold text-sm truncate max-w-[200px] md:max-w-full">{event.name}</h3>
                                <div className="flex items-center gap-2 text-slate-500 text-xs whitespace-nowrap">
                                    {isSuspended ? <span className="flex gap-1 text-yellow-500 font-bold"><Lock size={12}/> SUSP</span> : isInPlay ? <span className="flex gap-1 text-red-500 font-bold"><Radio size={12}/> LIVE</span> : <span className="flex gap-1"><Clock size={12}/> {formatTime(event.start_time)}</span>}
                                </div>
                            </div>

                            <div className={`divide-y divide-slate-800 ${isSuspended ? 'opacity-50 pointer-events-none' : ''}`}>
                                {event.selections?.map((runner: any) => (
                                    <div key={runner.id} className="flex items-center px-4 py-3 gap-4 hover:bg-slate-800/30 transition-colors">
                                        <div className="flex-1 min-w-[120px]">
                                            <span className="text-white font-medium text-lg block leading-tight">{runner.name}</span>
                                        </div>
                                        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mask-gradient">
                                            <div className="flex gap-1 flex-shrink-0">
                                                <div className="w-16 py-2 rounded-lg text-center bg-[#0B1120] border border-blue-500/30 flex flex-col justify-center h-[52px]">
                                                    <span className="text-[9px] text-blue-500 font-bold uppercase mb-0.5">Back</span>
                                                    <span className="text-lg font-mono font-bold text-blue-400 leading-none">{formatPrice(runner.exchange.back)}</span>
                                                </div>
                                                <div className="w-16 py-2 rounded-lg text-center bg-[#0B1120] border border-pink-500/30 flex flex-col justify-center h-[52px]">
                                                    <span className="text-[9px] text-pink-500 font-bold uppercase mb-0.5">Lay</span>
                                                    <span className="text-lg font-mono font-bold text-pink-400 leading-none">{formatPrice(runner.exchange.lay)}</span>
                                                </div>
                                            </div>
                                            <div className="w-px h-8 bg-slate-700 mx-1 flex-shrink-0"></div>
                                            
                                            {/* PINNACLE (Orange) */}
                                            <div className="w-16 py-2 rounded-lg text-center bg-[#ff7b00] border border-[#e66e00] flex flex-col justify-center h-[52px] flex-shrink-0">
                                                <span className="text-[9px] text-orange-900 font-bold uppercase mb-0.5">Pin</span>
                                                <span className="text-lg font-mono font-bold text-white leading-none">{formatPrice(runner.bookmakers.pinnacle)}</span>
                                            </div>
                                            {/* LADBROKES (Grey) */}
                                            <div className="w-16 py-2 rounded-lg text-center bg-[#4a4a4a] border border-[#3a3a3a] flex flex-col justify-center h-[52px] flex-shrink-0">
                                            <span className="text-[9px] text-gray-200 font-bold uppercase mb-0.5">Ladbrokes</span>
                                            <span className="text-lg font-mono font-bold text-white leading-none">{formatPrice(runner.bookmakers.bet365)}</span>
                                            </div>
                                            {/* PADDY (White/Green) */}
                                            <div className="w-16 py-2 rounded-lg text-center bg-white border-2 border-[#206c48] flex flex-col justify-center h-[52px] flex-shrink-0">
                                                <span className="text-[9px] text-[#206c48] font-bold uppercase mb-0.5">PP</span>
                                                <span className="text-lg font-mono font-bold text-[#206c48] leading-none">{formatPrice(runner.bookmakers.paddypower)}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )})}
                </div>
            </div>
        ))}
        
        {Object.keys(competitions).length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-600"><AlertCircle size={48} className="mb-4 opacity-20" /><p className="text-lg font-medium">No active markets found for {activeSport}</p></div>
        )}
      </div>
    </div>
  );
}