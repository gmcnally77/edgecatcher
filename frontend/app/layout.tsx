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
  title: "EdgeCatcher | Real-time Odds Comparison",
  description: "Real-time odds comparison tool. Compare Pinnacle, Ladbrokes, and PaddyPower prices against the true market price. Find positive edge bets across NBA, EPL, and MMA.",
  openGraph: {
    title: "EdgeCatcher | Real-time Odds Comparison",
    description: "Real-time odds comparison tool. Compare Pinnacle, Ladbrokes, and PaddyPower against the true market price. Find value bets instantly.",
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
