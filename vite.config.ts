import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defaultRoomStore, handleRoomApiRequest } from './src/roomStore.ts';

function attachRoomApiMiddleware(middlewares: {
  use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
}) {
  middlewares.use(async (req, res, next) => {
    const rawUrl = req.url || '';
    if (!rawUrl.startsWith('/api/rooms')) {
      next();
      return;
    }

    try {
      const method = (req.method || 'GET').toUpperCase();
      let bodyBuffer: Buffer | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        bodyBuffer = Buffer.concat(chunks);
      }

      const headers = new Headers();
      for (const [key, val] of Object.entries(req.headers)) {
        if (typeof val === 'string') headers.set(key, val);
        else if (Array.isArray(val)) headers.set(key, val.join(', '));
      }

      const abortController = new AbortController();
      req.on('close', () => abortController.abort());

      const webReq = new Request(`http://localhost${rawUrl}`, {
        method,
        headers,
        body: bodyBuffer && bodyBuffer.length > 0 ? new Uint8Array(bodyBuffer) : undefined,
        signal: abortController.signal
      });

      const webRes = await handleRoomApiRequest(webReq, defaultRoomStore);
      if (!webRes) {
        next();
        return;
      }

      const outHeaders: Record<string, string> = {};
      webRes.headers.forEach((value, key) => {
        outHeaders[key] = value;
      });
      res.writeHead(webRes.status, outHeaders);

      const contentType = webRes.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && webRes.body) {
        const reader = webRes.body.getReader();
        req.on('close', () => {
          reader.cancel().catch(() => {});
        });
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) res.write(Buffer.from(value));
          }
        } catch {
          // Client disconnected
        } finally {
          res.end();
        }
        return;
      }

      const buf = Buffer.from(await webRes.arrayBuffer());
      res.end(buf);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  });
}

function wizardChessRoomApiPlugin(): Plugin {
  return {
    name: 'wizard-chess-room-api',
    configureServer(server) {
      attachRoomApiMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachRoomApiMiddleware(server.middlewares);
    }
  };
}

export default defineConfig(({ mode }) => {
  const _env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0'
    },
    plugins: [wizardChessRoomApiPlugin(), react(), cloudflare()],
    resolve: {
      alias: {
        '@': path.resolve('./src')
      }
    }
  };
});
