import { create } from 'zustand';
import type { MasterInfo, AgentMetrics, AppSettings, ScreenSource } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/constants';

interface AgentState {
  connectionStatus: 'disconnected' | 'connecting' | 'awaiting_authorization' | 'connected' | 'error';
  discoveredMasters: MasterInfo[];
  connectedMaster: MasterInfo | null;
  settings: AppSettings;
  volume: number;
  fullscreen: boolean;
  incomingStream: MediaStream | null;
  streamStats: AgentMetrics | null;
  connectionHistory: MasterInfo[];
  masterScreens: ScreenSource[];
  requestedScreenId: string | null;

  // Actions
  loadSettings: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;
  setConnectionStatus: (status: 'disconnected' | 'connecting' | 'awaiting_authorization' | 'connected' | 'error') => void;
  addDiscoveredMaster: (master: MasterInfo) => void;
  setConnectedMaster: (master: MasterInfo | null) => void;
  setIncomingStream: (stream: MediaStream | null) => void;
  setStreamStats: (stats: AgentMetrics | null) => void;
  setVolume: (volume: number) => void;
  setFullscreen: (fullscreen: boolean) => void;
  loadHistory: () => void;
  addToHistory: (master: MasterInfo) => void;
  clearDiscovered: () => void;
  setMasterScreens: (screens: ScreenSource[]) => void;
  setRequestedScreenId: (id: string | null) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  connectionStatus: 'disconnected',
  discoveredMasters: [],
  connectedMaster: null,
  settings: DEFAULT_SETTINGS,
  volume: 100,
  fullscreen: false,
  incomingStream: null,
  streamStats: null,
  connectionHistory: [],
  masterScreens: [],
  requestedScreenId: null,

  loadSettings: async () => {
    try {
      const settings = await window.screenflow.getSettings();
      set({ settings, volume: settings.audio.defaultVolume });
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  },

  updateSettings: async (settings) => {
    try {
      await window.screenflow.saveSettings(settings);
      set({ settings });
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  },

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

  addDiscoveredMaster: (master) =>
    set((state) => {
      // If master went offline, remove it
      if (master.offline) {
        return {
          discoveredMasters: state.discoveredMasters.filter((m) => m.name !== master.name),
        };
      }
      // Otherwise, avoid duplicates
      const exists = state.discoveredMasters.some((m) => m.name === master.name);
      if (exists) {
        return {
          discoveredMasters: state.discoveredMasters.map((m) => (m.name === master.name ? { ...m, ...master } : m)),
        };
      }
      return { discoveredMasters: [...state.discoveredMasters, master] };
    }),

  setConnectedMaster: (connectedMaster) => set({ connectedMaster }),

  setIncomingStream: (incomingStream) => set({ incomingStream }),

  setStreamStats: (streamStats) => set({ streamStats }),

  setVolume: (volume) => set({ volume }),

  setFullscreen: (fullscreen) => set({ fullscreen }),

  loadHistory: () => {
    try {
      const stored = localStorage.getItem('screenflow-agent-history');
      if (stored) {
        set({ connectionHistory: JSON.parse(stored) });
      }
    } catch (err) {
      console.error('Failed to load connection history:', err);
    }
  },

  addToHistory: (master) => {
    set((state) => {
      const filtered = state.connectionHistory.filter((m) => m.host !== master.host || m.port !== master.port);
      const updated = [master, ...filtered].slice(0, 10); // keep last 10
      try {
        localStorage.setItem('screenflow-agent-history', JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to save connection history:', err);
      }
      return { connectionHistory: updated };
    });
  },

  clearDiscovered: () => set({ discoveredMasters: [] }),
  setMasterScreens: (masterScreens) => set({ masterScreens }),
  setRequestedScreenId: (requestedScreenId) => set({ requestedScreenId }),
}));
