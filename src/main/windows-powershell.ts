import { execFile } from 'child_process';

let elevatedCache: Promise<boolean> | null = null;

/**
 * Checks whether the current process is running with administrative privileges.
 * Cached after the first check.
 */
export function isElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  if (elevatedCache) return elevatedCache;
  elevatedCache = new Promise<boolean>((resolve) => {
    execFile('net.exe', ['session'], { windowsHide: true }, (err) => {
      resolve(!err);
    });
  });
  return elevatedCache;
}

/** Encoded arguments prevent paths and titles from becoming shell syntax. */
export async function runPowerShell(script: string, elevated = false): Promise<string> {
  const needsElevation = elevated && !(await isElevated());
  const encoded = Buffer.from(`$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n${script}`, 'utf16le').toString('base64');
  const command = needsElevation
    ? Buffer.from(`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$p = Start-Process -FilePath powershell.exe -WindowStyle Hidden -Verb RunAs -Wait -PassThru -ArgumentList '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-OutputFormat','Text','-EncodedCommand','${encoded}'
exit $p.ExitCode`, 'utf16le').toString('base64')
    : encoded;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', command],
      { windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr.trim() || stdout.trim()).replace(/_x000D__x000A_/g, '\n');
          const safeDetail = !detail || /-EncodedCommand|#< CLIXML|[A-Za-z0-9+/]{180,}={0,2}/i.test(detail)
            ? 'O Windows não concluiu a operação. Confirme a solicitação de administrador e verifique o driver de tela virtual.'
            : detail.slice(0, 700);
          reject(new Error(safeDetail));
        }
        else resolve(stdout.trim());
      });
  });
}

export const psLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;
