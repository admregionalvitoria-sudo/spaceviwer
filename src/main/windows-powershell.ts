import { execFile } from 'child_process';

/** Encoded arguments prevent paths and titles from becoming shell syntax. */
export function runPowerShell(script: string, elevated = false): Promise<string> {
  const encoded = Buffer.from(`$ErrorActionPreference = 'Stop'\n${script}`, 'utf16le').toString('base64');
  const command = elevated
    ? Buffer.from(`$ErrorActionPreference = 'Stop'
$p = Start-Process -FilePath powershell.exe -WindowStyle Hidden -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'
exit $p.ExitCode`, 'utf16le').toString('base64')
    : encoded;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', command],
      { windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || stdout.trim() || error.message));
        else resolve(stdout.trim());
      });
  });
}

export const psLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;
