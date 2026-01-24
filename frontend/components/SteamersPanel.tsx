'use client';
import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '../utils/supabase';

// --- CONFIGURATION ---
const STEAM_WINDOW_MINUTES = 60;  // Look back 1 hour
const MIN_VOLUME = 500;           // Ignore low liquidity markets
const STEAM_THRESHOLD = 0.0001;     // 3% move required to flag
const DRIFT_THRESHOLD = 0.03;     // 3% move required to flag
const MAX_SNAPSHOTS = 2000;       // Safety limit for DB fetch

interface Snapshot {
  runner_name: string;
  mid_price: number;
  volume: number;
  ts: string;
}

export default function SteamersPanel({ activeSport, onSteamersChange }: any) {
  // Use ref to prevent race conditions in async intervals
  const isMounted = useRef(true);

  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  const fetchMovement = useCallback(async () => {
    if (!activeSport) return;

    // 1. Time Window
    const timeHorizon = new Date(Date.now() - STEAM_WINDOW_MINUTES * 60 * 1000).toISOString();

    // 2. Fetch History
    // We fetch snapshots for the active sport to calculate trends
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('runner_name, mid_price, volume, ts')
      .eq('sport', activeSport)
      .gt('ts', timeHorizon)
      .order('ts', { ascending: true }) // Oldest first for easy traversal
      .limit(MAX_SNAPSHOTS);

    if (error || !data || data.length === 0) {
      if (isMounted.current) onSteamersChange(new Set(), new Map());
      return;
    }

    // 3. Process Data
    const groups: Record<string, Snapshot[]> = {};
    const signals = new Map();
    const eventSet = new Set<string>();

    // Group by runner
    data.forEach((row: Snapshot) => {
      if (!groups[row.runner_name]) groups[row.runner_name] = [];
      groups[row.runner_name].push(row);
    });

    // Analyze each runner
    Object.entries(groups).forEach(([name, history]) => {
      if (history.length < 2) return;

      const start = history[0];
      const end = history[history.length - 1];

      // A. Freshness Check (If data stopped updating 15 mins ago, ignore it)
      const lastUpdate = new Date(end.ts).getTime();
      const now = Date.now();
      if (now - lastUpdate > 15 * 60 * 1000) return;

      // B. Volume Check
      if (end.volume < MIN_VOLUME) return;

      // C. Price Logic
      // Steam = Price dropping (Odds getting smaller)
      // Drift = Price rising (Odds getting larger)
      // Formula: (Old - New) / Old
      // Example Steam: 2.0 -> 1.8 = (2.0 - 1.8)/2.0 = +0.10 (+10%)
      
      // Ignore extreme outliers (likely API glitches)
      if (start.mid_price > 50 || end.mid_price > 50) return; 

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
        // Only show drifters if high confidence
        signals.set(name, {
          label: 'DRIFTER',
          pct: Math.abs(delta),
          startPrice: start.mid_price,
          endPrice: end.mid_price
        });
        // We typically don't trigger the "Steam Grid" for drifters alone, 
        // but adding to set allows user to see them if they search.
        // Uncomment next line to include drifters in grid:
        // eventSet.add(name);
      }
    });

    // 4. Broadcast
    if (isMounted.current) {
      console.log(`[SteamersPanel] Analyzed ${Object.keys(groups).length} runners, found ${signals.size} moves.`);
      onSteamersChange(eventSet, signals);
    }

  }, [activeSport, onSteamersChange]);

  useEffect(() => {
    fetchMovement();
    const interval = setInterval(fetchMovement, 10000); // Check for steam every 10s
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null;
}