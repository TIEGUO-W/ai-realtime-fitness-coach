import type { Metadata } from 'next';
import Dashboard from '@/components/dashboard/Dashboard';

export const metadata: Metadata = {
  title: 'AI 运动教练 | 实时姿态分析',
  description: '基于云端推理的实时运动教练 — 边缘骨架检测 + LLM 智能分析 + TTS 语音指导',
};

export default function Home() {
  return <Dashboard />;
}
