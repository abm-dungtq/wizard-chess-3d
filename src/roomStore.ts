import { replayRoomMoves, tryApplyRoomMove, type RulesState } from './roomRules.ts';

export interface RoomCoord {
  r: number;
  c: number;
}

export type PromotionPieceType = 'queen' | 'rook' | 'bishop' | 'knight';
export type GameVariant = 'chess' | 'xiangqi';

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
  gameVariant?: GameVariant;
  whiteJoined: boolean;
  blackJoined: boolean;
  whiteSkin: string;
  blackSkin: string;
  turn: 'w' | 'b';
  moves: RoomMove[];
  resetCount: number;
  updatedAt: number;
}

/** Everything needed to restore a room in another process; no listeners or derived board. */
export interface RoomSnapshot extends PublicRoomState {
  whiteToken: string | null;
  blackToken: string | null;
}

interface InternalRoomEntry extends PublicRoomState {
  whiteToken: string | null;
  blackToken: string | null;
  listeners: Set<(room: PublicRoomState) => void>;
  /** Board cache for move validation; rebuilt from `moves` when missing. */
  rules?: RulesState;
}

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const SSE_KEEPALIVE_MS = 25_000;
const MAX_ROOM_MOVES = 600;
const CLIENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const SKIN_ID_PATTERN = /^[a-z0-9_]{1,40}$/;

export function generateRoomCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const b of bytes) code += ROOM_CODE_CHARS[b % ROOM_CODE_CHARS.length];
  return code;
}

function normalizePromotion(raw?: string): PromotionPieceType {
  if (raw === 'rook' || raw === 'bishop' || raw === 'knight' || raw === 'queen') {
    return raw;
  }
  return 'queen';
}

function normalizeGameVariant(raw?: string): GameVariant {
  return raw === 'xiangqi' ? 'xiangqi' : 'chess';
}

function isValidCoord(coord: unknown, variant: GameVariant = 'xiangqi'): coord is RoomCoord {
  if (!coord || typeof coord !== 'object') return false;
  const { r, c } = coord as { r?: unknown; c?: unknown };
  const maxRows = variant === 'xiangqi' ? 10 : 8;
  const maxCols = variant === 'xiangqi' ? 9 : 8;
  return (
    typeof r === 'number' &&
    typeof c === 'number' &&
    Number.isInteger(r) &&
    Number.isInteger(c) &&
    r >= 0 &&
    r < maxRows &&
    c >= 0 &&
    c < maxCols
  );
}

function toPublicRoom(entry: InternalRoomEntry): PublicRoomState {
  return {
    code: entry.code,
    status: entry.status,
    gameVariant: entry.gameVariant || 'chess',
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
      const code = generateRoomCode();
      if (!this.rooms.has(code)) return code;
    }
    return 'W' + Date.now().toString(36).slice(-3).toUpperCase();
  }

  private ensureToken(rawToken?: string): string {
    const trimmed = String(rawToken || '').trim();
    if (CLIENT_TOKEN_PATTERN.test(trimmed)) return trimmed;
    return crypto.randomUUID();
  }

  private seatForToken(entry: InternalRoomEntry, rawToken?: string): 'w' | 'b' | null {
    const token = String(rawToken || '').trim();
    if (!token) return null;
    if (entry.whiteToken === token) return 'w';
    if (entry.blackToken === token) return 'b';
    return null;
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

  createRoom(
    preferredColor?: string,
    playerToken?: string,
    explicitCode?: string,
    skinId?: string,
    gameVariant?: string
  ) {
    this.pruneExpiredRooms();
    const cleanedExplicit = String(explicitCode || '').trim().toUpperCase();
    const code = cleanedExplicit || this.generateUniqueCode();
    const token = this.ensureToken(playerToken);
    const existing = this.rooms.get(code);
    if (existing) {
      const seat = this.seatForToken(existing, token);
      if (!seat) {
        return { ok: false as const, error: 'Room code already in use' };
      }
      return { ok: true as const, code, color: seat, playerToken: token, room: toPublicRoom(existing) };
    }
    const side: 'w' | 'b' = preferredColor === 'b' ? 'b' : 'w';
    const requestedSkin = String(skinId || '').trim();
    const skin = SKIN_ID_PATTERN.test(requestedSkin) ? requestedSkin : 'hogwarts';
    const variant = normalizeGameVariant(gameVariant);
    const now = Date.now();

    const entry: InternalRoomEntry = {
      code,
      status: 'waiting',
      gameVariant: variant,
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

  joinRoom(codeInput: string, playerToken?: string, skinId?: string, gameVariant?: string) {
    this.pruneExpiredRooms();
    const code = String(codeInput || '').trim().toUpperCase();
    if (!code) {
      return { ok: false as const, error: 'Room code is required' };
    }
    const token = this.ensureToken(playerToken);
    const requestedSkin = String(skinId || '').trim();
    const skin = SKIN_ID_PATTERN.test(requestedSkin) ? requestedSkin : '';
    const now = Date.now();
    let entry = this.rooms.get(code);
    let assignedColor: 'w' | 'b' = 'w';

    if (!entry) {
      assignedColor = 'w';
      entry = {
        code,
        status: 'waiting',
        gameVariant: normalizeGameVariant(gameVariant),
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
      if ((gameVariant === 'xiangqi' || gameVariant === 'chess') && entry.moves.length === 0) {
        entry.gameVariant = gameVariant;
        entry.rules = undefined;
      }
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
        return { ok: false as const, error: 'Room is full' };
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

  setPlayerSkin(codeInput: string, payload: { skinId?: string; playerToken?: string }) {
    const code = String(codeInput || '').trim().toUpperCase();
    const entry = this.rooms.get(code);
    if (!entry) {
      return { ok: false as const, error: 'Room not found' };
    }
    const seat = this.seatForToken(entry, payload.playerToken);
    if (!seat) {
      return { ok: false as const, error: 'Unauthorized player token' };
    }
    const skin = String(payload.skinId || '').trim();
    if (!SKIN_ID_PATTERN.test(skin)) {
      return { ok: false as const, error: 'Invalid skin id' };
    }
    if (seat === 'b') {
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

  /** Returns null when the stored moves no longer replay under the current rules. */
  private getRules(entry: InternalRoomEntry): RulesState | null {
    if (!entry.rules) {
      try {
        entry.rules = replayRoomMoves(entry.gameVariant || 'chess', entry.moves);
      } catch {
        return null;
      }
    }
    return entry.rules;
  }

  exportRoom(codeInput: string): RoomSnapshot | null {
    const code = String(codeInput || '').trim().toUpperCase();
    const entry = this.rooms.get(code);
    if (!entry) return null;
    return {
      ...toPublicRoom(entry),
      whiteToken: entry.whiteToken,
      blackToken: entry.blackToken
    };
  }

  importRoom(snapshot: RoomSnapshot): void {
    this.rooms.set(snapshot.code, { ...snapshot, listeners: new Set(), rules: undefined });
  }

  hasListeners(codeInput: string): boolean {
    const code = String(codeInput || '').trim().toUpperCase();
    return (this.rooms.get(code)?.listeners.size || 0) > 0;
  }

  recordMove(
    codeInput: string,
    payload: {
      playerToken?: string;
      color?: string;
      from?: unknown;
      to?: unknown;
      promotion?: string;
      gameVariant?: string;
    }
  ) {
    const code = String(codeInput || '').trim().toUpperCase();
    const entry = this.rooms.get(code);
    if (!entry) {
      return { ok: false as const, error: 'Room not found' };
    }
    const seat = this.seatForToken(entry, payload.playerToken);
    if (!seat) {
      return { ok: false as const, error: 'Unauthorized player token', room: toPublicRoom(entry) };
    }
    const variant: GameVariant = entry.gameVariant || 'chess';
    if (!isValidCoord(payload.from, variant) || !isValidCoord(payload.to, variant)) {
      return { ok: false as const, error: 'Invalid move coordinates', room: toPublicRoom(entry) };
    }
    if (seat !== entry.turn) {
      return { ok: false as const, error: 'Not your turn', room: toPublicRoom(entry) };
    }
    if (entry.moves.length >= MAX_ROOM_MOVES) {
      return { ok: false as const, error: 'Move limit reached', room: toPublicRoom(entry) };
    }
    const moveColor = seat;
    const from = { r: payload.from.r, c: payload.from.c };
    const to = { r: payload.to.r, c: payload.to.c };
    const requestedPromotion = normalizePromotion(payload.promotion);
    const rules = this.getRules(entry);
    if (!rules) {
      return { ok: false as const, error: 'Room history is not replayable', room: toPublicRoom(entry) };
    }
    const ruling = tryApplyRoomMove(rules, { color: moveColor, from, to, promotion: requestedPromotion });
    if (!ruling.ok) {
      return { ok: false as const, error: ruling.error, room: toPublicRoom(entry) };
    }

    const move: RoomMove = {
      seq: entry.moves.length + 1,
      color: moveColor,
      from,
      to,
      promotion: ruling.promotion || requestedPromotion,
      ts: Date.now()
    };

    entry.rules = ruling.state;
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

  resetRoom(codeInput: string, gameVariant?: string, playerToken?: string) {
    const code = String(codeInput || '').trim().toUpperCase();
    const entry = this.rooms.get(code);
    if (!entry) {
      return { ok: false as const, error: 'Room not found' };
    }
    if (!this.seatForToken(entry, playerToken)) {
      return { ok: false as const, error: 'Unauthorized player token' };
    }
    if (gameVariant === 'xiangqi' || gameVariant === 'chess') {
      entry.gameVariant = gameVariant;
    }
    entry.moves = [];
    entry.rules = undefined;
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

function statusForError(error: string): number {
  if (error === 'Room not found') return 404;
  if (error === 'Unauthorized player token') return 403;
  if (error === 'Room code already in use' || error === 'Room is full') return 409;
  return 400;
}

function resultResponse(result: { ok: boolean; error?: string }): Response {
  return jsonResponse(result, result.ok ? 200 : statusForError(result.error || ''));
}

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
      typeof body.skinId === 'string' ? body.skinId : undefined,
      typeof body.gameVariant === 'string' ? body.gameVariant : undefined
    );
    return resultResponse(result);
  }

  if (pathname === '/api/rooms/join' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const result = store.joinRoom(
      typeof body.code === 'string' ? body.code : '',
      typeof body.playerToken === 'string' ? body.playerToken : undefined,
      typeof body.skinId === 'string' ? body.skinId : undefined,
      typeof body.gameVariant === 'string' ? body.gameVariant : undefined
    );
    return resultResponse(result);
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
      skinId: typeof body.skinId === 'string' ? body.skinId : undefined,
      playerToken: typeof body.playerToken === 'string' ? body.playerToken : undefined
    });
    return resultResponse(result);
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
      promotion: typeof body.promotion === 'string' ? body.promotion : undefined,
      gameVariant: typeof body.gameVariant === 'string' ? body.gameVariant : undefined
    });
    return resultResponse(result);
  }

  if (action === 'reset' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const result = store.resetRoom(
      code,
      typeof body.gameVariant === 'string' ? body.gameVariant : undefined,
      typeof body.playerToken === 'string' ? body.playerToken : undefined
    );
    return resultResponse(result);
  }

  if (action === 'events' && request.method === 'GET') {
    const stateCheck = store.getRoomState(code);
    if (!stateCheck.ok) {
      return jsonResponse(stateCheck, 404);
    }

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

    // Stop listening once the reader is gone, even if its cancellation never reaches us,
    // so an abandoned stream cannot keep the room (and its Durable Object) alive.
    const cleanup = () => {
      unsubscribe?.();
      unsubscribe = null;
      if (keepalive) clearInterval(keepalive);
      keepalive = null;
      try {
        streamController?.close();
      } catch {
        // Already closed or errored
      }
      streamController = null;
    };
    const send = (text: string) => {
      try {
        streamController?.enqueue(encoder.encode(text));
      } catch {
        cleanup();
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        unsubscribe = store.subscribe(code, (room) => send(`data: ${JSON.stringify({ room })}\n\n`));
        keepalive = setInterval(() => send(': keepalive\n\n'), SSE_KEEPALIVE_MS);
      },
      cancel() {
        streamController = null;
        cleanup();
      }
    });

    request.signal?.addEventListener('abort', cleanup);

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

export interface FeedbackSubmission {
  id: string;
  createdAt: string;
  gameVariant: string;
  category: string;
  author: string;
  message: string;
  deviceInfo: string;
  syncedToSheet: boolean;
  sheetUrl: string;
}

export interface FeedbackSheetConfig {
  GOOGLE_SA_EMAIL?: string;
  GOOGLE_SA_PRIVATE_KEY?: string;
  GOOGLE_SHEET_ID?: string;
}

export const DEFAULT_FEEDBACK_SHEET_ID = '15M_B8VXZkYySTUIm2ZyIq-lw7dDCnshyICDR-sS7pv8';
export const DEFAULT_FEEDBACK_SHEET_URL = `https://docs.google.com/spreadsheets/d/${DEFAULT_FEEDBACK_SHEET_ID}/edit`;

const inMemoryFeedbackList: FeedbackSubmission[] = [];
let cachedGoogleAccessToken: { token: string; expiresAt: number } | null = null;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function textToBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getGoogleSheetsAccessToken(saEmail: string, saPrivateKey: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedGoogleAccessToken && cachedGoogleAccessToken.expiresAt > nowSec + 60) {
    return cachedGoogleAccessToken.token;
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: saEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600
  };

  const unsignedJwt = `${textToBase64Url(JSON.stringify(header))}.${textToBase64Url(JSON.stringify(payload))}`;
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(saPrivateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedJwt)
  );
  const jwt = `${unsignedJwt}.${bytesToBase64Url(new Uint8Array(signatureBuf))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  if (!tokenRes.ok) {
    throw new Error(`Google OAuth2 token error: ${tokenRes.status}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (!tokenJson.access_token) {
    throw new Error('Missing access_token in Google OAuth2 response');
  }
  cachedGoogleAccessToken = {
    token: tokenJson.access_token,
    expiresAt: nowSec + (tokenJson.expires_in || 3500)
  };
  return tokenJson.access_token;
}

async function appendRowToGoogleSheet(
  rowValues: string[],
  config?: FeedbackSheetConfig
): Promise<{ synced: boolean; sheetId: string }> {
  const sheetId = String(config?.GOOGLE_SHEET_ID || DEFAULT_FEEDBACK_SHEET_ID).trim();
  const saEmail = String(config?.GOOGLE_SA_EMAIL || '').trim();
  const saKey = String(config?.GOOGLE_SA_PRIVATE_KEY || '').trim();
  if (!saEmail || !saKey || !sheetId) {
    return { synced: false, sheetId };
  }
  const accessToken = await getGoogleSheetsAccessToken(saEmail, saKey);
  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    sheetId
  )}/values/DeXuat!A1:F1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(appendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [rowValues]
    })
  });
  return { synced: res.ok, sheetId };
}

export async function handleFeedbackApiRequest(
  request: Request,
  config?: FeedbackSheetConfig
): Promise<Response | null> {
  const url = new URL(request.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/feedback')) {
    return null;
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const sheetId = String(config?.GOOGLE_SHEET_ID || DEFAULT_FEEDBACK_SHEET_ID).trim();
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

  if (request.method === 'GET') {
    return jsonResponse({
      ok: true,
      sheetId,
      sheetUrl,
      items: inMemoryFeedbackList.slice(-50).reverse()
    });
  }

  if (request.method === 'POST') {
    const body = await readJsonBody(request);
    const message = String(body.message || '').trim().slice(0, 1500);
    if (!message || message.length < 2) {
      return jsonResponse({ ok: false, error: 'Vui lòng nhập nội dung đề xuất của bạn.' }, 400);
    }

    const rawVariant = String(body.gameVariant || 'both').trim();
    const variantLabel =
      rawVariant === 'xiangqi'
        ? 'Cờ Tướng 3D (9×10)'
        : rawVariant === 'chess'
          ? 'Cờ Vua 3D (8×8)'
          : 'Cả 2 Môn (Cờ Vua & Cờ Tướng)';
    const category = String(body.category || 'Ý tưởng tính năng mới').trim().slice(0, 120);
    const author = String(body.author || 'Người chơi ẩn danh').trim().slice(0, 120) || 'Người chơi ẩn danh';
    const deviceInfo = String(body.deviceInfo || request.headers.get('user-agent') || 'Web Browser')
      .trim()
      .slice(0, 220);

    const createdAt = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    let syncedToSheet = false;

    try {
      const sheetRes = await appendRowToGoogleSheet(
        [createdAt, variantLabel, category, author, message, deviceInfo],
        config
      );
      syncedToSheet = sheetRes.synced;
    } catch {
      syncedToSheet = false;
    }

    const entry: FeedbackSubmission = {
      id: 'fb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      createdAt,
      gameVariant: variantLabel,
      category,
      author,
      message,
      deviceInfo,
      syncedToSheet,
      sheetUrl
    };
    inMemoryFeedbackList.push(entry);
    if (inMemoryFeedbackList.length > 200) {
      inMemoryFeedbackList.shift();
    }

    return jsonResponse({
      ok: true,
      feedback: entry,
      syncedToSheet,
      sheetId,
      sheetUrl
    });
  }

  return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
}
