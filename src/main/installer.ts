// ============================================================
// ScreenFlow — Install Mode Reader/Writer
// ============================================================

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { InstallMode } from '../shared/types';
import { CONFIG_FILE_NAME } from '../shared/constants';

function getConfigPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, CONFIG_FILE_NAME);
}

/**
 * Read the install mode from the config file.
 * Defaults to 'both' if no config file exists (first run).
 */
export async function readInstallMode(): Promise<InstallMode> {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(data);
      if (['master', 'agent', 'both'].includes(config.mode)) {
        return config.mode as InstallMode;
      }
    }
  } catch (err) {
    console.error('Failed to read install mode:', err);
  }
  return 'both'; // default
}

/**
 * Save the install mode to the config file.
 */
export async function saveInstallMode(mode: InstallMode): Promise<void> {
  try {
    const configPath = getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify({ mode }, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save install mode:', err);
  }
}
