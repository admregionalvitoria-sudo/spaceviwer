// SpaceViewer v3.0.2
// ============================================================
// SpaceViewer — Install Mode Reader/Writer
// ============================================================

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { InstallMode } from '../shared/types';
import { CONFIG_FILE_NAME } from '../shared/constants';

function getProgramDataConfigPath(): string {
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(programData, 'SpaceViewer', CONFIG_FILE_NAME);
}

function getUserDataConfigPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, CONFIG_FILE_NAME);
}

/**
 * Read the install mode from the config file.
 * Reads %ProgramData%\SpaceViewer\install-mode.json, then falls back to legacy userData.
 * Defaults to 'both' if no config file exists (first run).
 */
export async function readInstallMode(): Promise<InstallMode> {
  const paths = [getProgramDataConfigPath(), getUserDataConfigPath()];
  for (const configPath of paths) {
    try {
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(data);
        if (['master', 'agent', 'both'].includes(config.mode)) {
          return config.mode as InstallMode;
        }
      }
    } catch (err) {
      console.error(`Failed to read install mode from ${configPath}:`, err);
    }
  }
  return 'both'; // default
}

/**
 * Save the install mode to the config file.
 * Writes to ProgramData (when elevated) and falls back to userData if that fails.
 */
export async function saveInstallMode(mode: InstallMode): Promise<void> {
  const content = JSON.stringify({ mode }, null, 2);
  try {
    const pdPath = getProgramDataConfigPath();
    const dir = path.dirname(pdPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(pdPath, content, 'utf-8');
    return;
  } catch (err) {
    console.warn('Failed to save install mode to ProgramData, falling back to userData:', err);
  }

  try {
    const udPath = getUserDataConfigPath();
    const dir = path.dirname(udPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(udPath, content, 'utf-8');
  } catch (err) {
    console.error('Failed to save install mode to userData:', err);
  }
}
