'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type FitnessLevel = 'beginner' | 'intermediate' | 'advanced';
type Goal = 'lose_weight' | 'build_muscle' | 'endurance' | 'general';

interface HealthState {
  profile?: { age: number; fitnessLevel: string; goal: string };
  heartRate?: number;
  lastUpdated?: number;
}

const LEVEL_MAP: Record<FitnessLevel, string> = {
  beginner: '新手',
  intermediate: '进阶',
  advanced: '大佬',
};

const GOAL_MAP: Record<Goal, string> = {
  lose_weight: '减脂',
  build_muscle: '增肌',
  endurance: '耐力',
  general: '健康',
};

export default function HealthPage() {
  const [sessionId, setSessionId] = useState('');
  const [health, setHealth] = useState<HealthState | null>(null);
  const [age, setAge] = useState(25);
  const [fitnessLevel, setFitness] = useState<FitnessLevel>('intermediate');
  const [goal, setGoal] = useState<Goal>('general');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<'url' | 'link' | null>(null);

  useEffect(() => {
    const existing = localStorage.getItem('health_session_id');
    const sid = existing || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (!existing) localStorage.setItem('health_session_id', sid);
    setSessionId(sid);
    fetch(`/api/health?sessionId=${encodeURIComponent(sid)}`).then(r => r.json()).then(d => {
      if (d.health) {
        setHealth(d.health);
        if (d.health.profile) {
          setAge(d.health.profile.age);
          setFitness(d.health.profile.fitnessLevel as FitnessLevel || 'intermediate');
          setGoal(d.health.profile.goal as Goal || 'general');
          setSaved(true);
        }
      }
    });
  }, []);

  // Poll health data every 3s
  useEffect(() => {
    if (!sessionId) return;
    const iv = setInterval(() => {
      fetch(`/api/health?sessionId=${encodeURIComponent(sessionId)}`).then(r => r.json()).then(d => {
        if (d.health) setHealth(d.health);
      });
    }, 3000);
    return () => clearInterval(iv);
  }, [sessionId]);

  const saveProfile = async () => {
    const res = await fetch('/api/health', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, age, fitnessLevel, goal }),
    });
    const data = await res.json();
    if (data.ok) { setHealth(data.health); setSaved(true); }
  };

  const handleDisconnect = async () => {
    const newSid = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem('health_session_id', newSid);
    setSessionId(newSid);
    setHealth(null);
    setSaved(false);
    setAge(25);
    setFitness('intermediate');
    setGoal('general');
  };

  const apiUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/health?sessionId=${encodeURIComponent(sessionId)}` : '';
  const coachLink = typeof window !== 'undefined' ? `${window.location.origin}/?session=${encodeURIComponent(sessionId)}` : '';

  const handleCopy = (text: string, key: 'url' | 'link') => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const hasHeartRate = !!health?.heartRate;
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(iv);
  }, []);
  const hrStale = !health?.lastUpdated || (now > 0 && (now - health.lastUpdated) > 30000);

  return (
    <div className="min-h-screen bg-[#05080F] text-[#F0F1F5] p-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-4 pt-6 pb-10">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-lg font-bold tracking-tight">AI 运动教练</h1>
          <p className="text-xs text-[#6B7280] mt-1">连接 Apple Health，教练实时监测你的心率</p>
        </div>

        {/* Connection Status Card */}
        <Card className="border-[rgba(0,229,255,0.08)] bg-[#0C1018]">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  {hasHeartRate && !hrStale ? (
                    <>
                      <span className="absolute inline-flex h-full w-full rounded-full bg-[#22D3A7] opacity-60 animate-ping" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#22D3A7]" />
                    </>
                  ) : (
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#6B7280]" />
                  )}
                </span>
                <span className="text-sm font-medium">
                  {hasHeartRate && !hrStale ? 'Apple Health 已连接' : '未连接'}
                </span>
              </div>
              {hasHeartRate && (
                <div className="text-right">
                  <div className="text-2xl font-mono font-bold text-[#FF6B35] leading-none">
                    {health!.heartRate}
                  </div>
                  <div className="text-[9px] text-[#6B7280] font-mono mt-0.5">BPM</div>
                </div>
              )}
            </div>
            {hasHeartRate && health?.lastUpdated && (
              <div className="text-[10px] text-[#6B7280] mt-2">
                上次更新: {new Date(health.lastUpdated).toLocaleTimeString()}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profile Card */}
        <Card className="border-[rgba(0,229,255,0.08)] bg-[#0C1018]">
          <CardContent className="p-4 space-y-4">
            <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-widest">你的档案</h2>

            {/* Age slider */}
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="text-xs text-[#6B7280]">年龄</label>
                <span className="text-lg font-mono font-bold text-[#00E5FF]">{age}</span>
              </div>
              <input
                type="range" min={10} max={80} value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="w-full h-2 bg-[#1A1D27] rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#00E5FF]
                  [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(0,229,255,0.5)]
                  [&::-webkit-slider-thumb]:active:scale-110"
                style={{ touchAction: 'manipulation', WebkitAppearance: 'none' }}
              />
              <div className="flex justify-between text-[9px] text-[#6B7280]/50 mt-0.5">
                <span>10</span><span>80</span>
              </div>
            </div>

            {/* Fitness level */}
            <div>
              <label className="text-xs text-[#6B7280] mb-1.5 block">运动水平</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'beginner' as FitnessLevel, label: '新手' },
                  { value: 'intermediate' as FitnessLevel, label: '进阶' },
                  { value: 'advanced' as FitnessLevel, label: '大佬' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFitness(opt.value)}
                    className={`rounded-lg py-2 text-center text-xs font-medium transition-all ${
                      fitnessLevel === opt.value
                        ? 'bg-[#00E5FF] text-black'
                        : 'bg-[#0A0C12] text-[#6B7280] hover:text-[#F0F1F5] border border-[rgba(0,229,255,0.06)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Goal */}
            <div>
              <label className="text-xs text-[#6B7280] mb-1.5 block">训练目标</label>
              <div className="grid grid-cols-4 gap-2">
                {([
                  { value: 'lose_weight' as Goal, label: '减脂' },
                  { value: 'build_muscle' as Goal, label: '增肌' },
                  { value: 'endurance' as Goal, label: '耐力' },
                  { value: 'general' as Goal, label: '健康' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setGoal(opt.value)}
                    className={`rounded-lg py-2 text-center text-xs font-medium transition-all ${
                      goal === opt.value
                        ? 'bg-[#FF6B35] text-white'
                        : 'bg-[#0A0C12] text-[#6B7280] hover:text-[#F0F1F5] border border-[rgba(0,229,255,0.06)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={saveProfile}
              className="w-full bg-[#00E5FF] hover:bg-[#00E5FF]/80 text-black font-medium text-sm"
            >
              {saved ? '档案已更新 ✓' : '保存档案'}
            </Button>
          </CardContent>
        </Card>

        {/* Shortcut Setup */}
        <Card className="border-[rgba(0,229,255,0.08)] bg-[#0C1018]">
          <CardContent className="p-4 space-y-3">
            <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-widest">快捷指令设置</h2>

            {/* URL copy */}
            <div>
              <label className="text-[10px] text-[#6B7280] uppercase tracking-widest mb-1 block">服务器 URL</label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={apiUrl}
                  className="bg-[#0A0C12] border-[rgba(0,229,255,0.1)] text-[#00E5FF] text-xs font-mono truncate"
                />
                <Button
                  onClick={() => handleCopy(apiUrl, 'url')}
                  variant="outline"
                  className="border-[rgba(0,229,255,0.2)] text-[#00E5FF] hover:bg-[rgba(0,229,255,0.1)] shrink-0 text-xs px-3"
                >
                  {copied === 'url' ? '✓' : '复制'}
                </Button>
              </div>
            </div>

            {/* Install shortcut */}
            <a
              href="https://www.icloud.com/shortcuts/8606292958e84dd599dc044c7ba22335"
              target="_blank"
              className="block w-full"
            >
              <Button className="w-full bg-white hover:bg-white/90 text-black text-sm py-5 font-medium">
                安装快捷指令（已含循环，每2秒自动发心率）
              </Button>
            </a>

            {/* Simple instructions */}
            <div className="bg-[#0A0C12] rounded-xl p-3 border border-[rgba(0,229,255,0.06)]">
              <h3 className="text-xs font-bold text-[#00E5FF] mb-2">使用步骤</h3>
              <ol className="text-xs text-[#6B7280] space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>点击上方按钮安装快捷指令</li>
                <li>打开快捷指令，将复制的 URL 粘贴到 URL 输入框</li>
                <li>运行快捷指令，心率会每 2 秒自动上传</li>
                <li>在电脑上打开下方教练链接，心率实时同步</li>
              </ol>
            </div>
          </CardContent>
        </Card>

        {/* Coach Link - share to computer */}
        {saved && (
          <Card className="border-[rgba(0,229,255,0.15)] bg-[#0C1018]">
            <CardContent className="p-4 space-y-3">
              <h2 className="text-sm font-semibold text-[#00E5FF] uppercase tracking-widest">教练页面链接</h2>
              <p className="text-xs text-[#6B7280]">在电脑浏览器打开此链接，心率数据会自动同步到教练面板</p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={coachLink}
                  className="bg-[#0A0C12] border-[rgba(0,229,255,0.1)] text-[#00E5FF] text-xs font-mono truncate"
                />
                <Button
                  onClick={() => handleCopy(coachLink, 'link')}
                  variant="outline"
                  className="border-[rgba(0,229,255,0.2)] text-[#00E5FF] hover:bg-[rgba(0,229,255,0.1)] shrink-0 text-xs px-3"
                >
                  {copied === 'link' ? '✓' : '复制'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Disconnect / Reset */}
        <Card className="border-[rgba(255,71,87,0.08)] bg-[#0C1018]">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">切换用户</h2>
                <p className="text-[10px] text-[#6B7280] mt-0.5">断开当前连接，让其他人扫码体验</p>
              </div>
              <Button
                onClick={handleDisconnect}
                variant="outline"
                className="border-[#FF4757]/30 text-[#FF4757] hover:bg-[#FF4757]/10 text-xs"
              >
                断开连接
              </Button>
            </div>
            {saved && (
              <div className="bg-[#0A0C12] rounded-lg p-2 text-[10px] text-[#6B7280]">
                当前档案: {age}岁 / {LEVEL_MAP[fitnessLevel]} / {GOAL_MAP[goal]}
                {hasHeartRate && ` / 心率 ${health!.heartRate}BPM`}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Back to coach */}
        <div className="text-center pb-8">
          <Link href="/" className="text-sm text-[#00E5FF] hover:underline font-medium">
            ← 返回教练
          </Link>
        </div>
      </div>
    </div>
  );
}
