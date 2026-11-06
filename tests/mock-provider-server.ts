/**
 * @file mock-provider-server.ts
 * @description Real in-memory HTTP server mimicking OpenAI / NVIDIA NIM endpoints
 * for robust offline testing of AgentLoop and Provider clients.
 * Zero external dependencies (pure Node.js http module).
 */

import * as http from 'node:http';

export interface MockRequestHandler {
  (reqBody: any, req: http.IncomingMessage): {
    statusCode?: number;
    headers?: Record<string, string>;
    sseEvents?: string[];
    jsonBody?: any;
    delayMs?: number;
  };
}

export class MockProviderServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private handler: MockRequestHandler | null = null;
  public receivedRequests: Array<{ url: string; headers: http.IncomingHttpHeaders; body: any }> = [];

  public setHandler(handler: MockRequestHandler): void {
    this.handler = handler;
  }

  public async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        let bodyStr = '';
        req.on('data', (chunk) => {
          bodyStr += chunk;
        });
        req.on('end', () => {
          let parsedBody: any = {};
          try {
            parsedBody = JSON.parse(bodyStr);
          } catch {
            parsedBody = { raw: bodyStr };
          }

          this.receivedRequests.push({
            url: req.url || '',
            headers: req.headers,
            body: parsedBody,
          });

          if (!this.handler) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          const outcome = this.handler(parsedBody, req);
          const customHeaders = outcome.headers || {};
          const statusCode = outcome.statusCode || 200;

          if (outcome.sseEvents) {
            res.writeHead(statusCode, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              ...customHeaders,
            });
            for (const ev of outcome.sseEvents) {
              res.write(`data: ${ev}\n\n`);
            }
            res.write('data: [DONE]\n\n');
            res.end();
          } else if (outcome.jsonBody !== undefined) {
            res.writeHead(statusCode, {
              'Content-Type': 'application/json',
              ...customHeaders,
            });
            res.end(JSON.stringify(outcome.jsonBody));
          } else {
            res.writeHead(statusCode, customHeaders);
            res.end();
          }
        });
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as any;
        this.port = addr.port;
        resolve(`http://127.0.0.1:${this.port}/v1`);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  public getBaseURL(): string {
    return `http://127.0.0.1:${this.port}/v1`;
  }
}
