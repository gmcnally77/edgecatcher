'use client';
import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '../utils/supabase';

// --- CONFIGURATION ---
const STEAM_WINDOW_MINUTES = 1440; // 🚨 LOOK BACK 24 HOURS (Catch everything)
const MIN_VOLUME = 0;              // 🚨 ZERO VOLUME FILTER (Show me everything)
const STEAM_THRESHOLD = 0.0001;    // 🚨 0.01% THRESHOLD (Trigger on breathing)
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

    // 1. FETCH (Newest First)
    // Looking back 24 hours to guarantee we find your data
    const timeHorizon = new Date(Date.now() - STEAM_WINDOW_MINUTES * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('runner_name, mid_price, volume, ts')
      .eq('sport', activeSport)
      .gt('ts', timeHorizon)
      .order('ts', { ascending: false }) // Newest first
      .limit(MAX_SNAPSHOTS);

    if (error) {
      console.error("Supabase Error:", error);
      return;
    }

    if (!data || data.length === 0) {
      // console.log(`[Steamers] Empty DB for ${activeSport}`);
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
      // Reverse to [Oldest, ..., Newest]
      const history = rawHistory.reverse(); 

      if (history.length < 2) return;

      const start = history[0];                
      const end = history[history.length - 1]; 

      // 🛑 REMOVED: Freshness Check (This was killing your data)
      // 🛑 REMOVED: Volume Check (Set to 0 above)

      // Price Logic
      const delta = (start.mid_price - end.mid_price) / start.mid_price;
      
      // LOG EVERYTHING (Check your browser console)
      // console.log(`ANALYZING ${name}: ${start.mid_price} -> ${end.mid_price} (Delta: ${delta})`);

      if (delta >= STEAM_THRESHOLD) {
        signals.set(name, {
          label: 'STEAMER',
          pct: delta,
          startPrice: start.mid_price,
          endPrice: end.mid_price
        });
        eventSet.add(name);
      } 
      else if (delta <= -DRIFT_THRESHOLD) {
        signals.set(name, {
          label: 'DRIFTER',
          pct: Math.abs(delta),
          startPrice: start.mid_price,
          endPrice: end.mid_price
        });
        // Uncomment to see drifters in grid
        // eventSet.add(name); 
      }
    });

    if (isMounted.current) {
      onSteamersChange(eventSet, signals);
    }

  }, [activeSport, onSteamersChange]);

  useEffect(() => {
    fetchMovement();
    const interval = setInterval(fetchMovement, 5000); 
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null;
}