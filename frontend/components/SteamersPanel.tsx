'use client';
import { useEffect, useCallback } from 'react';
import { supabase } from '@/utils/supabase';

// ⚡️ SIMULATION MODE: Forces badges to appear even if markets are dead static
const SIMULATION_MODE = true; 

export default function SteamersPanel({ activeSport, onSteamersChange }: any) {
  const fetchMovement = useCallback(async () => {
    // 1. Fetch Snapshots (Last 60 mins)
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    
    // FETCH 1: Try to get history
    let { data, error } = await supabase
      .from('market_snapshots')
      .select('*')
      .eq('sport', activeSport)
      .gt('ts', hourAgo)
      .order('ts', { ascending: false })
      .limit(500);

    const signals = new Map();
    const groups: Record<string, any[]> = {};
    let allRunners: string[] = [];

    // 2. Process History (If exists)
    if (data && data.length > 0) {
        data.forEach(d => {
            if (!groups[d.runner_name]) {
                groups[d.runner_name] = [];
                allRunners.push(d.runner_name);
            }
            groups[d.runner_name].push(d);
        });

        // Real Calculation Logic
        Object.keys(groups).forEach(name => {
            const history = groups[name];
            if (history.length < 2) return;

            const current = history[0].mid_price;
            const initial = history[history.length - 1].mid_price;
            const delta = ((initial - current) / initial) * 100;

            if (Math.abs(delta) >= 0.1) {
                signals.set(name, {
                    label: delta > 0 ? 'STEAMER' : 'DRIFTER',
                    pct: Math.abs(delta) / 100
                });
            }
        });
    }

    // 3. 🛡️ FALLBACK: If history is empty, fetch LIVE runners for Simulation
    // This ensures we have names to fake signals for, even if snapshots are empty.
    if (SIMULATION_MODE && allRunners.length === 0) {
        const { data: liveData } = await supabase
            .from('market_feed')
            .select('runner_name')
            .eq('sport', activeSport)
            .limit(50);
            
        if (liveData) {
            allRunners = liveData.map(r => r.runner_name);
        }
    }

    // 4. 🧪 SIMULATION INJECTION
    if (SIMULATION_MODE && allRunners.length > 0) {
      // Pick 3-5 random runners to fake steam for
      const shuffled = allRunners.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, 5); 

      selected.forEach((name, index) => {
        // Alternate between Steam (Green) and Drift (Red)
        const isSteam = index % 2 === 0; 
        const fakePct = (Math.random() * 5 + 1.5).toFixed(1); 

        signals.set(name, {
          label: isSteam ? 'STEAMER' : 'DRIFTER',
          pct: parseFloat(fakePct) / 100
        });
      });
    }

    // 5. Broadcast to Parent
    onSteamersChange(new Set(signals.keys()), signals);
  }, [activeSport, onSteamersChange]);

  useEffect(() => {
    fetchMovement();
    const interval = setInterval(fetchMovement, 5000); // Fast 5s updates
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null;
}