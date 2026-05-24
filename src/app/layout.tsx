import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'AI 运动教练 | 实时姿态分析',
    template: '%s | AI 运动教练',
  },
  description:
    '基于云端推理的实时运动教练 — 边缘骨架检测 + LLM 智能分析 + TTS 语音指导',
  keywords: [
    'AI 教练',
    '运动分析',
    '姿态检测',
    '实时反馈',
    'MediaPipe',
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
      <body className="antialiased">
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
