// SpaceViewer v2.2.9
import React, { useEffect, useState } from 'react';
import { useMasterStore } from '../stores/masterStore';
import { GlassCard } from '../components/ui/GlassCard';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface ChartDataPoint {
  time: string;
  bandwidth: number;
  latency: number;
  fps: number;
}

export const NetworkMonitor: React.FC = () => {
  const { connectedAgents, streamStatus, streamStats } = useMasterStore();
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);

  // Collect stats over time
  useEffect(() => {
    const interval = setInterval(() => {
      // Calculate averages from connected agents
      let totalBandwidth = 0;
      let avgLatency = 0;
      let avgFps = 0;

      if (connectedAgents.length > 0) {
        connectedAgents.forEach((agent) => {
          totalBandwidth += agent.metrics.bandwidth || 0;
          avgLatency += agent.metrics.latency || 0;
          avgFps += agent.metrics.fps || 0;
        });
        avgLatency /= connectedAgents.length;
        avgFps /= connectedAgents.length;
      } else if (streamStats) {
        // Fallback to stream general stats
        totalBandwidth = streamStats.totalBandwidth;
        avgLatency = streamStats.avgLatency;
        avgFps = streamStats.avgFps;
      }

      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now
        .getMinutes()
        .toString()
        .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

      setChartData((prev) => {
        const next = [...prev, { time: timeStr, bandwidth: totalBandwidth, latency: avgLatency, fps: avgFps }];
        return next.slice(-20); // Keep last 20 snapshots
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [connectedAgents, streamStats]);

  // Compute current display stats
  const currentBandwidth = chartData[chartData.length - 1]?.bandwidth || 0;
  const currentLatency = chartData[chartData.length - 1]?.latency || 0;
  const currentFps = chartData[chartData.length - 1]?.fps || 0;

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto h-full select-none bg-bg-space text-neutral-900">
      {/* Title */}
      <div className="border-b border-neutral-200/60 pb-4">
        <h2 className="font-display font-extrabold text-xl text-neutral-900 tracking-wide uppercase">Monitor de Rede</h2>
        <p className="text-xs text-neutral-500 mt-1">Dados de desempenho do WebRTC e taxa de transferência da rede em tempo real.</p>
      </div>

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <GlassCard className="p-4 flex flex-col justify-between relative overflow-hidden">
          <span className="font-mono text-[10px] text-neutral-500 uppercase tracking-wider">Tráfego Total</span>
          <span className="text-2xl font-extrabold text-neutral-900 tracking-tight mt-2">{currentBandwidth.toFixed(2)} Mbps</span>
          <span className="text-[10px] text-neutral-450 mt-1">Transmissão em tempo real</span>
        </GlassCard>

        <GlassCard className="p-4 flex flex-col justify-between relative overflow-hidden">
          <span className="font-mono text-[10px] text-neutral-500 uppercase tracking-wider">Latência Média</span>
          <span className="text-2xl font-extrabold text-neutral-900 tracking-tight mt-2">{currentLatency.toFixed(0)} ms</span>
          <span className="text-[10px] text-neutral-450 mt-1">Tempo de resposta P2P</span>
        </GlassCard>

        <GlassCard className="p-4 flex flex-col justify-between relative overflow-hidden">
          <span className="font-mono text-[10px] text-neutral-500 uppercase tracking-wider">Média de Quadros</span>
          <span className="text-2xl font-extrabold text-neutral-900 tracking-tight mt-2">{currentFps.toFixed(0)} FPS</span>
          <span className="text-[10px] text-neutral-450 mt-1">Estabilidade de codificação</span>
        </GlassCard>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bandwidth Chart */}
        <GlassCard className="p-5 flex flex-col h-[320px]">
          <h3 className="font-display font-bold text-sm text-neutral-800 mb-4 uppercase tracking-wider">Largura de Banda (Mbps)</h3>
          <div className="flex-1 w-full text-xs font-mono">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.05)" />
                <XAxis dataKey="time" stroke="rgba(0, 0, 0, 0.3)" />
                <YAxis stroke="rgba(0, 0, 0, 0.3)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    borderColor: 'rgba(0, 0, 0, 0.08)',
                    borderRadius: '8px',
                    color: '#111827',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="bandwidth"
                  stroke="#111827"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Latency Chart */}
        <GlassCard className="p-5 flex flex-col h-[320px]">
          <h3 className="font-display font-bold text-sm text-neutral-800 mb-4 uppercase tracking-wider">Latência P2P (ms)</h3>
          <div className="flex-1 w-full text-xs font-mono">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.05)" />
                <XAxis dataKey="time" stroke="rgba(0, 0, 0, 0.3)" />
                <YAxis stroke="rgba(0, 0, 0, 0.3)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    borderColor: 'rgba(0, 0, 0, 0.08)',
                    borderRadius: '8px',
                    color: '#111827',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="latency"
                  stroke="#4B5563"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* FPS Stability Chart */}
        <GlassCard className="p-5 flex flex-col h-[320px] lg:col-span-2">
          <h3 className="font-display font-bold text-sm text-neutral-800 mb-4 uppercase tracking-wider">Taxa de Atualização de Quadros (FPS)</h3>
          <div className="flex-1 w-full text-xs font-mono">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.05)" />
                <XAxis dataKey="time" stroke="rgba(0, 0, 0, 0.3)" />
                <YAxis stroke="rgba(0, 0, 0, 0.3)" domain={[0, 130]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    borderColor: 'rgba(0, 0, 0, 0.08)',
                    borderRadius: '8px',
                    color: '#111827',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="fps"
                  stroke="#111827"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
export default NetworkMonitor;
