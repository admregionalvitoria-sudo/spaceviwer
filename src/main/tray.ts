// ============================================================
// ScreenFlow — System Tray
// ============================================================

import { Tray, Menu, nativeImage, NativeImage, app, BrowserWindow } from 'electron';
import * as path from 'path';
import type { InstallMode } from '../shared/types';

let tray: Tray | null = null;

export function setupTray(
  mode: InstallMode,
  mainWindow: BrowserWindow | null,
  callbacks: {
    onPauseStream?: () => void;
    onResumeStream?: () => void;
    onQuit?: () => void;
  }
) {
  // Create a simple 16x16 icon programmatically (purple square)
  const iconSize = 16;
  const icon = nativeImage.createEmpty();

  // Try to load icon from resources, fallback to app icon
  let trayIcon: NativeImage;
  try {
    const iconPath = path.join(__dirname, '../../resources/icon.png');
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = createDefaultIcon();
    }
  } catch {
    trayIcon = createDefaultIcon();
  }

  tray = new Tray(trayIcon.resize({ width: iconSize, height: iconSize }));

  const modeLabel = mode === 'master' ? 'Master' : mode === 'agent' ? 'Agente' : 'Master + Agente';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `SpaceViewer — ${modeLabel}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Abrir Painel',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Pausar Transmissão',
      click: () => callbacks.onPauseStream?.(),
      visible: mode === 'master' || mode === 'both',
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        callbacks.onQuit?.();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('SpaceViewer — Transmissão de Tela');

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return tray;
}

function createDefaultIcon(): NativeImage {
  // Create a simple colored icon as fallback
  const size = 32;
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = 0x7b;     // R (purple)
    canvas[i * 4 + 1] = 0x2f; // G
    canvas[i * 4 + 2] = 0xbe; // B
    canvas[i * 4 + 3] = 0xff; // A
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

export function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
