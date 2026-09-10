// SpaceViewer v2.2.9
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { GlassCard } from './GlassCard';

interface QRCodeDisplayProps {
  value: string;
  size?: number;
  label?: string;
}

export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({ value, size = 160, label }) => {
  const [qrSrc, setQrSrc] = useState<string>('');

  useEffect(() => {
    if (!value) return;

    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1.5,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    })
      .then((url) => setQrSrc(url))
      .catch((err) => console.error('Failed to generate QR Code:', err));
  }, [value, size]);

  return (
    <div className="flex flex-col items-center justify-center space-y-3">
      <div className="p-2 bg-white rounded-xl overflow-hidden shadow-lg border border-border-space/40">
        {qrSrc ? (
          <img
            src={qrSrc}
            alt="QR Code de Conexão"
            style={{ width: size, height: size }}
            className="rounded-lg select-none"
            draggable={false}
          />
        ) : (
          <div
            style={{ width: size, height: size }}
            className="flex items-center justify-center bg-neutral-100 text-neutral-500 font-mono text-xs rounded-lg"
          >
            A carregar...
          </div>
        )}
      </div>
      {label && <span className="font-mono text-xs text-slate-400 text-center uppercase tracking-wider">{label}</span>}
    </div>
  );
};
