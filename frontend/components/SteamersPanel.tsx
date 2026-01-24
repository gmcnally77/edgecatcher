'use client';
import { useEffect, useCallback } from 'react';
import { supabase } from '@/utils/supabase';

// ✅ KEEP TRUE to verify the green badge works
const SIMULATION_MODE = true; 

export default function SteamersPanel({ activeSport, onSteamersChange }: any) {
  const fetchMovement = useCallback(async () => {
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    
    // 1. Fetch History
    let { data: snapshots } = await supabase
      .from('market_snapshots')
      .select('*')
      .eq('sport', activeSport)
      .gt('ts', hourAgo)
      .order('ts', { ascending: false })
      .limit(1000);

    const signals = new Map();
    const groups: Record<string, any[]> = {};
    let activeRunners: string[] = [];

    // 2. Process Real Data
    if (snapshots && snapshots.length > 0) {
      snapshots.forEach(d => {
        if (!groups[d.runner_name]) {
          groups[d.runner_name] = [];
          activeRunners.push(d.runner_name);
        }
        groups[d.runner_name].push(d);
      });

      Object.keys(groups).forEach(name => {
        const history = groups[name];
        if (history.length < 2) return;

        const current = history[0].mid_price;
        const initial = history[history.length - 1].mid_price;
        if (current <= 1.01 || initial <= 1.01) return;

        const delta = ((initial - current) / initial) * 100;

        if (Math.abs(delta) >= 1.5) {
          signals.set(name, {
            label: delta > 0 ? 'STEAMER' : 'DRIFTER',
            pct: Math.abs(delta) / 100
          });
        }
      });
    }

    // 3. Fallback for Empty DB (Self-Healing)
    if (activeRunners.length === 0) {
       const { data: liveFeed } = await supabase
         .from('market_feed')
         .select('runner_name')
         .eq('sport', activeSport)
         .limit(50);
       
       if (liveFeed) {
         activeRunners = liveFeed.map(r => r.runner_name);
       }
    }

    // 4. Inject Test Signals (Visual Verification)
    if (SIMULATION_MODE && activeRunners.length > 0) {
      const shuffled = activeRunners.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, 4); 

      selected.forEach((name, index) => {
        // Alternate Green/Red to prove styles work
        const isSteam = index % 2 === 0; 
        signals.set(name, {
          label: isSteam ? 'STEAMER' : 'DRIFTER',
          pct: 0.05
        });
      });
    }

    onSteamersChange(new Set(signals.keys()), signals);
  }, [activeSport, onSteamersChange]);

  useEffect(() => {
    fetchMovement();
    const interval = setInterval(fetchMovement, 5000); 
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null;
}