'use client';
import { useEffect, useCallback } from 'react';
import { supabase } from '@/utils/supabase';

export default function SteamersPanel({ activeSport, onSteamersChange }: any) {
  const fetchMovement = useCallback(async () => {
    // Get last 1 hour of snapshots for current sport
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('*')
      .eq('sport', activeSport)
      .gt('ts', hourAgo)
      .order('ts', { ascending: false });

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

      const current = history[0].mid_price;
      const initial = history[history.length - 1].mid_price;
      const delta = ((initial - current) / initial) * 100;

      // ✅ ADJUSTED THRESHOLD: 1.0% (Was 1.5%)
      // This is more sensitive for pre-match markets
      if (Math.abs(delta) >= 1.0) {
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
    const interval = setInterval(fetchMovement, 15000);
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null; // Silent logic provider
}