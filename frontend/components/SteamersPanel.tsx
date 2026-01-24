'use client';
import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '../utils/supabase';

// --- CONFIGURATION ---
const LOOKBACK_MINUTES = 60;       // Window to find the "High Water Mark"
const STEAM_THRESHOLD = 0.03;      // 3% drop from the recent high triggers signal
const MIN_VOLUME = 500;            // Minimum volume to be credible

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

    // 1. FETCH (Last 60 mins)
    const timeHorizon = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('runner_name, mid_price, volume, ts')
      .eq('sport', activeSport)
      .gt('ts', timeHorizon)
      .order('ts', { ascending: false }) 
      .limit(2000);

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

    // 3. ANALYZE (High Water Mark Logic)
    Object.entries(groups).forEach(([name, history]) => {
      if (history.length < 2) return;

      const current = history[0]; // Newest
      
      // Volume Filter
      if (current.volume < MIN_VOLUME) return;

      // Find the HIGHEST price in this window (The "High Water Mark")
      // We look for a drop FROM the high TO the current.
      let maxPrice = 0;
      let maxPriceTs = '';
      
      history.forEach(snap => {
        if (snap.mid_price > maxPrice) {
          maxPrice = snap.mid_price;
          maxPriceTs = snap.ts;
        }
      });

      // Avoid noise: Ensure the "High" wasn't just the current tick (no move)
      if (maxPrice <= current.mid_price) return;

      // Calculate Drop %
      const delta = (maxPrice - current.mid_price) / maxPrice;

      if (delta >= STEAM_THRESHOLD) {
        // Calculate time diff in minutes
        const timeDiff = Math.round((new Date(current.ts).getTime() - new Date(maxPriceTs).getTime()) / 60000);
        
        signals.set(name, {
          label: 'STEAMER',
          pct: delta,
          startPrice: maxPrice,
          endPrice: current.mid_price,
          vol: current.volume,
          timeDesc: `${timeDiff}m ago`
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
    const interval = setInterval(fetchMovement, 5000); // 5s polling for snappier updates
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null;
}