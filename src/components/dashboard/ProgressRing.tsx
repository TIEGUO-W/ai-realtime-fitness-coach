'use client';

interface ProgressRingProps {
  value: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
}

export default function ProgressRing({
  value,
  max,
  size = 56,
  strokeWidth = 4,
  color = '#00E5FF',
  bgColor = 'rgba(30, 41, 59, 1)',
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const progress = Math.min(value / max, 1);
  const offset = circumference - progress * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            filter: `drop-shadow(0 0 4px ${color})`,
            transition: 'stroke-dashoffset 0.8s ease-out',
          }}
        />
      </svg>
      <span
        className="absolute font-mono text-sm font-bold"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}
