'use client';

import dynamic from 'next/dynamic';

// Dynamic import to avoid SSR issues with Spline and browser APIs
const Dashboard = dynamic(() => import('@/components/dashboard/Dashboard'), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-screen bg-[#0a0e17] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
        <span className="text-cyan-400/60 text-sm font-mono tracking-widest">LOADING</span>
      </div>
    </div>
  ),
});

export default function Home() {
  return <Dashboard />;
}
