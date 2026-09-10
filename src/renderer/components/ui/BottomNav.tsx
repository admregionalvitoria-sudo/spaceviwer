// SpaceViewer v2.2.9
import React from 'react';
import clsx from 'clsx';
import logoUrl from '../../assets/logo.png';
import type { SidebarTab } from './Sidebar';
import { APP_VERSION } from '../../../shared/constants';

export { SidebarTab };

interface BottomNavProps {
  activeTab: SidebarTab;
  onChangeTab: (tab: SidebarTab) => void;
  serverStatus: 'running' | 'stopped';
  streamStatus?: 'idle' | 'starting' | 'streaming' | 'paused' | 'error';
  activeAgentsCount: number;
  moonlightClientsCount?: number;
  screensCount?: number;
  onStopStream?: () => void;
  onStartStream?: () => void;
  onResetMode?: () => void;
  canResetMode?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onChangeTab,
  serverStatus,
  streamStatus = 'idle',
  activeAgentsCount,
  moonlightClientsCount = 0,
  screensCount,
  onStopStream,
  onResetMode,
  canResetMode = false,
}) => {
  const menuItems: { id: SidebarTab; label: string; badge?: number; icon: React.ReactNode }[] = [
    {
      id: 'screens',
      label: 'Telas',
      badge: screensCount,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      ),
    },
    {
      id: 'dashboard',
      label: 'Painel',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z"
          />
        </svg>
      ),
    },
    {
      id: 'agents',
      label: 'Agentes',
      badge: activeAgentsCount,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      ),
    },
    {
      id: 'moonlight',
      label: 'Moonlight',
      badge: moonlightClientsCount,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      ),
    },
    {
      id: 'network',
      label: 'Rede',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Ajustes',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      ),
    },
  ];

  const isStreaming = streamStatus === 'streaming';

  return (
    <div className="w-full px-4 pb-3 pt-1 pointer-events-none select-none z-50">
      <div className="max-w-5xl mx-auto pointer-events-auto bg-white/95 backdrop-blur-xl border border-neutral-300/80 shadow-xl rounded-2xl px-4 py-2 flex items-center justify-between gap-2">
        {/* Left Section: Branding & Server Status */}
        <div className="flex items-center space-x-3 min-w-[170px]">
          <img src={logoUrl} alt="Logo" className="w-8 h-8 object-contain drop-shadow-sm select-none" />
          <div className="flex flex-col">
            <span className="font-display font-black text-xs tracking-tight text-neutral-900 uppercase leading-tight">
              SpaceViewer
            </span>
            <div className="flex items-center space-x-1.5 mt-0.5">
              <span
                className={clsx(
                  'h-2 w-2 rounded-full',
                  isStreaming
                    ? 'bg-rose-600 animate-pulse'
                    : serverStatus === 'running'
                    ? 'bg-emerald-600'
                    : 'bg-neutral-400'
                )}
              />
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-600">
                {isStreaming
                  ? 'Transmitindo'
                  : serverStatus === 'running'
                  ? 'Online'
                  : 'Parado'}
              </span>
            </div>
          </div>
        </div>

        {/* Center Section: Navigation Tabs (Dock Style with icon on top, label below) */}
        <nav className="flex items-center justify-center space-x-1 sm:space-x-2 flex-1">
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onChangeTab(item.id)}
                className={clsx(
                  'flex flex-col items-center justify-center min-w-[62px] sm:min-w-[76px] py-1 px-2.5 rounded-xl transition-all duration-200 cursor-pointer group relative',
                  isActive
                    ? 'bg-neutral-900 text-white shadow-md scale-[1.03]'
                    : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100/90 hover:scale-[1.02]'
                )}
              >
                <div className="relative flex items-center justify-center">
                  <span
                    className={clsx(
                      'transition-transform duration-200 group-hover:scale-110',
                      isActive ? 'text-white' : 'text-neutral-600 group-hover:text-neutral-900'
                    )}
                  >
                    {item.icon}
                  </span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute -top-1 -right-3 bg-neutral-900 text-white font-mono text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white shadow-xs">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span
                  className={clsx(
                    'text-[10px] font-bold tracking-wider mt-0.5 uppercase transition-colors',
                    isActive ? 'text-white' : 'text-neutral-500 group-hover:text-neutral-800'
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Right Section: Action Controls (Inspired by the red Leave button in reference screenshot) */}
        <div className="flex items-center space-x-2 min-w-[170px] justify-end">
          {isStreaming ? (
            <button
              onClick={onStopStream}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold text-xs shadow-md hover:shadow-lg transition-all duration-200 transform hover:scale-[1.02] cursor-pointer"
              title="Parar transmissão de tela imediatamente"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              <span className="tracking-wide uppercase font-sans">Parar</span>
            </button>
          ) : canResetMode ? (
            <button
              onClick={onResetMode}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 active:bg-neutral-300 text-neutral-800 border border-neutral-300/80 font-bold text-xs shadow-xs hover:shadow-sm transition-all duration-200 cursor-pointer"
              title="Voltar para a tela de escolha de modo"
            >
              <svg className="w-3.5 h-3.5 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="font-mono uppercase tracking-wider text-[10px]">Inicializador</span>
            </button>
          ) : (
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-mono text-neutral-400 font-bold tracking-wider">SPACEVIEWER</span>
              <span className="text-[9px] font-mono text-neutral-500">v{APP_VERSION}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default BottomNav;
