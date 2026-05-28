'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

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

  useEffect(() => {
    const sid = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setSessionId(sid);
    fetch(`/api/health?sessionId=${encodeURIComponent(sid)}`).then(r => r.json()).then(setHealth);
  }, []);

  const saveProfile = async () => {
    const res = await fetch('/api/health', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, age, fitnessLevel, goal }),
    });
    const data = await res.json();
    if (data.ok) { setHealth(data.health); setSaved(true); }
  };

  const levelOptions: { value: FitnessLevel; label: string; desc: string }[] = [
    { value: 'beginner', label: '新手', desc: '刚开始运动，动作还需要指导' },
    { value: 'intermediate', label: '进阶', desc: '有一定基础，能独立完成常见动作' },
    { value: 'advanced', label: '大佬', desc: '经常训练，追求强度和技术细节' },
  ];

  const goalOptions: { value: Goal; label: string; icon: string }[] = [
    { value: 'lose_weight', label: '减脂', icon: '🔥' },
    { value: 'build_muscle', label: '增肌', icon: '💪' },
    { value: 'endurance', label: '耐力', icon: '🏃' },
    { value: 'general', label: '健康', icon: '❤️' },
  ];

  return (
    <div className="min-h-screen bg-[#0F1117] text-[#E8E9ED] p-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-5 pt-8">
        {/* Header */}
        <div className="text-center">
          <div className="text-4xl mb-3">🏋️</div>
          <h1 className="text-xl font-bold">AI 运动教练 — 健康档案</h1>
          <p className="text-sm text-[#8B8FA3] mt-1">设置你的身体数据，教练会更懂你</p>
        </div>

        {/* Session ID */}
        <Card className="border-[#1A1D27] bg-[#1A1D27]/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#8B8FA3]">会话 ID</span>
              <Badge variant="outline" className="border-[#22D3A7]/40 text-[#22D3A7] text-xs font-mono">
                {sessionId ? `${sessionId.slice(0, 12)}...` : '连接中...'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Quick Profile */}
        <Card className="border-[#1A1D27] bg-[#1A1D27]/50">
          <CardContent className="p-4 space-y-4">
            <h2 className="text-sm font-semibold">基础信息</h2>

            <div>
              <label className="text-xs text-[#8B8FA3]">年龄</label>
              <Input
                type="number" min={10} max={100} value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="mt-1 bg-[#0A0C12] border-[#1A1D27] text-[#E8E9ED]"
              />
            </div>

            <div>
              <label className="text-xs text-[#8B8FA3]">运动水平</label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {levelOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFitness(opt.value)}
                    className={`rounded-lg p-2 text-center text-xs transition-all ${
                      fitnessLevel === opt.value
                        ? 'bg-[#FF6B35] text-white'
                        : 'bg-[#0A0C12] text-[#8B8FA3] hover:text-[#E8E9ED]'
                    }`}
                  >
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-[10px] opacity-60 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-[#8B8FA3]">训练目标</label>
              <div className="grid grid-cols-4 gap-2 mt-1">
                {goalOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setGoal(opt.value)}
                    className={`rounded-lg p-2 text-center text-xs transition-all ${
                      goal === opt.value
                        ? 'bg-[#FF6B35] text-white'
                        : 'bg-[#0A0C12] text-[#8B8FA3] hover:text-[#E8E9ED]'
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

        {/* Apple Health Connect */}
        <Card className="border-[#1A1D27] bg-[#1A1D27]/50">
          <CardContent className="p-4 space-y-3">
            <h2 className="text-sm font-semibold">连接 Apple Health</h2>
            <p className="text-xs text-[#8B8FA3]">
              一键导入心率、睡眠数据。教练会根据身体状况调整训练强度。
            </p>

            <Button
              onClick={() => {
                const apiUrl = `${window.location.origin}/api/health?sessionId=${encodeURIComponent(sessionId)}`;
                window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent('上传心率')}&input=${encodeURIComponent(apiUrl)}`;
              }}
              className="w-full bg-white hover:bg-white/90 text-black text-sm py-6"
            >
              <span className="mr-2 text-lg"></span>
              连接 Apple Health
            </Button>

            <p className="text-[10px] text-[#8B8FA3]/50 text-center">
              首次使用需先安装快捷指令。仅读取心率数据，不上传个人信息。
            </p>

            {/* Live health data */}
            {health?.heartRate && (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#0A0C12] rounded-lg p-2 text-center">
                  <div className="text-[10px] text-[#8B8FA3]">心率</div>
                  <div className="text-lg font-bold text-[#FF6B35]">{health.heartRate} <span className="text-xs">BPM</span></div>
                </div>
                {health.sleepQuality && (
                  <div className="bg-[#0A0C12] rounded-lg p-2 text-center">
                    <div className="text-[10px] text-[#8B8FA3]">睡眠</div>
                    <div className="text-lg font-bold text-[#22D3A7]">
                      {health.sleepQuality === 'good' ? '良好' : health.sleepQuality === 'fair' ? '一般' : '不足'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status */}
        <div className="text-center text-[10px] text-[#8B8FA3]/50">
          数据仅存储在本会话中，关闭页面后自动清除
        </div>
      </div>
    </div>
  );
}
