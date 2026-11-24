/* Jeevay — synchronisation des parcours enregistrés entre appareils grâce à un code personnel. */
T.sync = (() => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const cfg = () => T.config.sync;
  const norm = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const valid = c => c.length === 12 && [...c].every(ch => A.includes(ch));
  const fmt = c => c.replace(/(.{4})(?=.)/g, '$1-');
  const code = () => T.settings.get().syncCode || '';

  function create() {
    const r = crypto.getRandomValues(new Uint8Array(12));
    return fmt([...r].map(x => A[x % 32]).join(''));
  }
  async function hash(c) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('jeevay:' + norm(c)));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function call(method, c, body) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(cfg().url + '/s/' + await hash(c), { method, body, signal: ctl.signal, headers: body ? { 'content-type': 'application/json' } : {} });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  // Fusion par nom de parcours : le plus récent l'emporte. Les suppressions ne sont pas propagées.
  function merge(a, b) {
    const m = new Map();
    [...a, ...b].forEach(e => { const o = m.get(e.name); if (!o || (e.date || 0) > (o.date || 0)) m.set(e.name, e); });
    return [...m.values()].sort((x, y) => (y.date || 0) - (x.date || 0));
  }
  async function run(c = code()) {
    await T.storage.ready;
    const local = T.storage.library.all();
    const remote = (await call('GET', c)).lib || [];
    const merged = merge(local, remote);
    T.storage.library.replaceAll(merged);
    await call('PUT', c, JSON.stringify({ lib: merged }));
    T.settings.set({ syncAt: Date.now() });
    return { total: merged.length, added: merged.length - local.length };
  }
  const auto = () => { if (code()) run().catch(() => { /* hors ligne : réessai à la prochaine sauvegarde */ }); };
  return { norm, valid, fmt, code, create, run, auto };
})();
