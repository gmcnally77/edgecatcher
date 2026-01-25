'use client';
import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '../utils/supabase';

// --- CONFIGURATION ---
const LOOKBACK_MINUTES = 60;       // Fetch last hour of data
const MIN_TREND_DURATION_MIN = 1;  // Minimum 1 minute history to declare steam
const STEAM_THRESHOLD = 0.03;      // 3% drop required (Slightly more sensitive)
const MIN_VOLUME = 50;             // Lowered from 500 to 50 for testing visibility

interface Snapshot {
  runner_name: string;
  mid_price: number;
  volume: number;
  ts: string;
}

export default function SteamersPanel({ activeSport, onSteamersChange }: any) {
  const isMounted = useRef(true);
  
  // Keep previous state to prevent flickering on network blips
  const lastKnownEvents = useRef<Set<string>>(new Set());
  const lastKnownSignals = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchMovement = useCallback(async () => {
    if (!activeSport) return;

    // 1. FETCH (Last 60 mins)
    const timeHorizon = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('runner_name, mid_price, volume, ts')
      .eq('sport', activeSport)
      .gt('ts', timeHorizon)
      .order('ts', { ascending: false }) // Newest first
      .limit(3000);

    // If error, do NOT clear state (prevents flicker). Only return.
    if (error || !data) {
      return;
    }

    // If genuinely empty data (script not running), we can clear.
    if (data.length === 0) {
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

    // 3. ANALYZE (Flexible Velocity Logic)
    Object.entries(groups).forEach(([name, history]) => {
      // History is sorted Newest [0] -> Oldest [N]
      if (history.length < 2) return;

      const current = history[0];
      
      // Filter out total garbage (optional, keeps grid clean)
      if (current.volume < MIN_VOLUME) return;

      // Instead of hunting for a specific 5-15m snapshot, use the OLDEST valid snapshot available.
      // This ensures we catch steam whether it happened over 2 mins or 40 mins.
      const oldest = history[history.length - 1];
      
      const ageMillis = new Date(current.ts).getTime() - new Date(oldest.ts).getTime();
      const ageMinutes = ageMillis / 60000;

      // Must have at least X mins of data to establish a trend
      if (ageMinutes < MIN_TREND_DURATION_MIN) return;

      // Calculate Drop
      // Start: 2.00 -> End: 1.80 = (2.00 - 1.80) / 2.00 = 0.10 (10% Steam)
      const delta = (oldest.mid_price - current.mid_price) / oldest.mid_price;

      if (delta >= STEAM_THRESHOLD) {
        signals.set(name, {
          label: 'STEAMER',
          pct: delta,
          startPrice: oldest.mid_price,
          endPrice: current.mid_price,
          vol: current.volume,
          duration: Math.round(ageMinutes)
        });
        eventSet.add(name);
      } 
    });

    // Update Refs
    lastKnownEvents.current = eventSet;
    lastKnownSignals.current = signals;

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