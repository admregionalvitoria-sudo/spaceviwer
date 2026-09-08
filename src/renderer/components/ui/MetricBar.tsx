import React from 'react';
import clsx from 'clsx';

interface MetricBarProps {
  label: string;
  value: number; // 0 to 100
  suffix?: string;
  color?: 'cyan' | 'purple' | 'green' | 'red' | 'warn';
  className?: string;
}

export const MetricBar: React.FC<MetricBarProps> = ({
  label,
  value,
  suffix = '%',
  color = 'cyan',
  className,
}) => {
  const normalized = Math.max(0, Math.min(100, value));

  const barColors = {
    cyan: 'bg-neutral-900',
    purple: 'bg-neutral-800',
    green: 'bg-neutral-900',
    red: 'bg-neutral-400',
    warn: 'bg-neutral-500',
  };

  return (
    <div className={clsx('flex flex-col space-y-1.5', className)}>
      <div className="flex justify-between items-center text-xs font-mono">
        <span className="text-neutral-500 uppercase tracking-wider">{label}</span>
        <span className="text-neutral-900 font-bold">
          {normalized.toFixed(0)}
          {suffix}
        </span>
      </div>
      {/* Track */}
      <div className="h-2 w-full bg-neutral-200 border border-neutral-350/20 rounded-full overflow-hidden relative">
        {/* Fill */}
        <div
          className={clsx('h-full rounded-full transition-all duration-500 ease-out', barColors[color])}
          style={{ width: `${normalized}%` }}
        />
      </div>
    </div>
  );
};

