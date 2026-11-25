/* Moteur : garde les tronçons cohérents avec les points et les calcule en arrière-plan. */
window.T = window.T || {};

T.engine = (() => {
  const U = T.util;
  const inflight = new Map(); // id du tronçon -> { rev, ctrl }

  function defaultRoad(mode) {
    const m = T.config.modes[mode], last = T.settings.get().lastRoad[mode];
    return last === 'auto' || m.roads.some(r => r.id === last) ? last : m.defaultRoad;
  }

  function makeLeg(a, b, s, road, extra = {}) {
    const isLine = road === 'line';
    return { id: U.uid(), rev: 1, from: a.id, to: b.id, fromC: a.c, toC: b.c,
      kind: isLine ? 'line' : 'route', road: isLine ? null : (road || defaultRoad(s.mode)),
      mode: s.mode, status: 'pending', coords: null, ...extra };
  }

  function invalidate(L, patch = {}) {
    const n = { ...L, ...patch, rev: (L.rev || 0) + 1, status: 'pending', samples: null, an: null, error: null, elevErr: false };
    if (n.kind !== 'track') n.coords = null;
    return n;
  }

  function reconcile(s) {
    const wp = s.waypoints, out = [];
    for (let i = 0; i < wp.length - 1; i++) {
      const a = wp[i], b = wp[i + 1];
      let L = s.legs.find(l => l.from === a.id && l.to === b.id);
      if (!L) L = makeLeg(a, b, s, s._nextRoad);
      else if (L.kind === 'track') {
        if (L.mode !== s.mode) L = invalidate(L, { mode: s.mode });
      } else if (!U.same(L.fromC, a.c) || !U.same(L.toC, b.c) || (L.kind === 'route' && L.mode !== s.mode)) {
        L = invalidate(L, { fromC: a.c, toC: b.c, mode: s.mode });
      }
      out.push(L);
    }
    s.legs = out;
    delete s._nextRoad;
    for (const [id, f] of inflight) {
      const L = out.find(l => l.id === id);
      if (!L || L.rev !== f.rev) { f.ctrl.abort(); inflight.delete(id); }
    }
    schedule();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; pump(); });
  }

  function pump() {
    const { legs, waypoints } = T.store.state;
    const snapping = new Set(waypoints.filter(w => w.snapping).map(w => w.id));
    for (const L of legs) {
      if (inflight.size >= T.config.routing.concurrency) break;
      if (snapping.has(L.from) || snapping.has(L.to)) continue;
      if (L.status === 'pending' && !inflight.has(L.id)) run(L);
    }
  }

  async function samplesFor(coords, distance, signal) {
    const step = Math.max(60, distance / 700);
    const { pts } = U.resample(coords, step);
    const el = await T.providers.elevation.get(pts.map(p => p.c), signal);
    return pts.map((p, i) => ({ d: p.d, e: el[i] }));
  }

  async function run(L) {
    const ctrl = new AbortController();
    inflight.set(L.id, { rev: L.rev, ctrl });
    try {
      const st = T.settings.get();
      let coords, duration = 0, edges = null;
      if (L.kind === 'route') {
        const r = await T.providers.routing.route(L.fromC, L.toC, L.mode, L.road,
          { runSpeed: 60 / st.runPace, bikeSpeed: st.bikeSpeed }, ctrl.signal);
        coords = r.coords; duration = r.duration; edges = r.edges;
      } else if (L.kind === 'line') {
        coords = [L.fromC, L.toC];
      } else {
        coords = L.coords;
        try {
          const m = await T.providers.routing.matchTrack(coords, L.mode, ctrl.signal, !!L.snap);
          if (m) {
            edges = m.edges;
            // Recalage sur les routes : accepté seulement s'il reste fidèle au fichier (sinon tracé d'origine)
            if (L.snap && m.coords && (m.checked || T.providers.routing.snapOk(coords, m.coords))) {
              const s = m.coords.slice();
              s[0] = coords[0]; s[s.length - 1] = coords[coords.length - 1];
              coords = s;
            }
          }
        } catch (e) { if (e.name === 'AbortError') throw e; }
      }
      const c = U.cum(coords), distance = c[c.length - 1] || 0;
      let samples = null, elevErr = false;
      try { samples = await samplesFor(coords, distance, ctrl.signal); }
      catch (e) { if (e.name === 'AbortError') throw e; elevErr = true; }
      const an = T.analysis.leg(coords, samples, edges, distance);
      apply(L, { status: 'ok', coords, distance, duration, samples, an, elevErr, snap: false });
    } catch (e) {
      if (e.name === 'AbortError') return;
      const msg = e instanceof TypeError ? 'connexion au serveur impossible' : (e.message || 'erreur inconnue');
      apply(L, { status: 'error', error: msg });
    } finally {
      const f = inflight.get(L.id);
      if (f && f.rev === L.rev) inflight.delete(L.id);
      schedule();
    }
  }

  function apply(L, patch) {
    const legs = T.store.state.legs;
    const i = legs.findIndex(x => x.id === L.id && x.rev === L.rev);
    if (i < 0) return;
    T.store.silent(st => { st.legs = st.legs.slice(); st.legs[i] = { ...st.legs[i], ...patch }; });
  }

  function retry(id) {
    const legs = T.store.state.legs, i = legs.findIndex(l => l.id === id);
    if (i < 0) return;
    T.store.silent(st => { st.legs = st.legs.slice(); st.legs[i] = invalidate(st.legs[i]); });
    schedule();
  }

  const busy = () => inflight.size > 0;

  return { reconcile, makeLeg, invalidate, defaultRoad, retry, busy, schedule };
})();
