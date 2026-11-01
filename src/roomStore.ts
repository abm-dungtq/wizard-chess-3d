export interface RoomCoord {
  r: number;
  c: number;
}

export type PromotionPieceType = 'queen' | 'rook' | 'bishop' | 'knight';

export interface RoomMove {
  seq: number;
  color: 'w' | 'b';
  from: RoomCoord;
  to: RoomCoord;
  promotion: PromotionPieceType;
  ts: number;
}

export interface PublicRoomState {
  code: string;
  status: 'waiting' | 'playing';
  whiteJoined: boolean;
  blackJoined: boolean;
  whiteSkin: string;
  blackSkin: string;
  turn: 'w' | 'b';
  moves: RoomMove[];
  resetCount: number;
  updatedAt: number;
}

interface InternalRoomEntry extends PublicRoomState {
  whiteToken: string | null;
  blackToken: string | null;
  listeners: Set<(room: PublicRoomState) => void>;
}

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function normalizePromotion(raw?: string): PromotionPieceType {
  if (raw === 'rook' || raw === 'bishop' || raw === 'knight' || raw === 'queen') {
    return raw;
  }
  return 'queen';
}

function isValidCoord(coord: unknown): coord is RoomCoord {
  if (!coord || typeof coord !== 'object') return false;
  const { r, c } = coord as { r?: unknown; c?: unknown };
  return (
    typeof r === 'number' &&
    typeof c === 'number' &&
    Number.isInteger(r) &&
    Number.isInteger(c) &&
    r >= 0 &&
    r < 8 &&
    c >= 0 &&
    c < 8
  );
}

function toPublicRoom(entry: InternalRoomEntry): PublicRoomState {
  return {
    code: entry.code,
    status: entry.status,
    whiteJoined: entry.whiteJoined,
    blackJoined: entry.blackJoined,
    whiteSkin: entry.whiteSkin || 'hogwarts',
    blackSkin: entry.blackSkin || 'hogwarts',
    turn: entry.turn,
    moves: entry.moves.map((m) => ({
      seq: m.seq,
      color: m.color,
      from: { r: m.from.r, c: m.from.c },
      to: { r: m.to.r, c: m.to.c },
      promotion: m.promotion,
      ts: m.ts
    })),
    resetCount: entry.resetCount,
    updatedAt: entry.updatedAt
  };
}

export class RoomStore {
  private rooms = new Map<string, InternalRoomEntry>();

  private pruneExpiredRooms(now = Date.now()): void {
    for (const [code, entry] of this.rooms.entries()) {
      if (now - entry.updatedAt > ROOM_TTL_MS && entry.listeners.size === 0) {
        this.rooms.delete(code);
      }
    }
  }

  private generateUniqueCode(): string {
    for (let attempt = 0; attempt < 32; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return 'W' + Date.now().toString(36).slice(-3).toUpperCase();
  }

  private ensureToken(rawToken?: string): string {
    const trimmed = String(rawToken || '').trim();
    if (trimmed) return trimmed;
    return 'tok_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  }

  private broadcast(entry: InternalRoomEntry): void {
    const snapshot = toPublicRoom(entry);
    for (const listener of entry.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Ignore broken listener
      }
    }
  }

  createRoom(preferredColor?: string, playerToken?: string, explicitCode?: string, skinId?: string) {
    this.pruneExpiredRooms();
    const cleanedExplicit = String(explicitCode || '').trim().toUpperCase();
    const code = cleanedExplicit || this.generateUniqueCode();
    const token = this.ensureToken(playerToken);
    const side: 'w' | 'b' = preferredColor === 'b' ? 'b' : 'w';
    const skin = String(skinId || '').trim() || 'hogwarts';
    const now = Date.now();

    const entry: InternalRoomEntry = {
      code,
      status: 'waiting',
      whiteJoined: side === 'w',
      blackJoined: side === 'b',
      whiteSkin: side === 'w' ? skin : 'hogwarts',
      blackSkin: side === 'b' ? skin : 'hogwarts',
      whiteToken: side === 'w' ? token : null,
      blackToken: side === 'b' ? token : null,
      turn: 'w',
      moves: [],
      resetCount: 0,
      updatedAt: now,
      listeners: new Set()
    };
    this.rooms.set(code, entry);

    return {
      ok: true as const,
      code,
      color: side,
      playerToken: token,
      room: toPublicRoom(entry)
    };
  }

  joinRoom(codeInput: string, playerToken?: string, skinId?: string) {
    this.pruneExpiredRooms();
    const code = String(codeInput || '').trim().toUpperCase();
    if (!code) {
      return { ok: false as const, error: 'Room code is required' };
    }
    const token = this.ensureToken(playerToken);
    const skin = String(skinId || '').trim();
    const now = Date.now();
    let entry = this.rooms.get(code);
    let assignedColor: 'w' | 'b' = 'w';

    if (!entry) {
      assignedColor = 'w';
      entry = {
        code,
        status: 'waiting',
        whiteJoined: true,
        blackJoined: false,
        whiteSkin: skin || 'hogwarts',
        blackSkin: 'hogwarts',
        whiteToken: token,
        blackToken: null,
        turn: 'w',
        moves: [],
        resetCount: 0,
        updatedAt: now,
        listeners: new Set()
      };
      this.rooms.set(code, entry);
    } else {
      if (entry.whiteToken === token) {
        assignedColor = 'w';
        entry.whiteJoined = true;
      } else if (entry.blackToken === token) {
        assignedColor = 'b';
        entry.blackJoined = true;
      } else if (!entry.whiteJoined) {
        entry.whiteJoined = true;
        entry.whiteToken = token;
        assignedColor = 'w';
      } else if (!entry.blackJoined) {
        entry.blackJoined = true;
        entry.blackToken = token;
        assignedColor = 'b';
      } else {
        assignedColor = 'b';
      }
      if (skin) {
        if (assignedColor === 'w') entry.whiteSkin = skin;
        else entry.blackSkin = skin;
      }
      entry.status = entry.whiteJoined && entry.blackJoined ? 'playing' : 'waiting';
      entry.updatedAt = now;
    }

    this.broadcast(entry);
    return {
      ok: true as const,
      code,
      color: assignedColor,
      playerToken: token,
      room: toPublicRoom(entry)
    };
  }

  setPlayerSkin(codeInput: string, payload: { color?: string; skinId?: string }) {
    const code = String(codeInput || '').trim().toUpperCase();
    const entry = this.rooms.get(code);
    if (!entry) {
      return { ok: false as const, error: 'Room not found' };
    }
    const skin = String(payload.skinId || '').trim() || 'hogwarts';
    if (payload.color === 'b') {
      entry.blackSkin = skin;
    } else {
      entry.whiteSkin = skin;
    }
    entry.updatedAt = Date.now();
    this.broadcast(entry);
    return {
      ok: true as const,
      room: toPublicRoom(entry)
    };
  }

  getRoomState(codeInput: string) {
    this.pruneExpiredRooms();
    const code = String(codeInput || '').trim().toUpperCase();
    const entry = this.rooms.get(code);
    if (!entry) {
      return { ok: false as const, error: 'Room not found' };
    }
    return {
      ok: true as const,
      room: toPublicRoom(entry)
    };
  }

  recordMove(
    codeInput: string,
    payload: {
      playerToken?: string;
      color?: string;
      from?: unknown;
      to?: unknown;
      promotion?: string;
    }
  ) {
    const code = String(codeInput || '').trim().toUpperCase();
    const entry = this.rooms.get(code);
    if (!entry) {
      return { ok: false as const, error: 'Room not found' };
    }
    if (!isValidCoord(payload.from) || !isValidCoord(payload.to)) {
      return { ok: false as const, error: 'Invalid move coordinates', room: toPublicRoom(entry) };
    }
    const moveColor: 'w' | 'b' = payload.color === 'b' ? 'b' : 'w';
    if (moveColor !== entry.turn) {
      return { ok: false as const, error: 'Not your turn', room: toPublicRoom(entry) };
    }

    const token = String(payload.playerToken || '').trim();
    if (moveColor === 'w') {
      if (entry.whiteToken && token && entry.whiteToken !== token) {
        return { ok: false as const, error: 'Unauthorized White player token', room: toPublicRoom(entry) };
      }
      if (!entry.whiteToken && token) entry.whiteToken = token;
    } else {
      if (entry.blackToken && token && entry.blackToken !== token) {
        return { ok: false as const, error: 'Unauthorized Black player token', room: toPublicRoom(entry) };
      }
      if (!entry.blackToken && token) entry.blackToken = token;
    }

    const move: RoomMove = {
      seq: entry.moves.length + 1,
      color: moveColor,
      from: { r: payload.from.r, c: payload.from.c },
      to: { r: payload.to.r, c: payload.to.c },
      promotion: normalizePromotion(payload.promotion),
      ts: Date.now()
    };

    entry.moves.push(move);
    entry.turn = moveColor === 'w' ? 'b' : 'w';
    entry.updatedAt = move.ts;
    this.broadcast(entry);

    return {
      ok: true as const,
      move,
      room: toPublicRoom(entry)
    };
  }

  resetRoom(codeInput: string) {
    const code = String(codeInput || '').trim().toUpperCase();
    const entry = this.rooms.get(code);
    if (!entry) {
      return { ok: false as const, error: 'Room not found' };
    }
    entry.moves = [];
    entry.turn = 'w';
    entry.resetCount = (entry.resetCount || 0) + 1;
    entry.updatedAt = Date.now();
    this.broadcast(entry);

    return {
      ok: true as const,
      room: toPublicRoom(entry)
    };
  }

  subscribe(codeInput: string, listener: (room: PublicRoomState) => void): () => void {
    const code = String(codeInput || '').trim().toUpperCase();
    const entry = this.rooms.get(code);
    if (!entry) {
      return () => {};
    }
    entry.listeners.add(listener);
    listener(toPublicRoom(entry));
    return () => {
      entry.listeners.delete(listener);
    };
  }
}

export const defaultRoomStore = new RoomStore();

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS
    }
  });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = await request.json();
    if (data && typeof data === 'object') {
      return data as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON body
  }
  return {};
}

export async function handleRoomApiRequest(
  request: Request,
  store: RoomStore = defaultRoomStore
): Promise<Response | null> {
  const url = new URL(request.url, 'http://localhost');
  const { pathname } = url;

  if (!pathname.startsWith('/api/rooms')) {
    return null;
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (pathname === '/api/rooms/create' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const result = store.createRoom(
      typeof body.preferredColor === 'string' ? body.preferredColor : undefined,
      typeof body.playerToken === 'string' ? body.playerToken : undefined,
      typeof body.code === 'string' ? body.code : undefined,
      typeof body.skinId === 'string' ? body.skinId : undefined
    );
    return jsonResponse(result, 200);
  }

  if (pathname === '/api/rooms/join' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const result = store.joinRoom(
      typeof body.code === 'string' ? body.code : '',
      typeof body.playerToken === 'string' ? body.playerToken : undefined,
      typeof body.skinId === 'string' ? body.skinId : undefined
    );
    return jsonResponse(result, result.ok ? 200 : result.error === 'Room not found' ? 404 : 400);
  }

  const match = pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/(state|move|reset|skin|events)$/);
  if (!match) {
    return jsonResponse({ ok: false, error: 'Unknown room endpoint' }, 404);
  }

  const code = match[1].toUpperCase();
  const action = match[2];

  if (action === 'skin' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const result = store.setPlayerSkin(code, {
      color: typeof body.color === 'string' ? body.color : undefined,
      skinId: typeof body.skinId === 'string' ? body.skinId : undefined
    });
    return jsonResponse(result, result.ok ? 200 : 404);
  }

  if (action === 'state' && request.method === 'GET') {
    const result = store.getRoomState(code);
    return jsonResponse(result, result.ok ? 200 : 404);
  }

  if (action === 'move' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const result = store.recordMove(code, {
      playerToken: typeof body.playerToken === 'string' ? body.playerToken : undefined,
      color: typeof body.color === 'string' ? body.color : undefined,
      from: body.from,
      to: body.to,
      promotion: typeof body.promotion === 'string' ? body.promotion : undefined
    });
    return jsonResponse(result, result.ok ? 200 : result.error === 'Room not found' ? 404 : 400);
  }

  if (action === 'reset' && request.method === 'POST') {
    const result = store.resetRoom(code);
    return jsonResponse(result, result.ok ? 200 : 404);
  }

  if (action === 'events' && request.method === 'GET') {
    const stateCheck = store.getRoomState(code);
    if (!stateCheck.ok) {
      return jsonResponse(stateCheck, 404);
    }

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        unsubscribe = store.subscribe(code, (room) => {
          const payload = `data: ${JSON.stringify({ room })}\n\n`;
          controller.enqueue(encoder.encode(payload));
        });
      },
      cancel() {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      }
    });

    request.signal?.addEventListener('abort', () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        ...CORS_HEADERS
      }
    });
  }

  return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
}
