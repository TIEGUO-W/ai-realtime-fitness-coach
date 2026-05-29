'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

type FitnessLevel = 'beginner' | 'intermediate' | 'advanced';
type Goal = 'lose_weight' | 'build_muscle' | 'endurance' | 'general';

interface HealthState {
  profile?: { age: number; fitnessLevel: string; goal: string };
  heartRate?: number;
  sleepQuality?: string;
  sleepHours?: number;
  lastUpdated?: number;
}

export default function HealthPage() {
  const [sessionId, setSessionId] = useState('');
  const [health, setHealth] = useState<HealthState | null>(null);
  const [age, setAge] = useState(25);
  const [fitnessLevel, setFitness] = useState<FitnessLevel>('intermediate');
  const [goal, setGoal] = useState<Goal>('general');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shortcutTab, setShortcutTab] = useState<'auto' | 'manual'>('auto');

  useEffect(() => {
    // Use a stable sessionId stored in localStorage
    const existing = localStorage.getItem('health_session_id');
    const sid = existing || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (!existing) localStorage.setItem('health_session_id', sid);
    setSessionId(sid);
    fetch(`/api/health?sessionId=${encodeURIComponent(sid)}`).then(r => r.json()).then(setHealth);
  }, []);

  // Poll health data every 3s to show live updates
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

  const apiUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/health?sessionId=${encodeURIComponent(sessionId)}` : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(apiUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const levelOptions: { value: FitnessLevel; label: string; desc: string }[] = [
    { value: 'beginner', label: '新手', desc: '刚开始运动' },
    { value: 'intermediate', label: '进阶', desc: '有一定基础' },
    { value: 'advanced', label: '大佬', desc: '追求极限' },
  ];

  const goalOptions: { value: Goal; label: string; icon: string }[] = [
    { value: 'lose_weight', label: '减脂', icon: '🔥' },
    { value: 'build_muscle', label: '增肌', icon: '💪' },
    { value: 'endurance', label: '耐力', icon: '🏃' },
    { value: 'general', label: '健康', icon: '❤️' },
  ];

  return (
    <div className="min-h-screen bg-[#05080F] text-[#F0F1F5] p-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-4 pt-6">
        {/* Header */}
        <div className="text-center">
          <div className="text-4xl mb-2">🏋️</div>
          <h1 className="text-xl font-bold">AI 运动教练 — 健康档案</h1>
          <p className="text-xs text-[#6B7280] mt-1">设置健康数据，让教练更懂你</p>
        </div>

        {/* Back to coach */}
        <div className="text-center">
          <a href="/" className="text-xs text-[#00E5FF] hover:underline">
            ← 返回教练
          </a>
        </div>

        {/* Session ID */}
        <Card className="border-[rgba(0,229,255,0.08)] bg-[#0C1018]">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#6B7280] uppercase tracking-widest">Session ID</span>
              <Badge variant="outline" className="border-[#22D3A7]/40 text-[#22D3A7] text-xs font-mono">
                {sessionId ? `${sessionId.slice(0, 16)}...` : '连接中...'}
              </Badge>
            </div>
            {health?.lastUpdated && (
              <div className="text-[10px] text-[#6B7280] mt-1">
                最后更新: {new Date(health.lastUpdated).toLocaleTimeString()}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 1: Profile */}
        <Card className="border-[rgba(0,229,255,0.08)] bg-[#0C1018]">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-[#00E5FF] text-black">1</span>
              <h2 className="text-sm font-semibold">基础信息</h2>
            </div>

            <div>
              <label className="text-[10px] text-[#6B7280] uppercase tracking-widest">年龄</label>
              <Input
                type="number" min={10} max={100} value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="mt-1 bg-[#0A0C12] border-[rgba(0,229,255,0.1)] text-[#F0F1F5] font-mono"
              />
            </div>

            <div>
              <label className="text-[10px] text-[#6B7280] uppercase tracking-widest">运动水平</label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {levelOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFitness(opt.value)}
                    className={`rounded-lg p-2 text-center text-xs transition-all ${
                      fitnessLevel === opt.value
                        ? 'bg-[#FF6B35] text-white'
                        : 'bg-[#0A0C12] text-[#6B7280] hover:text-[#F0F1F5]'
                    }`}
                  >
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-[10px] opacity-60">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-[#6B7280] uppercase tracking-widest">训练目标</label>
              <div className="grid grid-cols-4 gap-2 mt-1">
                {goalOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setGoal(opt.value)}
                    className={`rounded-lg p-2 text-center text-xs transition-all ${
                      goal === opt.value
                        ? 'bg-[#FF6B35] text-white'
                        : 'bg-[#0A0C12] text-[#6B7280] hover:text-[#F0F1F5]'
                    }`}
                  >
                    <div className="text-lg">{opt.icon}</div>
                    <div className="font-medium">{opt.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={saveProfile}
              className="w-full bg-[#FF6B35] hover:bg-[#FF6B35]/80 text-white"
            >
              {saved ? '已保存 ✓' : '保存档案'}
            </Button>
          </CardContent>
        </Card>

        {/* Step 2: Apple Health */}
        <Card className="border-[rgba(0,229,255,0.08)] bg-[#0C1018]">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-[#00E5FF] text-black">2</span>
              <h2 className="text-sm font-semibold">连接 Apple Health</h2>
            </div>
            <p className="text-xs text-[#6B7280]">
              实时同步心率数据，教练会根据你的心率自动调整训练强度。
            </p>

            {/* API URL - copyable */}
            <div>
              <label className="text-[10px] text-[#6B7280] uppercase tracking-widest">服务器 URL（复制后填入快捷指令）</label>
              <div className="flex gap-2 mt-1">
                <Input
                  readOnly
                  value={apiUrl}
                  className="bg-[#0A0C12] border-[rgba(0,229,255,0.1)] text-[#00E5FF] text-xs font-mono"
                />
                <Button
                  onClick={handleCopy}
                  variant="outline"
                  className="border-[rgba(0,229,255,0.2)] text-[#00E5FF] hover:bg-[rgba(0,229,255,0.1)] shrink-0 text-xs px-3"
                >
                  {copied ? '✓' : '复制'}
                </Button>
              </div>
            </div>

            {/* Tab switch: Auto / Manual */}
            <div className="flex rounded-lg overflow-hidden border border-[rgba(0,229,255,0.1)]">
              <button
                onClick={() => setShortcutTab('auto')}
                className={`flex-1 py-2 text-xs font-medium transition-all ${
                  shortcutTab === 'auto'
                    ? 'bg-[#00E5FF] text-black'
                    : 'bg-[#0A0C12] text-[#6B7280] hover:text-[#F0F1F5]'
                }`}
              >
                自动化方案（推荐）
              </button>
              <button
                onClick={() => setShortcutTab('manual')}
                className={`flex-1 py-2 text-xs font-medium transition-all ${
                  shortcutTab === 'manual'
                    ? 'bg-[#00E5FF] text-black'
                    : 'bg-[#0A0C12] text-[#6B7280] hover:text-[#F0F1F5]'
                }`}
              >
                手动创建快捷指令
              </button>
            </div>

            {/* Auto method */}
            {shortcutTab === 'auto' && (
              <div className="space-y-3">
                {/* Quick test */}
                <Button
                  onClick={() => {
                    window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent('上传心率')}&input=${encodeURIComponent(apiUrl)}`;
                  }}
                  className="w-full bg-white hover:bg-white/90 text-black text-sm py-5"
                >
                  <span className="mr-2 text-lg"></span>
                  先测试一次
                </Button>

                {/* Automation setup guide */}
                <div className="bg-[#0A0C12] rounded-xl p-3 space-y-2 border border-[rgba(0,229,255,0.06)]">
                  <h3 className="text-xs font-bold text-[#FF6B35] uppercase tracking-widest">设置自动重复（解决只能触发一次的问题）</h3>
                  <ol className="text-xs text-[#6B7280] space-y-2 list-decimal list-inside leading-relaxed">
                    <li>
                      打开 iPhone <span className="text-[#F0F1F5] font-medium">「快捷指令」</span> App
                    </li>
                    <li>
                      底部切换到 <span className="text-[#F0F1F5] font-medium">「自动化」</span> 标签
                    </li>
                    <li>
                      点击右上角 <span className="text-[#F0F1F5] font-medium">「+」</span> → <span className="text-[#F0F1F5] font-medium">「创建个人自动化」</span>
                    </li>
                    <li>
                      向下滑找到 <span className="text-[#00E5FF] font-medium">「重复」</span>，设置每 <span className="text-[#FF6B35] font-bold">5 分钟</span>
                    </li>
                    <li>
                      点击「添加操作」→ 搜索 <span className="text-[#F0F1F5] font-medium">「上传心率」</span> → 选中你的快捷指令
                    </li>
                    <li>
                      将上方复制的 <span className="text-[#00E5FF]">URL</span> 粘贴到快捷指令的输入参数中
                    </li>
                    <li>
                      <span className="text-[#FF4757] font-medium">关闭「运行前询问」</span>（否则每次都会弹窗确认）
                    </li>
                    <li>
                      完成！现在心率会每 5 分钟自动同步
                    </li>
                  </ol>
                  <div className="bg-[#111827] rounded-lg p-2 mt-2">
                    <p className="text-[10px] text-[#6B7280]">
                      iOS 自动化最小间隔 5 分钟。如果你需要更高频率（如运动中实时监测），建议用手动方案创建循环快捷指令。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Manual method */}
            {shortcutTab === 'manual' && (
              <div className="space-y-3">
                <div className="bg-[#0A0C12] rounded-xl p-3 space-y-2 border border-[rgba(0,229,255,0.06)]">
                  <h3 className="text-xs font-bold text-[#22D3A7] uppercase tracking-widest">手动创建循环快捷指令（运动中实时心率）</h3>
                  <ol className="text-xs text-[#6B7280] space-y-2 list-decimal list-inside leading-relaxed">
                    <li>
                      打开 <span className="text-[#F0F1F5] font-medium">「快捷指令」</span> App → 点击 <span className="text-[#F0F1F5] font-medium">「+」</span> 新建
                    </li>
                    <li>
                      添加操作 → 搜索 <span className="text-[#F0F1F5] font-medium">「重复」</span> → 设置重复 <span className="text-[#FF6B35] font-bold">30</span> 次
                    </li>
                    <li>
                      在重复内部添加 → 搜索 <span className="text-[#F0F1F5] font-medium">「健康样本」</span> → 类型选 <span className="text-[#F0F1F5] font-medium">「心率」</span>、排序选 <span className="text-[#F0F1F5] font-medium">「最新」</span>、数量 1
                    </li>
                    <li>
                      添加 → 搜索 <span className="text-[#F0F1F5] font-medium">「字典」</span> → 创建字典，添加键 <code className="text-[#00E5FF] bg-[#111827] px-1 rounded">heartRate</code>，值为上一步的心率数值
                    </li>
                    <li>
                      添加 → 搜索 <span className="text-[#F0F1F5] font-medium">「获取 URL 内容」</span> → URL 填上方复制的链接，方法选 <span className="text-[#F0F1F5] font-medium">POST</span>，请求体选 <span className="text-[#F0F1F5] font-medium">「文件」</span> 传字典的 JSON
                    </li>
                    <li>
                      添加 → 搜索 <span className="text-[#F0F1F5] font-medium">「等待」</span> → 设置 <span className="text-[#FF6B35] font-bold">10 秒</span>
                    </li>
                    <li>
                      结束 → 给快捷指令起名 <span className="text-[#F0F1F5] font-medium">「持续心率」</span>
                    </li>
                  </ol>
                  <div className="bg-[#111827] rounded-lg p-2 mt-2 space-y-1">
                    <p className="text-[10px] text-[#6B7280]">
                      此方案每次运行会循环 30 次 x 10 秒 = 5 分钟持续发送心率。
                      训练前手动运行一次即可。
                    </p>
                    <p className="text-[10px] text-[#6B7280]">
                      如果训练超过 5 分钟，可以增大重复次数。
                    </p>
                  </div>
                </div>
              </div>
            )}

            <p className="text-[10px] text-[#6B7280]/50 text-center">
              仅读取心率，不上传个人信息。数据仅存于当前会话。
            </p>
          </CardContent>
        </Card>

        {/* Step 3: Live Heart Rate */}
        <Card className="border-[rgba(0,229,255,0.08)] bg-[#0C1018]">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${health?.heartRate ? 'bg-[#22D3A7] text-black' : 'bg-[#1A1D27] text-[#6B7280]'}`}>3</span>
              <h2 className="text-sm font-semibold">实时数据</h2>
              {health?.heartRate && (
                <Badge variant="outline" className="border-[#22D3A7]/40 text-[#22D3A7] text-[10px] ml-auto">
                  LIVE
                </Badge>
              )}
            </div>

            {health?.heartRate ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#0A0C12] rounded-xl p-3 text-center border border-[rgba(0,229,255,0.06)]">
                  <div className="text-[10px] text-[#6B7280] uppercase tracking-widest">心率</div>
                  <div className="text-2xl font-mono font-bold text-[#FF6B35] mt-1">
                    {health.heartRate} <span className="text-xs text-[#6B7280]">BPM</span>
                  </div>
                </div>
                {health.sleepQuality && (
                  <div className="bg-[#0A0C12] rounded-xl p-3 text-center border border-[rgba(0,229,255,0.06)]">
                    <div className="text-[10px] text-[#6B7280] uppercase tracking-widest">睡眠</div>
                    <div className="text-2xl font-bold text-[#22D3A7] mt-1">
                      {health.sleepQuality === 'good' ? '良好' : health.sleepQuality === 'fair' ? '一般' : '不足'}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-[#0A0C12] rounded-xl p-4 text-center border border-[rgba(0,229,255,0.06)]">
                <div className="text-[#6B7280] text-xs">等待心率数据...</div>
                <div className="text-[10px] text-[#6B7280]/50 mt-1">完成上方步骤后，心率会自动显示在这里</div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-[10px] text-[#6B7280]/30 pb-8">
          数据仅存储在本会话中，关闭页面后自动清除
        </div>
      </div>
    </div>
  );
}
