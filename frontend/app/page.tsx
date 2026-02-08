import Link from 'next/link';
import {
  TrendingUp, Zap, Bell, Shield, BarChart3,
  ChevronRight, Clock, Radio
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-300">

      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-600/5 via-transparent to-transparent" />
        <div className="max-w-5xl mx-auto px-4 pt-20 pb-16 md:pt-28 md:pb-24 relative">
          <div className="text-center space-y-6">
            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight leading-tight">
              Bookie vs Exchange.<br />
              <span className="text-blue-400">Real-time.</span>
            </h1>
            <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
              EdgeCatcher compares Pinnacle, Ladbrokes, and PaddyPower against the
              Betfair Exchange lay price. When a bookie is offering more — you see it instantly.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
              <Link
                href="/dashboard?trial=start"
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-3.5 rounded-lg text-base transition-colors inline-flex items-center justify-center gap-2"
              >
                Start 24h Free Trial <ChevronRight size={18} />
              </Link>
              <Link
                href="/dashboard"
                className="border border-slate-700 hover:border-slate-500 text-slate-300 font-bold px-8 py-3.5 rounded-lg text-base transition-colors inline-flex items-center justify-center gap-2"
              >
                View Dashboard
              </Link>
            </div>

            {/* Trust row */}
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 pt-8 text-sm text-slate-500">
              <span className="flex items-center gap-2"><Clock size={14} className="text-blue-400" /> 2-second refresh</span>
              <span className="flex items-center gap-2"><TrendingUp size={14} className="text-blue-400" /> Pinnacle sharp lines</span>
              <span className="flex items-center gap-2"><Bell size={14} className="text-blue-400" /> Telegram alerts</span>
              <span className="flex items-center gap-2"><Radio size={14} className="text-blue-400" /> NBA &middot; EPL &middot; MMA</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section id="how-it-works" className="py-16 md:py-24 border-t border-slate-800/50">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-12">
            How it works
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            <StepCard
              number="1"
              title="We scan"
              description="Every 2 seconds, we pull live prices from Pinnacle, Ladbrokes, and PaddyPower alongside the Betfair Exchange back and lay."
            />
            <StepCard
              number="2"
              title="We compare"
              description="When a bookie price exceeds the exchange lay, that's a positive edge. It's highlighted green so you can see it at a glance."
            />
            <StepCard
              number="3"
              title="You act"
              description="Place the value bet at the bookie. Lay it off on the exchange if you want. Telegram alerts catch moves you'd miss."
            />
          </div>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section className="py-16 md:py-24 border-t border-slate-800/50">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-12">
            What you get
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            <FeatureCard
              icon={<BarChart3 size={24} />}
              title="Live Edge Scanner"
              description="Side-by-side bookie vs exchange prices across NBA, EPL, and MMA. Updated every 2 seconds. Positive edges highlighted green."
            />
            <FeatureCard
              icon={<Bell size={24} />}
              title="Steamer Alerts"
              description="Telegram notifications when a price moves sharply. Catch the move before it settles. Configurable thresholds."
            />
            <FeatureCard
              icon={<Shield size={24} />}
              title="Pinnacle Sharp Line"
              description="The market's sharpest bookmaker price as your reference point. Sourced live from AsianOdds for maximum accuracy."
            />
            <FeatureCard
              icon={<Zap size={24} />}
              title="Multi-Bookie Coverage"
              description="Pinnacle, Ladbrokes, PaddyPower compared in one view. Best price automatically highlighted. More bookmakers coming soon."
            />
          </div>
        </div>
      </section>

      {/* ===== PRICING ===== */}
      <section id="pricing" className="py-16 md:py-24 border-t border-slate-800/50">
        <div className="max-w-lg mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-8">
            Simple pricing
          </h2>

          <div className="bg-[#161F32] border border-slate-700/50 rounded-xl p-8 space-y-6">
            <div>
              <span className="text-4xl font-bold text-white">£25</span>
              <span className="text-slate-400 text-lg"> / month</span>
            </div>

            <ul className="text-sm text-slate-400 space-y-3 text-left max-w-xs mx-auto">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">&#10003;</span>
                Full edge scanner across all sports
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">&#10003;</span>
                Telegram steamer alerts
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">&#10003;</span>
                Cancel anytime, no lock-in
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">&#10003;</span>
                24-hour free trial, no card required
              </li>
            </ul>

            <div className="bg-emerald-600/10 text-emerald-400 font-bold py-2.5 rounded-lg border border-emerald-500/20 text-sm">
              Money back guarantee — make money month one or your money back
            </div>

            <Link
              href="/dashboard?trial=start"
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-3.5 rounded-lg text-base transition-colors inline-flex items-center justify-center gap-2 w-full"
            >
              Start Free Trial <ChevronRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="py-16 md:py-24 border-t border-slate-800/50">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-12">
            FAQ
          </h2>

          <div className="space-y-6">
            <FAQItem
              question="How fresh is the data?"
              answer="Prices update every 2 seconds from live API feeds. Pinnacle prices are sourced directly from AsianOdds for maximum accuracy."
            />
            <FAQItem
              question="What bookmakers do you cover?"
              answer="Pinnacle (the sharpest line in the market), Ladbrokes, and PaddyPower. All compared against the Betfair Exchange. More bookmakers are being added."
            />
            <FAQItem
              question="How do Telegram alerts work?"
              answer="Our steamer bot monitors price movements across all markets. When a bookie price moves significantly above the exchange lay, you get an instant Telegram notification with the edge percentage and prices."
            />
            <FAQItem
              question="Can I cancel anytime?"
              answer="Yes. Monthly billing, cancel anytime. No lock-in contracts, no hidden fees."
            />
          </div>
        </div>
      </section>

      {/* ===== BOTTOM CTA ===== */}
      <section className="py-16 md:py-24 border-t border-slate-800/50">
        <div className="max-w-2xl mx-auto px-4 text-center space-y-6">
          <h2 className="text-2xl md:text-3xl font-bold text-white">
            Stop leaving edges on the table
          </h2>
          <p className="text-slate-400">
            Start your 24-hour free trial. No card required.
          </p>
          <Link
            href="/dashboard?trial=start"
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-3.5 rounded-lg text-base transition-colors inline-flex items-center justify-center gap-2"
          >
            Start Free Trial <ChevronRight size={18} />
          </Link>
        </div>
      </section>
    </div>
  );
}

// --- Sub-components ---

function StepCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="text-center space-y-3">
      <div className="w-10 h-10 rounded-full bg-blue-600/20 border border-blue-500/30 text-blue-400 font-bold text-lg flex items-center justify-center mx-auto">
        {number}
      </div>
      <h3 className="text-white font-bold text-lg">{title}</h3>
      <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-[#161F32] border border-slate-800 rounded-xl p-6 space-y-3">
      <div className="text-blue-400">{icon}</div>
      <h3 className="text-white font-bold">{title}</h3>
      <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="border-b border-slate-800 pb-6">
      <h3 className="text-white font-bold mb-2">{question}</h3>
      <p className="text-slate-400 text-sm leading-relaxed">{answer}</p>
    </div>
  );
}
