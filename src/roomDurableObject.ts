import { ROOM_TTL_MS, RoomStore, handleRoomApiRequest, type RoomSnapshot } from './roomStore.ts';

// Minimal local shapes of the Durable Object runtime, so Node tests can load this file
// without `cloudflare:workers`.
interface DOStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(ms: number): Promise<void>;
}

interface DOState {
  storage: DOStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

const SNAPSHOT_KEY = 'room';
const LISTENER_RECHECK_MS = 30 * 60 * 1000;

function roomCodeFromPath(pathname: string): string {
  const match = pathname.match(/^\/api\/rooms\/([^/]+)\/[^/]+$/);
  return match && match[1] !== 'create' && match[1] !== 'join' ? match[1].toUpperCase() : '';
}

/** One instance per room code: the room lives in memory and is saved after every change. */
export class RoomDurableObject {
  state: DOState;
  store: RoomStore;
  code: string;

  constructor(state: DOState, _env: unknown) {
    this.state = state;
    this.store = new RoomStore();
    this.code = '';
    // Rules are rebuilt lazily on the next move, so a bad history cannot block loading.
    state.blockConcurrencyWhile(async () => {
      const snapshot = await state.storage.get<RoomSnapshot>(SNAPSHOT_KEY);
      if (snapshot) {
        this.store.importRoom(snapshot);
        this.code = snapshot.code;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.code) {
      this.code = roomCodeFromPath(new URL(request.url).pathname);
      if (!this.code && request.method === 'POST') {
        const body = (await request.clone().json().catch(() => ({}))) as { code?: unknown };
        this.code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      }
    }

    const res = await handleRoomApiRequest(request, this.store);

    if (request.method === 'POST' && this.code) {
      const snapshot = this.store.exportRoom(this.code);
      if (snapshot) {
        await this.state.storage.put(SNAPSHOT_KEY, snapshot);
        await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      } else {
        await this.state.storage.deleteAll();
      }
    }

    return (
      res ||
      new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    );
  }

  async alarm(): Promise<void> {
    if (this.code && this.store.hasListeners(this.code)) {
      await this.state.storage.setAlarm(Date.now() + LISTENER_RECHECK_MS);
      return;
    }
    await this.state.storage.deleteAll();
    this.store = new RoomStore();
  }
}
