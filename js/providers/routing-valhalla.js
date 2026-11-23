/* Fournisseur de calcul d'itinéraire : Valhalla.
   Interface attendue par le reste de l'app (pour pouvoir changer de moteur) :
     route(from, to, mode, roadId, settings, signal) -> { coords, duration, edges|null }
     matchTrack(coords, mode, signal)                -> edges|null
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
    const road = m.roads.find(r => r.id === roadId) || m.roads[0];
    const opts = { ...road.opts };
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

  // Analyse d'un tracé importé : on le recale sur la route pour connaître les types de voies
  async function matchTrack(coords, mode, signal) {
    const { pts, total } = T.util.resample(coords, 40);
    if (total > T.config.routing.maxMatchKm * 1000) return null;
    const step = Math.max(40, total / 1800);
    const shape = T.util.resample(coords, step).pts.map(p => ({ lat: p.c[1], lon: p.c[0] }));
    if (shape.length < 2 || !pts.length) return null;
    const costing = T.config.modes[mode].costing;
    const a = await post('/trace_attributes', {
      shape, shape_match: 'map_snap', costing,
      filters: { attributes: ATTRS, action: 'include' }
    }, signal);
    return mapEdges(a.edges);
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
