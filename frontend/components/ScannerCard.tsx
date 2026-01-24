'use client';
import { Pin, TrendingUp, Lock } from 'lucide-react';

// --- SUB-COMPONENTS ---

const BookieBtn = ({ label, price, color }: any) => {
  const colors: any = {
      orange: "border-orange-500/30 text-orange-400 bg-orange-500/5",
      slate: "border-slate-500/30 text-slate-400 bg-slate-500/5",
      emerald: "border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
  };
  const c = colors[color] || colors.slate;

  return (
      <div className={`col-span-1 rounded border flex flex-col items-center justify-center ${c}`}>
           <span className="text-[8px] font-bold uppercase opacity-70">{label}</span>
           <span className="text-sm font-bold">{price > 1 ? price.toFixed(2) : '-'}</span>
      </div>
  );
};

const PaywallOverlay = ({ onUnlock }: any) => (
  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-[2px]">
      <button 
          onClick={onUnlock}
          className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-4 py-2 rounded-lg shadow-xl border border-blue-400/50 flex items-center gap-2 hover:scale-105 transition-all"
      >
          <Lock size={12} className="text-yellow-400" />
          Unlock
      </button>
  </div>
);

// --- MAIN CARD COMPONENT ---

interface ScannerCardProps {
  event: any;
  steamerSignals: Map<string, any>;
  pinned: Set<string>;
  onTogglePin: (name: string) => void;
  isPaywalled: boolean;
  onUnlock: () => void;
}

export default function ScannerCard({ 
  event, 
  steamerSignals, 
  pinned, 
  onTogglePin, 
  isPaywalled, 
  onUnlock 
}: ScannerCardProps) {

  const formatTime = (isoString: string) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  };

  // SORT LOGIC: Pinned -> Steaming -> Normal
  const sortedRunners = [...event.selections].sort((a: any, b: any) => {
      if (pinned.has(a.name) && !pinned.has(b.name)) return -1;
      if (!pinned.has(a.name) && pinned.has(b.name)) return 1;
      
      const sigA = steamerSignals.get(a.name);
      const sigB = steamerSignals.get(b.name);
      if (sigA && !sigB) return -1;
      if (!sigA && sigB) return 1;
      return 0;
  });

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-lg relative">
        {/* HEADER */}
        <div className="bg-[#1f2937]/50 px-4 py-2 border-b border-slate-800 flex justify-between items-center">
            <h3 className="text-slate-200 font-bold text-xs truncate pr-4">{event.name}</h3>
            <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">
                {event.in_play ? <span className="text-red-500 font-bold">● LIVE</span> : formatTime(event.start_time)}
            </span>
        </div>

        {/* RUNNER LIST */}
        <div className={`divide-y divide-slate-800 ${isPaywalled ? 'blur-sm select-none opacity-40 pointer-events-none' : ''}`}>
            {sortedRunners.map((runner: any) => {
                const signal = steamerSignals.get(runner.name);
                const isPinned = pinned.has(runner.name);
                
                // BEST PRICE LOGIC
                const books = [
                    { n: 'Pin', p: runner.bookmakers.pinnacle },
                    { n: 'Lad', p: runner.bookmakers.ladbrokes },
                    { n: 'PP', p: runner.bookmakers.paddypower }
                ].filter(b => b.p > 1);
                const best = books.reduce((max, curr) => curr.p > max.p ? curr : max, { n: '', p: 0 });
                
                let diff = 0;
                if (best.p > 1 && runner.exchange.back > 1) {
                    const mid = (runner.exchange.back + runner.exchange.lay) / 2;
                    diff = ((best.p / mid) - 1) * 100;
                }

                return (
                    <div key={runner.id} className="p-3">
                        {/* ROW 1: Name + Pin + Signal */}
                        <div className="flex justify-between items-start mb-1">
                            <div className="flex items-center gap-2">
                                <span className={`font-bold text-sm ${signal ? 'text-emerald-400' : 'text-slate-200'}`}>
                                    {runner.name}
                                </span>
                                <button onClick={() => onTogglePin(runner.name)} className="opacity-50 hover:opacity-100 transition-opacity p-1">
                                    <Pin size={12} className={isPinned ? "fill-blue-500 text-blue-500" : "text-slate-600"} />
                                </button>
                            </div>
                            {signal && (
                                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 rounded border border-emerald-500/20 font-mono flex items-center gap-1">
                                    <TrendingUp size={10} />
                                    {Math.abs(signal.pct * 100).toFixed(1)}% ({signal.timeDesc})
                                </span>
                            )}
                        </div>

                        {/* ROW 2: Best Price Info */}
                        {best.p > 0 && (
                            <div className="text-[10px] font-mono mb-2 flex items-center gap-1.5">
                                <span className="text-slate-500">Best:</span>
                                <span className="text-slate-300 font-bold">{best.n} {best.p.toFixed(2)}</span>
                                <span className={diff > 0 ? "text-emerald-500" : "text-slate-600"}>
                                    ({diff > 0 ? '+' : ''}{diff.toFixed(1)}%)
                                </span>
                            </div>
                        )}

                        {/* ROW 3: 5-COLUMN GRID (MOBILE FIX) */}
                        <div className="grid grid-cols-5 gap-1.5 h-11">
                            {/* EXCHANGE */}
                            <div className="col-span-1 bg-[#0c1829] border border-[#1e3a8a] rounded flex flex-col items-center justify-center">
                                <span className="text-[8px] text-blue-500 font-bold uppercase">BACK</span>
                                <span className="text-sm font-bold text-blue-300">{runner.exchange.back?.toFixed(2) || '-'}</span>
                            </div>
                            <div className="col-span-1 bg-[#251016] border border-[#831843] rounded flex flex-col items-center justify-center">
                                <span className="text-[8px] text-pink-500 font-bold uppercase">LAY</span>
                                <span className="text-sm font-bold text-pink-300">{runner.exchange.lay?.toFixed(2) || '-'}</span>
                            </div>

                            {/* BOOKIES */}
                            <BookieBtn label="PIN" price={runner.bookmakers.pinnacle} color="orange" />
                            <BookieBtn label="LAD" price={runner.bookmakers.ladbrokes} color="slate" />
                            <BookieBtn label="PP" price={runner.bookmakers.paddypower} color="emerald" />
                        </div>
                    </div>
                );
            })}
        </div>
        {isPaywalled && <PaywallOverlay onUnlock={onUnlock} />}
    </div>
  );
}