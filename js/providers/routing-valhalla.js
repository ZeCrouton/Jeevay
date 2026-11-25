/* Fournisseur de calcul d'itinéraire : Valhalla.
   Interface attendue par le reste de l'app (pour pouvoir changer de moteur) :
     route(from, to, mode, roadId, settings, signal) -> { coords, duration, edges|null }
     matchTrack(coords, mode, signal, wantShape)     -> { edges, coords|null }|null
   edges = [{ len (m), cls, use, surface, unpaved, toll, tunnel }] */
window.T = window.T || {};
T.providers = T.providers || {};

T.providers.routing = (() => {
  const ATTRS = ['edge.length', 'edge.road_class', 'edge.use', 'edge.surface', 'edge.unpaved',
    'edge.toll', 'edge.tunnel', 'edge.roundabout', 'edge.names'];

  async function post(path, body, signal) {
    // Requête courte en GET (?json=), longue en POST text/plain : pas de requête CORS préalable
    const json = JSON.stringify(body), base = T.config.routing.url + path;
    const r = json.length < 6000
      ? await fetch(base + '?json=' + encodeURIComponent(json), { signal })
      : await fetch(base, { method: 'POST', body: json, signal });
    let j = null;
    try { j = await r.json(); } catch (e) { /* réponse non JSON */ }
    if (!r.ok) {
      const code = j && j.error_code;
      if (code === 442 || code === 443) throw new Error('Aucune route trouvée entre ces deux points');
      if (code === 171 || code === 170) throw new Error('Point trop éloigné de toute route');
      if (r.status === 429) throw new Error('Serveur saturé, réessayez dans quelques secondes');
      throw new Error((j && j.error) || `Serveur d’itinéraire indisponible (${r.status})`);
    }
    return j;
  }

  const mapEdges = edges => (edges || []).map(e => ({
    len: (e.length || 0) * 1000, cls: e.road_class, use: e.use, surface: e.surface,
    unpaved: !!e.unpaved, toll: !!e.toll, tunnel: !!e.tunnel, roundabout: !!e.roundabout,
    names: Array.isArray(e.names) ? e.names : []
  }));

  function costingFor(mode, roadId, settings) {
    const m = T.config.modes[mode];
    const road = roadId === 'auto' ? null : m.roads.find(r => r.id === roadId) || m.roads[0];
    const opts = road ? { ...road.opts } : {}; // « proposé » : réglages par défaut du moteur, sans préférence
    if (mode === 'run' && settings.runSpeed) opts.walking_speed = settings.runSpeed;
    if (mode === 'velo' && settings.bikeSpeed) opts.cycling_speed = settings.bikeSpeed;
    return { costing: m.costing, opts };
  }

  async function route(from, to, mode, roadId, settings, signal) {
    const { costing, opts } = costingFor(mode, roadId, settings);
    const j = await post('/route', {
      locations: [{ lon: from[0], lat: from[1] }, { lon: to[0], lat: to[1] }],
      costing, costing_options: { [costing]: opts },
      directions_type: 'none', units: 'kilometers'
    }, signal);
    const leg = j.trip.legs[0];
    const coords = T.util.decode(leg.shape, 6);
    let edges = null;
    try {
      const a = await post('/trace_attributes', {
        encoded_polyline: leg.shape, shape_match: 'edge_walk', costing,
        costing_options: { [costing]: opts },
        filters: { attributes: ATTRS, action: 'include' }
      }, signal);
      edges = mapEdges(a.edges);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
    }
    return { coords, duration: j.trip.summary.time, edges };
  }

  // Analyse d'un tracé importé : on le recale sur la route pour connaître les types de voies.
  // Avec « wantShape », renvoie aussi le tracé recalé (qui suit les routes là où le fichier GPX a trop peu de points).
  // Résultat : { edges, coords|null } ou null. Les tracés longs sont traités par morceaux d'environ 100 km.
  const TRACE_OPTS = { search_radius: 60, gps_accuracy: 15, breakage_distance: 4000, interpolation_distance: 10 };

  function thin(coords, min) {
    const out = [coords[0]];
    for (let i = 1; i < coords.length - 1; i++) if (T.util.dist(out[out.length - 1], coords[i]) >= min) out.push(coords[i]);
    out.push(coords[coords.length - 1]);
    return out;
  }
  function chunks(coords, maxM) {
    const out = [];
    let cur = [coords[0]], acc = 0;
    for (let i = 1; i < coords.length; i++) {
      acc += T.util.dist(coords[i - 1], coords[i]); cur.push(coords[i]);
      if (acc >= maxM && i < coords.length - 1) { out.push(cur); cur = [coords[i]]; acc = 0; }
    }
    if (cur.length > 1) out.push(cur);
    return out;
  }

  async function matchPiece(coords, mode, signal, wantShape) {
    const { total } = T.util.resample(coords, 1e9);
    let pts;
    if (wantShape) {
      // Points d'origine du fichier (ils sont sur la route) ; on n'en garde pas plus de 1800
      pts = thin(coords, 25);
      if (pts.length > 1800) pts = T.util.resample(coords, total / 1800).pts.map(p => p.c);
    } else {
      const step = Math.max(40, total / 1800);
      pts = T.util.resample(coords, step).pts.map(p => p.c);
    }
    const shape = pts.map(c => ({ lat: c[1], lon: c[0] }));
    if (shape.length < 2) return null;
    const costing = T.config.modes[mode].costing;
    const attrs = wantShape ? ATTRS.concat('shape') : ATTRS;
    const call = trace => post('/trace_attributes', { shape, shape_match: 'map_snap', costing, ...(trace ? { trace_options: TRACE_OPTS } : {}),
      filters: { attributes: attrs, action: 'include' } }, signal);
    let a;
    try { a = await call(wantShape); }
    catch (e) {
      if (!wantShape || (e && e.name === 'AbortError')) throw e;
      a = await call(false);   // le serveur refuse les réglages de recalage : on réessaie avec ses réglages par défaut
    }
    let m = null;
    try { if (wantShape && a.shape) m = T.util.decode(a.shape, 6); } catch (e) { m = null; }
    return { edges: mapEdges(a.edges), coords: m && m.length > 1 ? m : null };
  }

  async function matchTrack(coords, mode, signal, wantShape) {
    const total = T.util.cum(coords).slice(-1)[0] || 0, lim = T.config.routing.maxMatchKm * 1000;
    if (coords.length < 2) return null;
    if (total <= lim) return matchPiece(coords, mode, signal, wantShape);
    if (!wantShape) return null;
    const parts = chunks(coords, 100000), edges = [], out = [];
    for (const part of parts) {
      const r = await matchPiece(part, mode, signal, true);
      if (!r) return null;
      edges.push(...r.edges);
      // morceau dont le recalage est douteux : on garde le tracé d'origine pour ce morceau
      const m = r.coords && snapOk(part, r.coords) ? r.coords : part;
      if (out.length && m.length) out.push(...(T.util.same(out[out.length - 1], m[0]) ? m.slice(1) : m)); else out.push(...m);
    }
    return { edges, coords: out, checked: true };
  }

  // Le recalage n'est accepté que s'il reste fidèle au fichier : longueur voisine, points d'origine proches,
  // aucun détour lointain. Sinon on garde le tracé d'origine.
  function snapOk(raw, m) {
    const U = T.util;
    if (!m || m.length < 2 || raw.length < 2) return false;
    const len = c => { const k = U.cum(c); return k[k.length - 1] || 0; };
    const lr = len(raw), lm = len(m);
    if (!(lm >= lr * 0.95 && lm <= lr * 1.3)) return false;
    const sample = (c, n) => c.length <= n ? c : Array.from({ length: n }, (_, k) => c[Math.round(k * (c.length - 1) / (n - 1))]);
    const far = (line, pts, max) => pts.filter(p => U.dist(p, U.nearest(line, p).point) > max).length;
    const sr = sample(raw, 300), sm = sample(m, 300);
    if (far(m, sr, 60) / sr.length > 0.05) return false;   // le fichier d'origine doit rester proche du résultat
    if (far(raw, sm, 300) > 0) return false;                // pas de détour lointain
    return true;
  }

    // Recale un point sur la voie principale la plus proche (dans un rayon donné)
  const RANK = { trunk: 6, primary: 6, secondary: 5, tertiary: 4, unclassified: 2, residential: 1, service_other: 0, motorway: -1 };
  async function snap(c, mode, radius, signal) {
    const costing = T.config.modes[mode].costing;
    const j = await post('/locate', { locations: [{ lat: c[1], lon: c[0], radius }], costing, verbose: true }, signal);
    const edges = (j && j[0] && j[0].edges) || [];
    const cand = edges.map(e => {
      const p = [e.correlated_lon, e.correlated_lat];
      const k = (e.edge && e.edge.classification && e.edge.classification.classification) ||
        (e.edge_info && e.edge_info.classification) || null;
      const use = (e.edge && e.edge.classification && e.edge.classification.use) || (e.edge && e.edge.use) || '';
      return { p, d: T.util.dist(c, p), rank: k in RANK ? RANK[k] : 0, link: /ramp|turn_channel/.test(use) };
    }).filter(x => isFinite(x.p[0]) && isFinite(x.p[1]) && x.d <= radius);
    if (!cand.length) return null;
    const nearest = cand.reduce((a, b) => (b.d < a.d ? b : a));
    // Voie principale la plus proche ; autoroute seulement si c'est la seule voie autour
    const main = cand.filter(x => x.rank > 0 && !x.link).sort((a, b) => b.rank - a.rank || a.d - b.d)[0];
    return (main || nearest).p;
  }

  return { route, matchTrack, snapOk, snap };
})();
