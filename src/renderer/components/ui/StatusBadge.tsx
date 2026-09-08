import React from 'react';
import clsx from 'clsx';

interface StatusBadgeProps {
  status: 'connected' | 'streaming' | 'paused' | 'disconnected' | 'error' | 'idle' | 'pending';
  label?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  const configs = {
    connected: {
      dotClass: 'bg-emerald-600',
      bgClass: 'bg-emerald-50 border-emerald-100 text-emerald-800',
      text: 'Conectado',
    },
    streaming: {
      dotClass: 'bg-sky-600',
      bgClass: 'bg-sky-50 border-sky-100 text-sky-800',
      text: 'Transmitindo',
    },
    paused: {
      dotClass: 'bg-amber-600',
      bgClass: 'bg-amber-50 border-amber-100 text-amber-800',
      text: 'Pausado',
    },
    disconnected: {
      dotClass: 'bg-neutral-400',
      bgClass: 'bg-neutral-100 border-neutral-200/60 text-neutral-600',
      text: 'Desconectado',
    },
    error: {
      dotClass: 'bg-rose-600 animate-pulse',
      bgClass: 'bg-rose-50 border-rose-100 text-rose-800',
      text: 'Erro',
    },
    idle: {
      dotClass: 'bg-neutral-500',
      bgClass: 'bg-neutral-50 border-neutral-200 text-neutral-650',
      text: 'Ocioso',
    },
    pending: {
      dotClass: 'bg-indigo-600 animate-pulse',
      bgClass: 'bg-indigo-50 border-indigo-100 text-indigo-850',
      text: 'Pendente',
    },
  };

  const current = configs[status] || configs.disconnected;

  return (
    <div
      className={clsx(
        'inline-flex items-center px-3 py-1 rounded-full text-xs font-mono font-medium border space-x-1.5 transition-all duration-300',
        current.bgClass
      )}
    >
      <span className={clsx('h-1.5 w-1.5 rounded-full', current.dotClass)} />
      <span>{label || current.text}</span>
    </div>
  );
};

