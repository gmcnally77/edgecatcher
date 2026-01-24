'use client';
import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '../utils/supabase';

// --- CONFIGURATION ---
const LOOKBACK_MINUTES = 120;      // Look back 2 hours
const STEAM_THRESHOLD = 0.02;      // 2% drop triggers alert
const MIN_VOLUME = 100;            // Lower volume floor to catch early moves

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

    const timeHorizon = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('runner_name, mid_price, volume, ts')
      .eq('sport', activeSport)
      .gt('ts', timeHorizon)
      .order('ts', { ascending: false }) 
      .limit(4000); 

    if (error || !data || data.length === 0) {
      if (isMounted.current) onSteamersChange(new Set(), new Map());
      return;
    }

    const groups: Record<string, Snapshot[]> = {};
    const signals = new Map();
    const eventSet = new Set<string>();

    data.forEach((row: Snapshot) => {
      if (!groups[row.runner_name]) groups[row.runner_name] = [];
      groups[row.runner_name].push(row);
    });

    Object.entries(groups).forEach(([name, history]) => {
      if (history.length < 2) return;

      const current = history[0]; 
      if (current.volume < MIN_VOLUME) return;

      let maxPrice = 0;
      let maxPriceTs = '';
      
      history.forEach(snap => {
        if (snap.mid_price > maxPrice) {
          maxPrice = snap.mid_price;
          maxPriceTs = snap.ts;
        }
      });

      if (maxPrice <= current.mid_price) return;

      const delta = (maxPrice - current.mid_price) / maxPrice;

      if (delta >= STEAM_THRESHOLD) {
        const timeDiff = Math.round((new Date(current.ts).getTime() - new Date(maxPriceTs).getTime()) / 60000);
        
        signals.set(name, {
          label: 'STEAMER',
          pct: delta,
          startPrice: maxPrice,
          endPrice: current.mid_price,
          vol: current.volume,
          timeDesc: `${timeDiff}m`
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
    const interval = setInterval(fetchMovement, 5000);
    return () => clearInterval(interval);
  }, [fetchMovement]);

  return null;
}