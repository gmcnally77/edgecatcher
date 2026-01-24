'use client';
import { useEffect } from 'react';

// 🚨 DIAGNOSTIC MODE: NO DATABASE, JUST HARDCODED SIGNALS
export default function SteamersPanel({ activeSport, onSteamersChange }: any) {
  
  useEffect(() => {
    console.log("⚠️ FORCE-INJECTING STEAM SIGNALS");

    const activeSignals = new Map();
    const activeNames = new Set<string>();

    // 1. Force Green Steam on Cleveland
    const runner1 = "Cleveland Cavaliers";
    activeSignals.set(runner1, { label: 'STEAMER', pct: 0.15 }); // 15% drop
    activeNames.add(runner1);

    // 2. Force Red Drift on Knicks
    const runner2 = "New York Knicks";
    activeSignals.set(runner2, { label: 'DRIFTER', pct: 0.05 }); // 5% drift
    activeNames.add(runner2);

    // 3. Broadcast immediately (and keep doing it)
    const interval = setInterval(() => {
        onSteamersChange(activeNames, activeSignals);
    }, 1000);

    // Run once on mount
    onSteamersChange(activeNames, activeSignals);

    return () => clearInterval(interval);
  }, [onSteamersChange]);

  return null;
}