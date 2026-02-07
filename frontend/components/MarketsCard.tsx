import { Lock, Clock, AlertTriangle, Radio } from 'lucide-react';

// --- UTILS ---
const formatTime = (isoString: string) => {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-GB', {
    weekday: 'short', hour: '2-digit', minute: '2-digit'
  });
};

const formatPrice = (p: number) => (p && p > 1 ? p.toFixed(3) : '—');

// --- SUB-COMPONENTS ---

// 1. The Anchor (Exchange Price)
const ExchangeBox = ({ type, price }: { type: 'back' | 'lay'; price: number }) => (
  <div className={`flex flex-col items-center justify-center h-full w-full rounded-sm border ${
    type === 'back' 
      ? 'bg-blue-950/20 border-blue-900/30' 
      : 'bg-pink-950/20 border-pink-900/30'
  }`}>
    <span className={`text-[10px] font-bold uppercase leading-none mb-0.5 ${
      type === 'back' ? 'text-blue-500/70' : 'text-pink-500/70'
    }`}>
      {type === 'back' ? 'B' : 'L'}
    </span>
    <span className={`font-mono text-sm font-bold tracking-tighter ${
      type === 'back' ? 'text-blue-400' : 'text-pink-400'
    }`}>
      {formatPrice(price)}
    </span>
  </div>
);

// 2. The Target (Bookie Price)
const BookieBox = ({ label, price, isBest, hasEdge }: { label: string, price: number, isBest: boolean, hasEdge: boolean }) => {
  // Visual Logic:
  // 1. Edge = Green Background (Action Signal)
  // 2. Best Price = Yellow Border (Target Signal)
  // 3. Normal = Muted (Noise Reduction)
  
  let containerClass = "bg-slate-800/50 border-slate-700 text-slate-500";
  if (hasEdge) containerClass = "bg-emerald-600 border-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.2)]";
  else if (isBest) containerClass = "bg-slate-800 border-yellow-500/80 text-yellow-400";

  return (
    <div className={`flex flex-col items-center justify-center h-full w-full rounded border transition-all ${containerClass}`}>
      <span className={`text-[9px] font-bold uppercase leading-none mb-0.5 ${hasEdge ? 'text-emerald-100' : 'opacity-60'}`}>
        {label}
      </span>
      <span className="font-mono text-sm font-bold tracking-tighter">
        {formatPrice(price)}
      </span>
    </div>
  );
};

// 3. The Row (Individual Runner)
const RunnerRow = ({ runner, activeSport }: { runner: any, activeSport: string }) => {
  // --- CALCULATION LOGIC (Preserved 100%) ---
  const books = [
    { name: 'Pin', p: runner.bookmakers.pinnacle },
    { name: activeSport === 'MMA' ? 'WH' : 'Lad', p: runner.bookmakers.ladbrokes }, //
    { name: 'PP', p: runner.bookmakers.paddypower }
  ];

  // Find Best Bookie
  const best = books.reduce((acc, curr) => (curr.p > 1.0 && curr.p > acc.p) ? curr : acc, { name: '', p: 0 });
  
  // Calc Edge
  let edge = 0;
  let hasEdge = false;
  let edgeColor = 'text-slate-600';

  if (runner.exchange.lay > 1.0 && best.p > 1.0) {
    edge = ((best.p / runner.exchange.lay) - 1) * 100;
    if (edge > 0.01) {
      hasEdge = true;
      edgeColor = 'text-emerald-400 font-bold';
    } else if (edge > -0.01) {
      edgeColor = 'text-amber-400';
    }
  }

  return (
    <div className="group border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors last:border-0">
      
      {/* === MOBILE LAYOUT (Stacked) === */}
      <div className="md:hidden py-2.5 px-3">
        {/* Header: Name + Edge Badge */}
        <div className="flex justify-between items-center mb-2">
          <span className="text-slate-200 font-medium text-sm truncate pr-2">{runner.name}</span>
          {edge !== 0 && (
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${hasEdge ? 'bg-emerald-500/10' : 'bg-slate-800'}`}>
              <span className={`font-mono text-xs ${edgeColor}`}>
                {edge > 0 ? '+' : ''}{edge.toFixed(1)}%
              </span>
            </div>
          )}
        </div>

        {/* Execution Grid: 5 Columns (2 Exchange, 3 Bookies) */}
        <div className="grid grid-cols-5 gap-1.5 h-11">
           {/* Exchange Group (Left) */}
           <div className="col-span-2 grid grid-cols-2 gap-px bg-slate-900 rounded border border-slate-800 overflow-hidden">
             <ExchangeBox type="back" price={runner.exchange.back} />
             <ExchangeBox type="lay" price={runner.exchange.lay} />
           </div>
           
           {/* Bookies Group (Right) */}
           <BookieBox label="PIN" price={runner.bookmakers.pinnacle} isBest={best.name === 'Pin'} hasEdge={best.name === 'Pin' && hasEdge} />
           <BookieBox label={activeSport === 'MMA' ? "WH" : "LAD"} price={runner.bookmakers.ladbrokes} isBest={best.name === (activeSport === 'MMA' ? "WH" : "Lad")} hasEdge={best.name === (activeSport === 'MMA' ? "WH" : "Lad") && hasEdge} />
           <BookieBox label="PP" price={runner.bookmakers.paddypower} isBest={best.name === 'PP'} hasEdge={best.name === 'PP' && hasEdge} />
        </div>
      </div>

      {/* === DESKTOP LAYOUT (Horizontal Terminal) === */}
      <div className="hidden md:grid grid-cols-12 items-center px-4 py-2 gap-4 h-14">
         {/* Name (Cols 1-4) */}
         <div className="col-span-4 flex items-center gap-2">
            <span className="text-slate-300 font-medium text-sm truncate">{runner.name}</span>
         </div>

         {/* Edge (Col 5) */}
         <div className="col-span-1 text-right">
             {edge !== 0 && <span className={`font-mono text-sm ${edgeColor}`}>{edge > 0 ? '+' : ''}{edge.toFixed(1)}%</span>}
         </div>

         {/* Exchange (Cols 6-8) */}
         <div className="col-span-3 grid grid-cols-2 gap-2 max-w-[140px] ml-auto">
            <ExchangeBox type="back" price={runner.exchange.back} />
            <ExchangeBox type="lay" price={runner.exchange.lay} />
         </div>

         {/* Bookies (Cols 9-12) */}
         <div className="col-span-4 grid grid-cols-3 gap-2">
            <BookieBox label="PIN" price={runner.bookmakers.pinnacle} isBest={best.name === 'Pin'} hasEdge={best.name === 'Pin' && hasEdge} />
            <BookieBox label={activeSport === 'MMA' ? "WH" : "LAD"} price={runner.bookmakers.ladbrokes} isBest={best.name === (activeSport === 'MMA' ? "WH" : "Lad")} hasEdge={best.name === (activeSport === 'MMA' ? "WH" : "Lad") && hasEdge} />
            <BookieBox label="PP" price={runner.bookmakers.paddypower} isBest={best.name === 'PP'} hasEdge={best.name === 'PP' && hasEdge} />
         </div>
      </div>
    </div>
  );
};

// 4. The Main Export
export const MarketCard = ({ event, activeSport, isPaid, isPaywalled, onUnlock }: any) => {
    const isSuspended = event.market_status === 'SUSPENDED';
    const isInPlay = event.in_play;

    // Status Styling
    let statusBorder = 'border-slate-800';
    let statusBg = 'bg-[#161F32]';
    if (isSuspended) { statusBorder = 'border-amber-500/40'; statusBg = 'bg-amber-950/10'; }
    if (isInPlay) { statusBorder = 'border-red-500/40'; statusBg = 'bg-red-950/10'; }

    return (
        <div className={`relative rounded-lg border ${statusBorder} ${statusBg} overflow-hidden mb-3 shadow-sm`}>
            
            {/* Header Strip */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900/50 border-b border-slate-800">
                <div className="flex items-center gap-2">
                   {isInPlay && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                   <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      {isInPlay ? 'Live In-Play' : formatTime(event.start_time)}
                   </span>
                </div>
                {/* Desktop Headers (Hidden on Mobile) */}
                <div className="hidden md:flex gap-12 text-[10px] font-bold text-slate-600 uppercase tracking-widest mr-8">
                    <span>Edge</span>
                    <span className="mr-8">Exchange</span>
                    <span>Sportsbooks</span>
                </div>
            </div>

            {/* Runners List */}
            <div className={`bg-[#0f1522] ${isPaywalled ? 'blur-sm select-none opacity-50 pointer-events-none' : ''}`}>
                {event.selections?.map((runner: any) => (
                    <RunnerRow key={runner.id} runner={runner} activeSport={activeSport} />
                ))}
            </div>

            {/* Paywall Overlay */}
            {isPaywalled && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-[1px]">
                    <button 
                        onClick={onUnlock}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded shadow-lg border border-blue-400/50 flex items-center gap-2 transition-transform hover:scale-105"
                    >
                        <Lock size={12} className="text-yellow-400" />
                        Unlock Scanner
                    </button>
                </div>
            )}
        </div>
    );
};