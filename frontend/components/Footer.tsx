import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-[#0B1120]">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <span className="text-sm font-bold text-slate-400">EdgeCatcher</span>
            <span className="text-xs text-slate-600">&copy; {new Date().getFullYear()}</span>
          </div>

          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Dashboard
            </Link>
            <a
              href="https://t.me/exchange_steamers_bot"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Telegram Bot
            </a>
          </div>
        </div>

        <p className="text-[10px] text-slate-700 text-center mt-6">
          EdgeCatcher provides price comparison data for informational purposes only. Gambling involves risk. 18+ only. Please gamble responsibly.
        </p>
      </div>
    </footer>
  );
}
