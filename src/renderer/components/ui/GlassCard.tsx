import React from 'react';
import clsx from 'clsx';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: 'cyan' | 'purple' | 'green' | 'none';
  onClick?: () => void;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className,
  glowColor = 'none',
  onClick,
}) => {
  const glowClasses = {
    cyan: 'shadow-cyan-glow hover:border-black/25',
    purple: 'shadow-purple-glow hover:border-black/25',
    green: 'shadow-green-glow hover:border-black/25',
    none: 'hover:border-black/20',
  };

  return (
    <div
      onClick={onClick}
      className={clsx(
        'glass-panel glass-panel-hover rounded-2xl p-6 relative overflow-hidden',
        onClick && 'cursor-pointer select-none active:scale-[0.98]',
        glowColor !== 'none' ? glowClasses[glowColor] : '',
        className
      )}
    >
      {/* Decorative inner light gradient */}
      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-black/[0.003] to-black/[0.01] pointer-events-none" />
      {children}
    </div>
  );
};
