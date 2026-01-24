'use client';
import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '../utils/supabase';

// --- CONFIGURATION ---
const STEAM_WINDOW_MINUTES = 30;  // Look back 30 mins (Matched to query limit)
const MIN_VOLUME = 500;           // Ignore low liquidity markets

// ⚠️ TEST MODE: 0.0001 (0.01%) - Triggers on everything
// 🟢 PROD MODE: 0.03 (3.0%) - Triggers on real steam
const STEAM_THRESHOLD = 0.0001;   

const DRIFT_THRESHOLD = 0.03;     
const MAX_SNAPSHOTS = 2000;       

interface Snapshot {
  runner_name: string;
  mid_price: number;
  volume: number;
  ts: string;
}

export default function SteamersPanel({ activeSport, onSteamersChange }: any) {
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchMovement = useCallback(async () => {
    if (!activeSport) return;

    const timeHorizon = new Date(Date.now() - STEAM_WINDOW_MINUTES * 60 * 1000).toISOString();

    // 1. FETCH (Newest First)
    // We sort descending to ensure we get the latest prices even if the DB is huge.
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('runner_name, mid_price, volume, ts')
      .eq('sport', activeSport)
      .gt('ts', timeHorizon)
      .order('ts', { ascending: false }) // Newest first
      .limit(MAX_SNAPSHOTS);

    if (error || !data || data.length === 0) {
      if (isMounted.current) onSteamersChange(new Set(), new Map());
      return;
    }

    // 2. GROUP
    const groups: Record<string, Snapshot[]> = {};
    const signals = new Map();
    const eventSet = new Set<string>();

    data.forEach((row: Snapshot) => {
      if (!groups[row.runner_name]) groups[row.runner_name] = [];
      groups[row.runner_name].push(row);
    });

    // 3. ANALYZE
    Object.entries(groups).forEach(([name, rawHistory]) => {
      // rawHistory is [Newest, ..., Oldest]
      // Reverse it to be [Oldest, ..., Newest] for logical comparison
      const history = rawHistory.reverse(); 

      if (history.length < 2) return;

      const start = history[0];                // Oldest
      const end = history[history.length - 1]; // Newest (Current)

      // A. Freshness Check (Ignore stale data > 15 mins old)
      const lastUpdate = new Date(end.ts).getTime();
      if (Date.now() - lastUpdate > 15 * 60 * 1000) return;

      // B. Volume Check
      if (end.volume < MIN_VOLUME) return;

      // C. Price Logic
      // Delta = (Old - New) / Old
      // Example: (2.00 - 1.80) / 2.00 = +0.10 (10% Steam)
      const delta = (start.mid_price - end.mid_price) / start.mid_price;

      if (delta >= STEAM_THRESHOLD) {
        signals.set(name, {
          label: 'STEAMER',
          pct: delta,
          startPrice: start.mid_price,
          endPrice: end.mid_price
        });
        eventSet.add(name);
      } else if (delta <= -DRIFT_THRESHOLD) {
        signals.set(name, {
          label: 'DRIFTER',
          pct: Math.abs(delta),
          startPrice: start.mid_price,
          endPrice: end.mid_price
        });
        // eventSet.add(name); // Optional: Enable to see Drifters too
      }
    });

    // 4. BROADCAST
    if (isMounted.current) {
      onSteamersChange(eventSet, signals);
    }

  }, [activeSport, onSteamersChange]);

  useEffect(() => {
    fetchMovement();
    const interval = setInterval(fetchMovement, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null;
}