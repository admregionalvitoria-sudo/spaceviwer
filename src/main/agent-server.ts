// SpaceViewer v2.2.9
import { createServer, Server } from 'http';
import { EventEmitter } from 'events';

export class AgentServer extends EventEmitter {
  private server: Server | null = null;
  private port = 7524;
  private _isRunning = false;

  constructor() {
    super();
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryStart = (portToTry: number) => {
        this.server = createServer((req, res) => {
          // Allow CORS
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

          if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
          }

          try {
            const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            if (url.pathname === '/connect-to-master') {
              const host = url.searchParams.get('host');
              const portStr = url.searchParams.get('port');
              const name = url.searchParams.get('name') || 'Master';

              if (host && portStr) {
                const port = parseInt(portStr, 10);
                console.log(`[AgentServer] Received request to connect to master: ${name} (${host}:${port})`);
                
                // Emit event to be captured in index.ts and forwarded to renderer
                this.emit('connect-request', { host, port, name, addresses: [host] });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', message: 'Connecting...' }));
                return;
              }
            }
          } catch (e) {
            console.error('[AgentServer] Request parsing failed:', e);
          }

          res.writeHead(404);
          res.end();
        });

        this.server.listen(portToTry, '0.0.0.0', () => {
          this.port = portToTry;
          this._isRunning = true;
          console.log(`[AgentServer] Running on port ${this.port}`);
          resolve(this.port);
        });

        this.server.on('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`[AgentServer] Port ${portToTry} in use, trying next...`);
            tryStart(portToTry + 1);
          } else {
            reject(err);
          }
        });
      };

      tryStart(this.port);
    });
  }

  async stop(): Promise<void> {
    this._isRunning = false;
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
