// SpaceViewer v2.2.9
import React from 'react';
import clsx from 'clsx';
import logoUrl from '../../assets/logo.png';

export type SidebarTab = 'screens' | 'dashboard' | 'agents' | 'moonlight' | 'network' | 'settings';

interface SidebarProps {
  activeTab: SidebarTab;
  onChangeTab: (tab: SidebarTab) => void;
  serverStatus: 'running' | 'stopped';
  activeAgentsCount: number;
  moonlightClientsCount?: number;
  screensCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onChangeTab,
  serverStatus,
  activeAgentsCount,
  moonlightClientsCount = 0,
  screensCount,
}) => {
  const menuItems: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'screens',
      label: 'Telas',
      icon: (
        <div className="relative">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          {screensCount !== undefined && screensCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-neutral-900 text-white font-mono text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white">
              {screensCount}
            </span>
          )}
        </div>
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
      icon: (
        <div className="relative">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          {activeAgentsCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-neutral-900 text-white font-mono text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white">
              {activeAgentsCount}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'moonlight',
      label: 'Moonlight',
      icon: (
        <div className="relative">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
            />
          </svg>
          {moonlightClientsCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-neutral-900 text-white font-mono text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white">
              {moonlightClientsCount}
            </span>
          )}
        </div>
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

  return (
    <div className="w-64 h-full bg-neutral-300 border-r border-neutral-400/50 flex flex-col justify-between p-4 select-none shadow-sm">
      {/* Upper Navigation */}
      <div className="space-y-6">
        {/* Brand / Logo Header */}
        <div className="flex items-center space-x-3 px-3 py-2 border-b border-neutral-400/30 pb-4">
          <img src={logoUrl} alt="Logo" className="w-8 h-8 object-contain" />
          <span className="font-display font-black text-lg tracking-tight text-neutral-900 uppercase">SpaceViewer</span>
        </div>

        {/* Main Header / Status */}
        <div className="px-3 py-2 flex items-center justify-between border-b border-neutral-400/30 pb-4">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-neutral-600 font-mono font-bold">Status do Servidor</span>
            <span className="text-sm font-bold text-neutral-900 flex items-center space-x-1.5 mt-0.5">
              <span
                className={clsx(
                  'h-2 w-2 rounded-full',
                  serverStatus === 'running' ? 'bg-neutral-900' : 'bg-neutral-500'
                )}
              />
              <span>{serverStatus === 'running' ? 'Ativo' : 'Inativo'}</span>
            </span>
          </div>
        </div>

        {/* Menu Tabs */}
        <nav className="space-y-1.5">
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onChangeTab(item.id)}
                className={clsx(
                  'w-full flex items-center px-4 py-3 rounded-xl font-sans text-sm font-medium tracking-wide transition-all duration-300 group relative',
                  isActive
                    ? 'bg-neutral-950 text-white border-l-2 border-neutral-950 font-semibold shadow-md scale-[1.02]'
                    : 'text-neutral-700 hover:text-neutral-950 hover:bg-white/80 hover:translate-x-2 hover:scale-[1.02] hover:shadow-sm'
                )}
              >
                <span className={clsx('mr-3.5 transition-transform duration-200 group-hover:scale-110', isActive ? 'text-white' : 'text-neutral-500 group-hover:text-neutral-700')}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="border-t border-neutral-400/30 pt-4 px-3 flex flex-col space-y-1">
        <span className="text-[10px] text-neutral-605 font-mono font-bold">SPACEVIEWER v2.0.0</span>
        <span className="text-[10px] text-neutral-605 font-mono">CONEXÃO: LAN & MOONLIGHT</span>
      </div>
    </div>
  );
};

