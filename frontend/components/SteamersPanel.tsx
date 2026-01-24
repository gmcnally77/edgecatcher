'use client';
import { useEffect, useCallback } from 'react';
import { supabase } from '@/utils/supabase';

// 🚨 SIMULATION OFF: Only real data passes through now.
const SIMULATION_MODE = false; 

export default function SteamersPanel({ activeSport, onSteamersChange }: any) {
  const fetchMovement = useCallback(async () => {
    // 1. Fetch Snapshots (Last 60 mins)
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    
    // We fetch more rows to ensure we get history for all active runners
    let { data, error } = await supabase
      .from('market_snapshots')
      .select('*')
      .eq('sport', activeSport)
      .gt('ts', hourAgo)
      .order('ts', { ascending: false })
      .limit(1000); 

    if (error || !data || data.length === 0) return;

    const signals = new Map();
    const groups: Record<string, any[]> = {};

    // 2. Group Data
    data.forEach(d => {
      if (!groups[d.runner_name]) groups[d.runner_name] = [];
      groups[d.runner_name].push(d);
    });

    // 3. 🛡️ CREDIBLE SIGNAL LOGIC
    Object.keys(groups).forEach(name => {
      const history = groups[name];
      if (history.length < 2) return; // Need at least 2 data points

      const latest = history[0];
      const oldest = history[history.length - 1];

      // A) Volume Filter: Ignore thin markets (< £500 traded)
      //    False signals often come from markets with £50 matched.
      if (latest.volume < 500) return;

      const currentPrice = latest.mid_price;
      const initialPrice = oldest.mid_price;
      
      // Safety: Ignore prices < 1.01
      if (currentPrice <= 1.01 || initialPrice <= 1.01) return;

      // Calculate % Move
      const delta = ((initialPrice - currentPrice) / initialPrice) * 100;

      // B) Threshold: Must move at least 2.0% to be "Credible"
      //    Example: 2.00 -> 1.96 is a 2% drop.
      if (Math.abs(delta) >= 2.0) {
        signals.set(name, {
          label: delta > 0 ? 'STEAMER' : 'DRIFTER', // Positive delta = Price dropped (Shortened) = STEAM
          pct: Math.abs(delta) / 100
        });
      }
    });

    // 4. Broadcast Real Signals
    onSteamersChange(new Set(signals.keys()), signals);
  }, [activeSport, onSteamersChange]);

  useEffect(() => {
    fetchMovement();
    const interval = setInterval(fetchMovement, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null;
}