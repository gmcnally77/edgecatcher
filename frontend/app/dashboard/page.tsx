'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import { MarketCard } from '@/components/MarketsCard';
import {
  RefreshCw, Lock, Swords, Dribbble, AlertCircle, Radar, Circle
} from 'lucide-react';

const SPORTS = [
  { id: 'Basketball', label: 'Basketball', icon: <Dribbble size={16} /> },
  { id: 'MMA', label: 'MMA', icon: <Swords size={16} /> },
  { id: 'Soccer', label: 'Soccer', icon: <Circle size={16} /> },
];

// DATA GROUPING ENGINE (With Stable Keys)
const groupData = (data: any[]) => {
  const competitions: Record<string, any[]> = {};

  data.sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());

  data.forEach(row => {
    const compName = row.competition || 'Other';
    if (!competitions[compName]) competitions[compName] = [];

    let market = competitions[compName].find(m =>
        m.id === row.market_id ||
        (m.name === row.event_name && Math.abs(new Date(m.start_time).getTime() - new Date(row.start_time).getTime()) < 3600000)
    );

    if (!market) {
        const stableKey = `${row.event_name}_${row.start_time}`;
        market = {
            id: row.market_id,
            stable_key: stableKey,
            name: row.event_name,
            start_time: row.start_time,
            volume: row.volume,
            in_play: row.in_play,
            market_status: row.market_status,
            selections: []
        };
        competitions[compName].push(market);
    } else {
        if (market.id !== row.market_id) return;
    }

    if (!row.runner_name) return;

    market.selections.push({
        id: row.id,
        name: row.runner_name,
        exchange: { back: row.back_price, lay: row.lay_price },
        bookmakers: {
            pinnacle: row.price_pinnacle,
            ladbrokes: row.price_bet365,
            paddypower: row.price_paddy
        }
    });
  });

  // Sort markets: Live first, then by start time, then alphabetical
  Object.keys(competitions).forEach(key => {
      competitions[key].sort((a, b) => {
          if (a.in_play && !b.in_play) return -1;
          if (!a.in_play && b.in_play) return 1;
          const timeDiff = new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
          if (timeDiff !== 0) return timeDiff;
          return (a.name || '').localeCompare(b.name || '');
      });

      // Sort selections: Soccer = Home, Draw, Away; Others = A-Z
      competitions[key].forEach(market => {
          const hasDraw = market.selections.some((s: any) =>
              (s.name || '').toLowerCase().includes('draw')
          );

          if (hasDraw && market.name) {
              const parts = market.name.split(/ v | vs /i);
              const homeTeam = parts[0]?.trim().toLowerCase() || '';

              market.selections.sort((a: any, b: any) => {
                  const nameA = (a.name || '').toLowerCase();
                  const nameB = (b.name || '').toLowerCase();
                  const getPriority = (name: string) => {
                      if (name.includes('draw')) return 1;
                      if (homeTeam && name.includes(homeTeam.substring(0, 6))) return 0;
                      return 2;
                  };
                  return getPriority(nameA) - getPriority(nameB);
              });
          } else {
              market.selections.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
          }
      });
  });

  return competitions;
};

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0B1120] flex justify-center pt-20"><RefreshCw size={40} className="animate-spin text-blue-500" /></div>}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const searchParams = useSearchParams();
  const [activeSport, setActiveSport] = useState('Basketball');
  const [competitions, setCompetitions] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery] = useState('');

  // PAYWALL STATE
  const [isPaid, setIsPaid] = useState(false);
  const [trialTimeLeft, setTrialTimeLeft] = useState<string>('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');

  // Auto-activate trial from landing page CTA (?trial=start)
  useEffect(() => {
    if (searchParams.get('trial') === 'start') {
      const existing = localStorage.getItem('trial_start');
      const paid = localStorage.getItem('paid') === 'true';
      if (!existing && !paid) {
        localStorage.setItem('trial_start', Date.now().toString());
        setIsPaid(true);
        supabase.from('app_events').insert({ event: 'trial_activated', metadata: { source: 'landing_cta' } }).then(() => {});
      }
    }
  }, [searchParams]);

  // Trial timer
  useEffect(() => {
    const timer = setInterval(() => {
        const start = typeof window !== 'undefined' ? localStorage.getItem('trial_start') : null;
        const paidPerm = typeof window !== 'undefined' && localStorage.getItem('paid') === 'true';

        if (start && !paidPerm) {
            const diff = (parseInt(start) + 24 * 60 * 60 * 1000) - Date.now();
            if (diff <= 0) {
                localStorage.removeItem('trial_start');
                setIsPaid(false);
                setTrialTimeLeft('');
            } else {
                const h = Math.floor(diff / 3600000);
                const m = Math.floor((diff % 3600000) / 60000);
                setTrialTimeLeft(`${h}h ${m}m remaining`);
            }
        } else {
            setTrialTimeLeft('');
        }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Initial auth check + page view tracking
  useEffect(() => {
    const paidStatus = typeof window !== 'undefined' && localStorage.getItem('paid') === 'true';
    const trialStart = typeof window !== 'undefined' ? localStorage.getItem('trial_start') : null;
    const isTrialValid = trialStart && (Date.now() - parseInt(trialStart) < 24 * 60 * 60 * 1000);
    setIsPaid(paidStatus || !!isTrialValid);
    supabase.from('app_events').insert({
        event: 'dashboard_view',
        metadata: {
            ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'bot',
            ref: typeof document !== 'undefined' ? document.referrer : ''
        }
    }).then(() => {});
  }, []);

  const handleUnlock = () => {
    setPaymentRef(`EC-${Math.floor(1000 + Math.random() * 9000)}`);
    setShowPaymentModal(true);
  };
  const handleConfirmPayment = () => {
    localStorage.setItem('paid', 'true');
    setIsPaid(true);
    setShowPaymentModal(false);
  };
  const handleActivateTrial = () => {
    localStorage.setItem('trial_start', Date.now().toString());
    setIsPaid(true);
    setShowPaymentModal(false);
    supabase.from('app_events').insert({ event: 'trial_activated' }).then(() => {});
  };

  const SCOPE_MODE = process.env.NEXT_PUBLIC_SCOPE_MODE || "";

  const visibleSports = SCOPE_MODE.startsWith("NBA_PREMATCH_ML")
    ? SPORTS.filter(s => s.id === 'Basketball' || s.id === 'MMA' || s.id === 'Soccer')
    : SPORTS;

  useEffect(() => {
    if (SCOPE_MODE.startsWith("NBA_PREMATCH_ML") && activeSport !== 'Basketball' && activeSport !== 'MMA' && activeSport !== 'Soccer') {
      setActiveSport('Basketball');
    }
  }, []);

  // Real-time data fetching
  useEffect(() => {
    let isMounted = true;

    const runFetch = async () => {
      const dbCutoff = new Date();
      dbCutoff.setHours(dbCutoff.getHours() - 24);

      let { data, error } = await supabase
        .from('market_feed')
        .select('*')
        .eq('sport', activeSport)
        .gt('start_time', dbCutoff.toISOString())
        .order('start_time', { ascending: true });

      if (!isMounted) return;

      if (error) {
          console.error("Supabase Error:", error);
          return;
      }

      if (data) {
        const nowMs = Date.now();

        const activeRows = data.filter((row: any) => {
            const lastUpdateMs = row.last_updated ? new Date(row.last_updated).getTime() : 0;
            if (nowMs - lastUpdateMs > 20 * 60 * 1000) return false;
            if (row.market_status === 'CLOSED' || row.market_status === 'SETTLED') return false;

            if (SCOPE_MODE.startsWith('NBA_PREMATCH_ML')) {
                if (row.in_play) return false;
                const startTimeMs = new Date(row.start_time).getTime();
                if (startTimeMs < nowMs - (5 * 60 * 1000)) return false;
            }
            return true;
        });

        try {
            const grouped = groupData(activeRows);
            setCompetitions(grouped);
        } catch (e) { console.error(e); }
      }
      setLoading(false);
    };

    setCompetitions({});
    setLoading(true);

    runFetch();
    const interval = setInterval(runFetch, 2000);

    return () => {
        isMounted = false;
        clearInterval(interval);
    };
  }, [activeSport]);

  const filterMarkets = (markets: any[]) => markets.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.selections.some((s: any) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  let globalGameIndex = 0;

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-300 font-sans selection:bg-blue-500/30 selection:text-blue-200">

      {/* DASHBOARD SUB-HEADER: Sport tabs + live indicator */}
      <div className="sticky top-0 z-40 bg-[#0B1120]/95 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 pt-3 pb-0">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    <div className="bg-[#161F32] px-3 py-1.5 rounded-lg border border-slate-700/50 flex items-center gap-2">
                        <Radar size={12} className="text-blue-400 animate-pulse" />
                        <span className="text-xs font-bold text-blue-100 uppercase tracking-wide">Live Price Catcher</span>
                    </div>
                    {trialTimeLeft && (
                        <div className="hidden md:flex flex-col items-end">
                            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">Trial Active</span>
                            <span className="text-[10px] font-mono text-emerald-500/80">{trialTimeLeft}</span>
                        </div>
                    )}
                    {!isPaid && (
                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                            <Lock size={10} /> Limited View
                        </span>
                    )}
                </div>
            </div>

            {/* SPORT TABS */}
            <div className="flex gap-6 border-b border-transparent overflow-x-auto no-scrollbar touch-pan-x">
                {visibleSports.map((sport) => (
                    <button
                        key={sport.id}
                        onClick={() => setActiveSport(sport.id)}
                        className={`flex items-center gap-2 pb-3 text-sm font-bold transition-all border-b-2 whitespace-nowrap ${
                            activeSport === sport.id
                                ? 'text-white border-blue-500'
                                : 'text-slate-500 border-transparent hover:text-slate-300'
                        }`}
                    >
                        {sport.icon} {sport.label}
                    </button>
                ))}
            </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4 md:py-6 space-y-6">

        {loading && Object.keys(competitions).length === 0 && (
            <div className="flex justify-center py-20">
                <RefreshCw size={40} className="animate-spin text-blue-500" />
            </div>
        )}

        {/* MAIN CONTENT — using MarketCard component */}
        <div className="space-y-8">
            {Object.entries(competitions).sort((a, b) => a[0].localeCompare(b[0])).map(([compName, markets]) => {
                const filtered = filterMarkets(markets);
                if (filtered.length === 0) return null;

                return (
                    <div key={compName}>
                        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
                            <span className="w-1 h-6 bg-blue-500 rounded-full"></span> {compName}
                        </h2>
                        <div className="space-y-3">
                            {filtered.map((event: any) => {
                                const isPaywalled = !isPaid && globalGameIndex >= 3;
                                globalGameIndex++;

                                return (
                                    <MarketCard
                                        key={event.stable_key}
                                        event={event}
                                        activeSport={activeSport}
                                        isPaid={isPaid}
                                        isPaywalled={isPaywalled}
                                        onUnlock={handleUnlock}
                                    />
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>

        {/* EMPTY STATE */}
        {Object.keys(competitions).length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-600">
                <AlertCircle size={48} className="mb-4 opacity-20" />
                <p className="text-lg font-medium">No active markets found for {activeSport}</p>
            </div>
        )}
      </div>

      {/* PAYMENT MODAL */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#161F32] border border-blue-500/30 rounded-xl p-6 max-w-sm w-full shadow-2xl space-y-5 relative">
            <div className="text-center space-y-1">
              <h3 className="text-white font-bold text-lg leading-tight">Unlock EdgeCatcher</h3>
              <p className="text-blue-400 font-mono font-bold text-lg">£25 / month</p>
            </div>

            <div className="w-full bg-emerald-600/20 text-emerald-400 font-bold py-3 rounded-lg border border-emerald-500/30 flex flex-col items-center justify-center gap-0.5">
              <span className="text-xs uppercase tracking-wider">Money Back Guarantee</span>
              <span className="text-[10px] opacity-90 font-medium">Make Money Month One or Your Money Back</span>
            </div>

            <div className="bg-[#0B1120] p-4 rounded-lg text-sm text-slate-300 space-y-4 border border-slate-800">
              <div className="leading-relaxed">
                <span className="font-bold text-white block mb-2 text-xs uppercase tracking-tight">Step 1: Secure Payment</span>
                <a
                  href="https://buy.stripe.com/7sY9ASeya3bT7i30sr6sw01"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center w-full bg-[#635BFF] hover:bg-[#5851e5] text-white font-bold py-4 rounded-lg shadow-lg transition-all text-sm"
                >
                  Pay with Stripe
                </a>
                <div className="mt-3 flex items-center justify-between bg-black/30 border border-slate-700/50 rounded px-3 py-2">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Payment Ref:</span>
                  <span className="font-mono font-bold text-white">{paymentRef}</span>
                </div>
              </div>

              <div className="leading-relaxed border-t border-slate-800 pt-4">
                <span className="font-bold text-white block mb-2 text-xs uppercase tracking-tight">Step 2: Instant Activation</span>
                <a
                  href="https://t.me/exchange_steamers_bot"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center w-full bg-[#229ED9] hover:bg-[#1e8ebc] text-white font-bold py-3 rounded-lg shadow-md transition-all text-xs"
                >
                  Message @Exchange_Steamers_Bot to Unlock
                </a>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <button
                onClick={handleConfirmPayment}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 rounded-lg w-full transition-all text-xs border border-slate-700"
              >
                I'VE PAID — REFRESH ACCESS
              </button>
              <button
                onClick={handleActivateTrial}
                className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 font-bold py-2.5 rounded-lg w-full transition-all text-xs border border-emerald-500/30"
              >
                START 24H FREE TRIAL
              </button>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="text-slate-500 hover:text-white font-medium text-[10px] py-2 uppercase tracking-widest transition-colors mx-auto"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
