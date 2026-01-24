'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabase';
import { Flame, Star, TrendingDown, Zap } from 'lucide-react';

interface Steamer {
  runner_name: string;
  event_name: string;
  current_price: number;
  opening_price: number;
  delta_pct: number;
  score: number;
  is_pinned: boolean;
}

export default function SteamersPanel({ activeSport, onSteamersChange }: any) {
  const [steamers, setSteamers] = useState<Steamer[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('pinned_steamers');
    if (saved) setPinned(JSON.parse(saved));
  }, []);

  const fetchSteamData = async () => {
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('*')
      .eq('sport', activeSport)
      .order('ts', { ascending: false })
      .limit(100);

    if (error || !data) return;

    // Logic: Group by selection and find price move
    const groups: Record<string, any[]> = {};
    data.forEach(d => {
      if (!groups[d.runner_name]) groups[d.runner_name] = [];
      groups[d.runner_name].push(d);
    });

    const calculated: Steamer[] = Object.keys(groups).map(name => {
      const history = groups[name];
      const current = history[0].mid_price;
      const oldest = history[history.length - 1].mid_price;
      const delta = ((oldest - current) / oldest) * 100;

      return {
        runner_name: name,
        event_name: history[0].event_name,
        current_price: current,
        opening_price: oldest,
        delta_pct: delta,
        score: Math.min(100, Math.max(0, delta * 5)), // Simple weight
        is_pinned: pinned.includes(name)
      };
    }).filter(s => s.delta_pct > 1.5) // Only show moves > 1.5%
      .sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) || b.score - a.score);

    setSteamers(calculated);
    
    // Pass back to parent to highlight rows in main table
    const steamerNames = new Set(calculated.map(s => s.runner_name));
    const signals = new Map(calculated.map(s => [s.runner_name, { label: 'STEAMER', pct: s.delta_pct / 100 }]));
    onSteamersChange(steamerNames, signals);
  };

  useEffect(() => {
    fetchSteamData();
    const interval = setInterval(fetchSteamData, 15000); // 15s refresh
    return () => clearInterval(interval);
  }, [activeSport, pinned]);

  const togglePin = (name: string) => {
    const newPinned = pinned.includes(name) ? pinned.filter(p => p !== name) : [...pinned, name];
    setPinned(newPinned);
    localStorage.setItem('pinned_steamers', JSON.stringify(newPinned));
  };

  if (steamers.length === 0) return null;

  return (
    <div className="bg-[#161F32]/50 border border-blue-500/20 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Flame className="text-orange-500" size={18} />
        <h3 className="text-white font-bold">Live Steam (Significant Moves)</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {steamers.map(s => (
          <div key={s.runner_name} className="bg-[#0B1120] border border-slate-800 p-3 rounded-lg flex justify-between items-center group">
            <div className="flex flex-col">
              <span className="text-white font-bold text-sm">{s.runner_name}</span>
              <span className="text-slate-500 text-[10px] uppercase">{s.event_name}</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-blue-400 font-mono text-xs">{s.opening_price.toFixed(2)} → {s.current_price.toFixed(2)}</span>
                <span className="bg-blue-500/10 text-blue-400 text-[10px] px-1.5 py-0.5 rounded font-bold">
                  -{s.delta_pct.toFixed(1)}%
                </span>
              </div>
            </div>
            <button onClick={() => togglePin(s.runner_name)} className={`p-2 rounded hover:bg-slate-800 transition-colors ${s.is_pinned ? 'text-yellow-500' : 'text-slate-600'}`}>
              <Star size={16} fill={s.is_pinned ? "currentColor" : "none"} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}