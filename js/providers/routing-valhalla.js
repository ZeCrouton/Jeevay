/* Fournisseur de calcul d'itinéraire : Valhalla.
   Interface attendue par le reste de l'app (pour pouvoir changer de moteur) :
     route(from, to, mode, roadId, settings, signal) -> { coords, duration, edges|null }
     matchTrack(coords, mode, signal, wantShape)     -> { edges, coords|null, ok }|null
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
  // Avec « wantShape », renvoie aussi le tracé recalé, qui suit les routes là où le fichier GPX a trop peu
  // de points, et indique s'il est fiable (ok). Résultat : { edges, coords|null, ok } ou null.
  // Les tracés longs sont traités par morceaux d'environ 100 km.
  const TRACE_OPTS = { search_radius: 60, gps_accuracy: 15, breakage_distance: 4000, interpolation_distance: 10 };
  const MATCHED = ['edge.length', 'shape', 'matched.edge_index', 'matched.distance_along_edge', 'matched.type', 'matched.distance_from_trace_point'];

  function thin(coords, min) {
    const out = [coords[0]];
    for (let i = 1; i < coords.length - 1; i++) if (T.util.dist(out[out.length - 1], coords[i]) >= min) out.push(coords[i]);
    out.push(coords[coords.length - 1]);
    return out;
  }
  // Retire les allers-retours parasites du GPS (point qui fait faire demi-tour au tracé puis revenir) :
  // ils produisent des nœuds et de faux virages en épingle
  function despike(c) {
    const U = T.util;
    let pts = c;
    for (let n = 0; n < 8; n++) {
      const out = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const a = out[out.length - 1], p = pts[i], b = pts[i + 1];
        const ap = U.dist(a, p), pb = U.dist(p, b);
        if (ap > 15 && pb > 15 && U.dist(a, b) < Math.max(ap, pb) && Math.abs(U.angleDiff(U.bearing(a, p), U.bearing(p, b))) > 150) continue;
        out.push(p);
      }
      out.push(pts[pts.length - 1]);
      if (out.length === pts.length) break;
      pts = out;
    }
    return pts;
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

  // Fiabilité du recalage, d'après la correspondance donnée par le serveur pour chaque point envoyé :
  // presque tous les points retrouvés près de la route, jamais de retour en arrière, et pas de grand détour
  // entre deux points consécutifs (une route en lacets peut être bien plus longue que la ligne droite,
  // mais pas de plusieurs kilomètres).
  function reliable(pts, a) {
    const U = T.util, E = a.edges || [], mp = a.matched_points || [];
    if (!E.length || mp.length !== pts.length) return false;
    const start = [0];
    E.forEach(e => start.push(start[start.length - 1] + (e.length || 0) * 1000));
    let bad = 0, prev = null;
    for (let i = 0; i < mp.length; i++) {
      const p = mp[i];
      if (p.type !== 'matched' || p.edge_index == null || p.edge_index >= E.length || p.distance_from_trace_point > 60) { bad++; continue; }
      const d = start[p.edge_index] + (p.distance_along_edge || 0) * (E[p.edge_index].length || 0) * 1000;
      if (prev) {
        const dr = U.dist(pts[prev.i], pts[i]), dm = d - prev.d;
        if (dm < -50) return false;
        if (dm > dr + 2500 && dm > dr * 4) return false;
      }
      prev = { i, d };
    }
    return bad / mp.length <= 0.05;
  }

  async function matchPiece(coords, mode, signal, wantShape) {
    const { total } = T.util.resample(coords, 1e9);
    let pts;
    if (wantShape) {
      // Points d'origine du fichier (ils sont sur la route, contrairement à des points interpolés
      // sur une ligne droite), nettoyés, et au plus 1800 en espaçant davantage si besoin
      const c = despike(coords);
      let min = 25;
      pts = thin(c, min);
      while (pts.length > 1800) { min *= 1.4; pts = thin(c, min); }
    } else {
      const step = Math.max(40, total / 1800);
      pts = T.util.resample(coords, step).pts.map(p => p.c);
    }
    const shape = pts.map(c => ({ lat: c[1], lon: c[0] }));
    if (shape.length < 2) return null;
    const costing = T.config.modes[mode].costing;
    const attrs = wantShape ? [...new Set(ATTRS.concat(MATCHED))] : ATTRS;
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
    const ok = !!(m && m.length > 1) && reliable(pts, a);
    return { edges: mapEdges(a.edges), coords: ok ? m : null, ok };
  }

  async function matchTrack(coords, mode, signal, wantShape) {
    const total = T.util.cum(coords).slice(-1)[0] || 0, lim = T.config.routing.maxMatchKm * 1000;
    if (coords.length < 2) return null;
    if (total <= lim) return matchPiece(coords, mode, signal, wantShape);
    if (!wantShape) return null;
    // Long tracé : morceau par morceau ; un morceau mal recalé garde le tracé d'origine
    const parts = chunks(coords, 100000), edges = [], out = [];
    let any = false;
    for (const part of parts) {
      const r = await matchPiece(part, mode, signal, true);
      if (!r) return null;
      edges.push(...r.edges);
      if (r.ok) any = true;
      const m = r.ok ? r.coords : part;
      if (out.length && m.length) out.push(...(T.util.same(out[out.length - 1], m[0]) ? m.slice(1) : m)); else out.push(...m);
    }
    return { edges, coords: any ? out : null, ok: any };
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

  return { route, matchTrack, snap };
})();
