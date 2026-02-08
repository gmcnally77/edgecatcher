'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TrendingUp } from 'lucide-react';

export default function Header() {
  const pathname = usePathname();
  const isLanding = pathname === '/';

  return (
    <header className="sticky top-0 z-50 bg-[#0B1120]/95 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-2 rounded-lg border border-blue-400/20">
            <TrendingUp className="text-white" size={18} strokeWidth={3} />
          </div>
          <span className="text-lg font-bold text-white tracking-tight">EdgeCatcher</span>
        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-6">
          {isLanding && (
            <>
              <a href="#how-it-works" className="hidden md:block text-sm text-slate-400 hover:text-white transition-colors">
                How It Works
              </a>
              <a href="#pricing" className="hidden md:block text-sm text-slate-400 hover:text-white transition-colors">
                Pricing
              </a>
            </>
          )}
          {isLanding ? (
            <Link
              href="/dashboard?trial=start"
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors"
            >
              Start Free Trial
            </Link>
          ) : (
            <Link
              href="/"
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              Home
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
