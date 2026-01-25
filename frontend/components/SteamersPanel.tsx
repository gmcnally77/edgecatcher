'use client';
import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '../utils/supabase';

// --- TUNING (DECEMBER 7th STYLE) ---
const LOOKBACK_MINUTES = 60;       
const MIN_TREND_DURATION_MIN = 0;  // 0 = Show immediate moves (Don't wait 1m)
const MOVEMENT_THRESHOLD = 0.005;  // 0.5% move triggers badge (Highly sensitive)
const MIN_VOLUME = 50;             // Keep low to catch early liquidity

interface Snapshot {
  runner_name: string;
  mid_price: number;
  volume: number;
  ts: string;
}

export default function SteamersPanel({ activeSport, onSteamersChange }: any) {
  const isMounted = useRef(true);
  
  // Refs to hold state silently
  const lastKnownEvents = useRef<Set<string>>(new Set());
  const lastKnownSignals = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchMovement = useCallback(async () => {
    if (!activeSport) return;

    // 1. FETCH HISTORY
    const timeHorizon = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('runner_name, mid_price, volume, ts')
      .eq('sport', activeSport)
      .gt('ts', timeHorizon)
      .order('ts', { ascending: false }) 
      .limit(4000);

    if (error || !data || data.length === 0) return;

    // 2. GROUP
    const groups: Record<string, Snapshot[]> = {};
    const signals = new Map();
    const eventSet = new Set<string>();

    data.forEach((row: Snapshot) => {
      if (!groups[row.runner_name]) groups[row.runner_name] = [];
      groups[row.runner_name].push(row);
    });

    // 3. ANALYZE (Red/Green Logic)
    Object.entries(groups).forEach(([name, history]) => {
      if (history.length < 2) return;

      const current = history[0]; 
      const oldest = history[history.length - 1]; 
      
      if (current.volume < MIN_VOLUME) return;

      const ageMillis = new Date(current.ts).getTime() - new Date(oldest.ts).getTime();
      const ageMinutes = ageMillis / 60000;

      if (ageMinutes < MIN_TREND_DURATION_MIN) return;

      // Calculate % Move
      const delta = (current.mid_price - oldest.mid_price) / oldest.mid_price;
      const absDelta = Math.abs(delta);

      if (absDelta >= MOVEMENT_THRESHOLD) {
        // Drop (Negative) = Steam (Green)
        // Rise (Positive) = Drift (Red)
        const type = delta < 0 ? 'STEAMER' : 'DRIFT'; 
        
        signals.set(name, {
          label: type,
          pct: absDelta,
          startPrice: oldest.mid_price,
          endPrice: current.mid_price,
          vol: current.volume,
          duration: Math.round(ageMinutes)
        });
        eventSet.add(name);
      } 
    });

    lastKnownEvents.current = eventSet;
    lastKnownSignals.current = signals;

    if (isMounted.current) {
      onSteamersChange(eventSet, signals);
    }

  }, [activeSport, onSteamersChange]);

  useEffect(() => {
    fetchMovement();
    const interval = setInterval(fetchMovement, 4000); // 4s Poll
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null;
}