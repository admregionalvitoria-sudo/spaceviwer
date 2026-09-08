import { create } from 'zustand';
import type { AppSettings, StreamStatus, Agent, ScreenSource, StreamConfig, StreamStats } from '../../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_STREAM_CONFIG } from '../../shared/constants';

interface MasterState {
  serverStatus: 'stopped' | 'running';
  streamStatus: StreamStatus;
  settings: AppSettings;
  screens: ScreenSource[];
  connectedAgents: Agent[];
  selectedScreen: ScreenSource | null;
  streamConfig: StreamConfig;
  streamStats: StreamStats | null;
  selectedAgentId: string | null;
  agentScreens: Record<string, string>;
  pendingRequests: Record<string, string>;

  // Actions
  loadSettings: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;
  loadScreens: () => Promise<void>;
  setServerStatus: (status: 'stopped' | 'running') => void;
  setStreamStatus: (status: StreamStatus) => void;
  setStreamConfig: (config: Partial<StreamConfig>) => void;
  setStreamStats: (stats: StreamStats | null) => void;
  setConnectedAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  selectScreen: (screen: ScreenSource | null) => void;
  setSelectedAgentId: (id: string | null) => void;
  setAgentScreen: (agentId: string, screenId: string) => void;
  refreshAgents: () => Promise<void>;
  addPendingRequest: (agentId: string, screenId: string) => void;
  removePendingRequest: (agentId: string) => void;
}

export const useMasterStore = create<MasterState>((set, get) => ({
  serverStatus: 'stopped',
  streamStatus: 'idle',
  settings: DEFAULT_SETTINGS,
  screens: [],
  connectedAgents: [],
  selectedScreen: null,
  streamConfig: DEFAULT_STREAM_CONFIG,
  streamStats: null,
  selectedAgentId: null,
  agentScreens: {},
  pendingRequests: {},

  loadSettings: async () => {
    try {
      const settings = await window.screenflow.getSettings();
      set({ settings });
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

  loadScreens: async () => {
    try {
      const screens = await window.screenflow.getScreens();
      set({ screens });
      if (screens.length > 0 && !get().selectedScreen) {
        set({ selectedScreen: screens[0] });
      }
    } catch (err) {
      console.error('Failed to load screens:', err);
    }
  },

  setServerStatus: (serverStatus) => set({ serverStatus }),

  setStreamStatus: (streamStatus) => set({ streamStatus }),

  setStreamConfig: (config) =>
    set((state) => ({
      streamConfig: { ...state.streamConfig, ...config },
    })),

  setStreamStats: (streamStats) => set({ streamStats }),

  setConnectedAgents: (connectedAgents) => set({ connectedAgents }),

  addAgent: (agent) =>
    set((state) => {
      // Avoid duplicate agents
      const exists = state.connectedAgents.some((a) => a.id === agent.id);
      if (exists) {
        return {
          connectedAgents: state.connectedAgents.map((a) => (a.id === agent.id ? { ...a, ...agent } : a)),
        };
      }
      return { connectedAgents: [...state.connectedAgents, agent] };
    }),

  removeAgent: (id) =>
    set((state) => {
      const nextAgentScreens = { ...state.agentScreens };
      delete nextAgentScreens[id];
      const nextSelectedAgentId = state.selectedAgentId === id ? null : state.selectedAgentId;
      return {
        connectedAgents: state.connectedAgents.filter((a) => a.id !== id),
        agentScreens: nextAgentScreens,
        selectedAgentId: nextSelectedAgentId,
      };
    }),

  updateAgent: (id, updates) =>
    set((state) => ({
      connectedAgents: state.connectedAgents.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    })),

  selectScreen: (selectedScreen) => set({ selectedScreen }),

  setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),

  setAgentScreen: (agentId, screenId) =>
    set((state) => ({
      agentScreens: { ...state.agentScreens, [agentId]: screenId },
    })),

  refreshAgents: async () => {
    try {
      const rawAgents = await window.screenflow.getConnectedAgents();
      // Map raw agent connections to full Agent UI types
      const mapped = rawAgents.map((ra: any) => {
        const existing = get().connectedAgents.find((a) => a.id === ra.id);
        return {
          id: ra.id,
          name: ra.name || `Agent-${ra.id.slice(0, 6)}`,
          ip: ra.ip,
          port: ra.port || 7523,
          os: ra.os || 'windows',
          osVersion: ra.osVersion || 'Unknown',
          resolution: ra.resolution || { width: 1920, height: 1080 },
          status: ra.status === 'pending'
            ? 'pending'
            : (existing?.status && existing.status !== 'pending' ? existing.status : 'connected'),
          mode: ra.mode || 'mirror',
          connectedAt: ra.connectedAt,
          audioPlaying: ra.audioPlaying || false,
          metrics: ra.metrics || {
            latency: 0,
            fps: 0,
            bandwidth: 0,
            packetsLost: 0,
            jitter: 0,
            decodingTime: 0,
          },
          capabilities: ra.capabilities || {
            maxResolution: { width: 1920, height: 1080 },
            supportedCodecs: ['H264'],
            hardwareDecoding: true,
            audioOutput: true,
            miracast: false,
          },
        } as Agent;
      });
      set({ connectedAgents: mapped });
    } catch (err) {
      console.error('Failed to refresh agents:', err);
    }
  },

  addPendingRequest: (agentId, screenId) =>
    set((state) => ({
      pendingRequests: { ...state.pendingRequests, [agentId]: screenId },
    })),

  removePendingRequest: (agentId) =>
    set((state) => {
      const next = { ...state.pendingRequests };
      delete next[agentId];
      return { pendingRequests: next };
    }),
}));
