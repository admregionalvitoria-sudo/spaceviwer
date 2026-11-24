// ============================================================
// SpaceViewer — Diagnostics log
// Non-blocking log to %ProgramData%\SpaceViewer\logs\spaceviewer.log
// Contract: docs/ARQUITETURA-TELA-ESTENDIDA.md §3.5
// ============================================================

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

let resolvedLogDir: string | null = null;
let resolvedLogFile: string | null = null;
let isRotating = false;
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

export function getDiagnosticsDir(): string {
  if (resolvedLogDir) return resolvedLogDir;

  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const primaryDir = path.join(programData, 'SpaceViewer', 'logs');

  try {
    if (!fs.existsSync(primaryDir)) {
      fs.mkdirSync(primaryDir, { recursive: true });
    }
    const testFile = path.join(primaryDir, `.write-test-${Date.now()}`);
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
    resolvedLogDir = primaryDir;
  } catch {
    try {
      const fallbackDir = path.join(app ? app.getPath('userData') : process.cwd(), 'logs');
      if (!fs.existsSync(fallbackDir)) {
        fs.mkdirSync(fallbackDir, { recursive: true });
      }
      resolvedLogDir = fallbackDir;
    } catch {
      resolvedLogDir = path.join(process.cwd(), 'logs');
    }
  }

  resolvedLogFile = path.join(resolvedLogDir, 'spaceviewer.log');
  return resolvedLogDir;
}

export function getDiagnosticsFilePath(): string {
  getDiagnosticsDir();
  return resolvedLogFile!;
}

export function log(scope: string, message: string, data?: unknown): void {
  try {
    const file = getDiagnosticsFilePath();
    const isoTime = new Date().toISOString();
    const dataSuffix = data !== undefined ? ` ${JSON.stringify(data)}` : '';
    const line = `${isoTime} [${scope}] ${message}${dataSuffix}\n`;

    fs.stat(file, (err, stats) => {
      if (!err && stats && stats.size > MAX_LOG_SIZE && !isRotating) {
        isRotating = true;
        const backupFile = `${file}.1`;
        fs.unlink(backupFile, () => {
          fs.rename(file, backupFile, () => {
            isRotating = false;
            fs.appendFile(file, line, 'utf8', () => {});
          });
        });
        return;
      }
      fs.appendFile(file, line, 'utf8', () => {});
    });
  } catch {
    // Non-blocking, ignore errors
  }
}
