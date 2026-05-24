import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'AI Fitness Dashboard | 赛博教练',
    template: '%s | AI Fitness Dashboard',
  },
  description:
    '赛博朋克风格 AI 健身仪表盘 — 3D 怪物教练 + 实时骨架检测 + LLM 智能分析 + TTS 语音指导',
  keywords: [
    'AI Coach',
    'Fitness Dashboard',
    'Cyberpunk',
    'Pose Detection',
    'MediaPipe',
    'Real-time Feedback',
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN" className="dark">
      <body className="antialiased bg-slate-950 text-white overflow-hidden">
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
