// YAHYIAM photo upload service (Cloudflare Worker) — saves supplier photos into R2.
// Only signed-in YAHYIAM users can upload, and only into their own folder (<user id>/...).
// Photos are then served free of bandwidth charges from https://nhyiamu-img.mcadesk.org/<key>
const ORIGINS = ['https://yahyiam.mcadesk.org', 'https://nhyiamu.mcadesk.org', 'https://nhyiamu.pages.dev', 'https://mcadesk.github.io'];
const MAX_BYTES = 3 * 1024 * 1024;

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) || o.endsWith('.nhyiamu.pages.dev') ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const reply = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });

async function userId(req, env) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: env.SUPABASE_KEY } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id || null;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);
    if (url.pathname !== '/upload') return reply(req, 404, { error: 'Not found' });
    const key = url.searchParams.get('key') || '';
    if (!/^[0-9a-f-]{36}\/[A-Za-z0-9_\-/]+\.jpg$/.test(key) || key.includes('..') || key.includes('//')) return reply(req, 400, { error: 'Bad photo name' });
    const uid = await userId(req, env);
    if (!uid) return reply(req, 401, { error: 'Please sign in again' });
    if (!key.startsWith(uid + '/')) return reply(req, 403, { error: 'You can only change your own photos' });

    if (req.method === 'DELETE') {
      await env.PHOTOS.delete(key);
      return reply(req, 200, { ok: true });
    }
    if (req.method !== 'POST') return reply(req, 405, { error: 'Not allowed' });
    const body = await req.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_BYTES) return reply(req, 413, { error: 'Photo is too large' });
    const b = new Uint8Array(body, 0, 3);
    if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return reply(req, 415, { error: 'Only JPEG photos' });
    await env.PHOTOS.put(key, body, { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' } });
    return reply(req, 200, { path: 'r2/' + key });
  }
};
