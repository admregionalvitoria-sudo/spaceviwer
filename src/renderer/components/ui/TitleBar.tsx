// SpaceViewer v2.2.9
import React from 'react';

interface TitleBarProps {
  title?: string;
  subtitle?: string;
}

export const TitleBar: React.FC<TitleBarProps> = ({ title = 'SpaceViewer', subtitle }) => {
  const handleMinimize = () => {
    window.screenflow.minimizeWindow();
  };

  const handleMaximize = () => {
    window.screenflow.maximizeWindow();
  };

  const handleClose = () => {
    window.screenflow.closeWindow();
  };

  return (
    <div className="h-10 w-full flex items-center justify-between bg-white border-b border-neutral-200/60 select-none titlebar-drag z-50">
      {/* Title & Brand */}
      <div className="flex items-center px-4 space-x-2">
        {/* Brand Dot */}
        <div className="h-2 w-2 rounded-full bg-neutral-900" />
        <span className="font-display font-bold text-sm tracking-wide text-neutral-900">{title}</span>
        {subtitle && (
          <>
            <span className="text-neutral-300">|</span>
            <span className="font-mono text-xs text-neutral-500">{subtitle}</span>
          </>
        )}
      </div>

      {/* Window Controls */}
      <div className="flex items-center h-full titlebar-nodrag">
        {/* Minimize */}
        <button
          onClick={handleMinimize}
          className="px-4 h-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 transition duration-150"
          title="Minimizar"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 13H5" />
          </svg>
        </button>

        {/* Maximize */}
        <button
          onClick={handleMaximize}
          className="px-4 h-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 transition duration-150"
          title="Maximizar"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="5" y="5" width="14" height="14" rx="2" strokeWidth="2.5" />
          </svg>
        </button>

        {/* Close */}
        <button
          onClick={handleClose}
          className="px-4 h-full flex items-center justify-center text-neutral-500 hover:bg-rose-50 hover:text-rose-650 transition duration-150"
          title="Fechar"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

