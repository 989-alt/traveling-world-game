import { parseSettings } from '../src/shared/protocol';
import { createRoom } from './create';
export { Room } from './room';

export interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export default {
  // 정적 자산은 [assets] 가 먼저 응답한다. 여기는 /api 만.
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const settings = parseSettings(await req.json().catch(() => null));
      return settings ? createRoom(env.ROOM, settings) : new Response(null, { status: 400 });
    }
    const m = url.pathname.match(/^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})\/ws$/);
    if (m && req.headers.get('Upgrade') === 'websocket') return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
