// Jeevay — synchronisation par code. Cloudflare Worker + KV (offre gratuite).
// Le serveur ne voit jamais le code : le navigateur envoie seulement son empreinte SHA-256.
const H = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...H, 'content-type': 'application/json' } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: H });
    const m = new URL(req.url).pathname.match(/^\/s\/([a-f0-9]{64})$/);
    if (!m) return json({ error: 'not found' }, 404);
    const key = 's:' + m[1];
    if (req.method === 'GET') return new Response((await env.KV.get(key)) || '{"lib":[]}', { headers: { ...H, 'content-type': 'application/json' } });
    if (req.method === 'PUT') {
      const body = await req.text();
      if (body.length > 2e6) return json({ error: 'trop volumineux' }, 413);
      try { if (!Array.isArray(JSON.parse(body).lib)) throw 0; } catch (e) { return json({ error: 'format invalide' }, 400); }
      await env.KV.put(key, body, { expirationTtl: 60 * 60 * 24 * 400 });
      return json({ ok: true });
    }
    return json({ error: 'méthode non permise' }, 405);
  }
};
