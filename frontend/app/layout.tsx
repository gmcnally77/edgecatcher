import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EdgeCatcher | Bookie vs Exchange Odds Comparison",
  description: "Real-time odds comparison tool. Compare Pinnacle, Ladbrokes, and PaddyPower prices against Betfair Exchange. Find positive edge bets across NBA, EPL, and MMA.",
  openGraph: {
    title: "EdgeCatcher | Bookie vs Exchange Odds Comparison",
    description: "Real-time odds comparison tool. Compare Pinnacle, Ladbrokes, and PaddyPower against Betfair Exchange. Find value bets instantly.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0B1120]`}
      >
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
