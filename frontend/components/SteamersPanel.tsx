'use client';
import { useEffect, useCallback } from 'react';
import { supabase } from '@/utils/supabase';

const SIMULATION_MODE = false; // Disable fake signals in component

export default function SteamersPanel({ activeSport, onSteamersChange }: any) {
  const fetchMovement = useCallback(async () => {
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    
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

    data.forEach(d => {
      if (!groups[d.runner_name]) groups[d.runner_name] = [];
      groups[d.runner_name].push(d);
    });

    Object.keys(groups).forEach(name => {
      const history = groups[name];
      if (history.length < 2) return;

      const latest = history[0];
      const oldest = history[history.length - 1];

      if (latest.mid_price <= 1.01 || oldest.mid_price <= 1.01) return;

      const delta = ((oldest.mid_price - latest.mid_price) / oldest.mid_price) * 100;

      // 1.5% Threshold for Real Money
      if (Math.abs(delta) >= 1.5) {
        signals.set(name, {
          label: delta > 0 ? 'STEAMER' : 'DRIFTER',
          pct: Math.abs(delta) / 100
        });
      }
    });

    onSteamersChange(new Set(signals.keys()), signals);
  }, [activeSport, onSteamersChange]);

  useEffect(() => {
    fetchMovement();
    const interval = setInterval(fetchMovement, 10000); 
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null;
}