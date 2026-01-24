'use client';
import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '../utils/supabase';

// --- CONFIGURATION ---
const LOOKBACK_MINUTES = 60;       // Fetch last hour of data
const COMPARISON_WINDOW_MIN = 5;   // Compare NOW vs 5 mins ago
const COMPARISON_WINDOW_MAX = 15;  // ...up to 15 mins ago
const STEAM_THRESHOLD = 0.04;      // 4% drop required to trigger
const MIN_VOLUME = 500;            // Ignore low liquidity garbage

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

    // 1. FETCH (Last 60 mins only - speed up query)
    const timeHorizon = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('runner_name, mid_price, volume, ts')
      .eq('sport', activeSport)
      .gt('ts', timeHorizon)
      .order('ts', { ascending: false }) 
      .limit(3000); // Increased limit for tighter resolution

    if (error || !data || data.length === 0) {
      if (isMounted.current) onSteamersChange(new Set(), new Map());
      return;
    }

    // 2. GROUP
    const groups: Record<string, Snapshot[]> = {};
    const signals = new Map();
    const eventSet = new Set<string>();
    const now = Date.now();

    data.forEach((row: Snapshot) => {
      if (!groups[row.runner_name]) groups[row.runner_name] = [];
      groups[row.runner_name].push(row);
    });

    // 3. ANALYZE (Velocity Logic)
    Object.entries(groups).forEach(([name, history]) => {
      // History is sorted Newest -> Oldest
      if (history.length < 2) return;

      const current = history[0];
      
      // Filter out low volume (noise)
      if (current.volume < MIN_VOLUME) return;

      // Find a reference point in the "Sweet Spot" (5 to 15 mins ago)
      const reference = history.find(snap => {
        const ageMinutes = (now - new Date(snap.ts).getTime()) / 60000;
        return ageMinutes >= COMPARISON_WINDOW_MIN && ageMinutes <= COMPARISON_WINDOW_MAX;
      });

      if (!reference) return;

      // Calculate Drop
      // 2.50 -> 2.00 = (2.50 - 2.00) / 2.50 = 0.20 (20% Steam)
      const delta = (reference.mid_price - current.mid_price) / reference.mid_price;

      if (delta >= STEAM_THRESHOLD) {
        signals.set(name, {
          label: 'STEAMER',
          pct: delta,
          startPrice: reference.mid_price,
          endPrice: current.mid_price,
          vol: current.volume
        });
        eventSet.add(name);
      } 
    });

    if (isMounted.current) {
      onSteamersChange(eventSet, signals);
    }

  }, [activeSport, onSteamersChange]);

  useEffect(() => {
    fetchMovement();
    const interval = setInterval(fetchMovement, 10000); // 10s polling
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null;
}