import {
  defaultRoomStore,
  generateRoomCode,
  handleFeedbackApiRequest,
  handleRoomApiRequest,
  type FeedbackSheetConfig
} from './roomStore.ts';

export { RoomDurableObject } from './roomDurableObject.ts';

interface RoomStub {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv extends FeedbackSheetConfig {
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
  ROOMS?: {
    idFromName(name: string): unknown;
    get(id: unknown): RoomStub;
  };
  /** "memory" sends rooms to the per-isolate store instead of the Durable Object. */
  ROOMS_BACKEND?: string;
}

const MAX_CREATE_ATTEMPTS = 5;

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function withCode(request: Request, body: Record<string, unknown>, code: string): Request {
  return new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ ...body, code })
  });
}

async function routeRoomRequest(
  request: Request,
  rooms: NonNullable<WorkerEnv['ROOMS']>,
  pathname: string
): Promise<Response | null> {
  const forward = (code: string, req: Request) => rooms.get(rooms.idFromName(code)).fetch(req);

  if (request.method === 'OPTIONS') {
    return handleRoomApiRequest(request, defaultRoomStore);
  }

  if (request.method === 'POST' && (pathname === '/api/rooms/create' || pathname === '/api/rooms/join')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const requested = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';

    if (pathname === '/api/rooms/join') {
      if (!requested) {
        return handleRoomApiRequest(withCode(request, body, ''), defaultRoomStore);
      }
      return forward(requested, withCode(request, body, requested));
    }

    if (requested) return forward(requested, withCode(request, body, requested));
    let res: Response | null = null;
    // A generated code can collide with a live room; the room answers 409, so try another.
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const code = generateRoomCode();
      res = await forward(code, withCode(request, body, code));
      if (res.status !== 409) return res;
    }
    return res;
  }

  const match = pathname.match(/^\/api\/rooms\/([^/]+)\//);
  if (match) return forward(match[1].toUpperCase(), request);
  return null;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/rooms')) {
      if (env?.ROOMS && env.ROOMS_BACKEND !== 'memory') {
        try {
          const routed = await routeRoomRequest(request, env.ROOMS, url.pathname);
          if (routed) return routed;
        } catch {
          // Clients treat a non-JSON answer as "no room server" and go offline, so always answer in JSON.
          return jsonError('Room service error', 500);
        }
      } else {
        const apiRes = await handleRoomApiRequest(request, defaultRoomStore);
        if (apiRes) return apiRes;
      }
    }

    if (url.pathname.startsWith('/api/feedback')) {
      const fbRes = await handleFeedbackApiRequest(request, env);
      if (fbRes) return fbRes;
    }

    if (env?.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
