/* Fournisseur de points d'intérêt : Overpass (données OpenStreetMap, gratuit, sans clé).
   Interface : along(coords, cats, signal) -> [{ id, cat, name, c:[lng,lat], tags }] */
window.T = window.T || {};
T.providers = T.providers || {};

T.providers.poi = (() => {
  const CATS = {
    fuel: { label: 'Stations-service', color: '#e8590c', radius: 1200, q: ['nwr["amenity"="fuel"]'], test: t => t.amenity === 'fuel' },
    pass: { label: 'Cols', color: '#5f3dc4', radius: 300, q: ['node["mountain_pass"="yes"]["name"]'], test: t => t.mountain_pass === 'yes' },
    view: { label: 'Panoramas', color: '#2b8a3e', radius: 350, q: ['node["tourism"="viewpoint"]'], test: t => t.tourism === 'viewpoint' },
    water: { label: 'Points d’eau', color: '#1c7ed6', radius: 300, q: ['nwr["amenity"="drinking_water"]'], test: t => t.amenity === 'drinking_water' },
    food: { label: 'Cafés et restos', color: '#c2255c', radius: 150, q: ['nwr["amenity"~"^(cafe|restaurant)$"]["name"]'], test: t => t.amenity === 'cafe' || t.amenity === 'restaurant' },
    bike: { label: 'Réparation vélo', color: '#0b7285', radius: 600, q: ['nwr["shop"="bicycle"]', 'nwr["amenity"="bicycle_repair_station"]'], test: t => t.shop === 'bicycle' || t.amenity === 'bicycle_repair_station' },
    wc: { label: 'Toilettes', color: '#868e96', radius: 200, q: ['nwr["amenity"="toilets"]'], test: t => t.amenity === 'toilets' }
  };
  // Catégories proposées par activité (les premières sont cochées par défaut)
  const BY_MODE = {
    moto: { all: ['fuel', 'pass', 'view', 'food'], on: ['fuel', 'pass'] },
    velo: { all: ['water', 'pass', 'view', 'food', 'bike', 'wc'], on: ['water', 'pass', 'bike'] },
    run: { all: ['water', 'wc', 'view', 'pass'], on: ['water', 'wc'] }
  };

  function label(t, cat) {
    return t.name || t.brand || t.operator || CATS[cat].label.replace(/s$/, '').replace(/s et /, ' / ');
  }

  // Requête courte en GET par portion de ~25 km (zone rectangulaire), puis filtrage précis côté appareil.
  // Plus fiable que de longues requêtes POST : moins de charge pour le serveur, pas de délai dépassé.
  function chunks(coords) {
    const c = T.util.cum(coords), total = c[c.length - 1] || 0, size = 35000, out = [];
    for (let a = 0; a < total || !out.length; a += size) {
      const pts = coords.filter((_, i) => c[i] >= a - 200 && c[i] <= a + size + 200);
      if (pts.length) out.push(pts);
      if (!total) break;
    }
    return out;
  }

  const cache = new Map();
  let preferred = 0; // dernier serveur qui a répondu : essayé en premier ensuite

  async function get(query, signal) {
    if (cache.has(query)) return cache.get(query);
    let lastErr = null;
    const urls = T.config.poi.urls, order = urls.map((_, i) => (i + preferred) % urls.length);
    for (const i of order) {
      const url = urls[i];
      try {
        const r = await T.util.fetchT(url + '?data=' + encodeURIComponent(query), { signal }, 12000);
        if (r.ok) { const j = await r.json(); preferred = i; cache.set(query, j); return j; }
        lastErr = new Error(r.status === 429 || r.status === 504 ? 'Serveurs de points d’intérêt saturés, réessayez dans une minute' : 'Points d’intérêt indisponibles (' + r.status + ')');
      } catch (e) {
        if (signal && signal.aborted) throw e;
        lastErr = new Error('Serveurs de points d’intérêt injoignables pour le moment, réessayez dans une minute');
      }
    }
    throw lastErr;
  }

  async function along(coords, cats, signal, onProgress) {
    const parts = chunks(coords);
    const maxR = Math.max(...cats.map(k => CATS[k].radius));
    const sel = cats.flatMap(k => CATS[k].q).map(q => q + ';').join('');
    const out = [], seen = new Set();
    let done = 0, failed = 0, lastErr = null;
    const work = async pts => {
      let s = 90, w = 180, n = -90, e = -180;
      pts.forEach(p => { s = Math.min(s, p[1]); n = Math.max(n, p[1]); w = Math.min(w, p[0]); e = Math.max(e, p[0]); });
      const dy = maxR / 111000, dx = dy / Math.max(0.2, Math.cos((s + n) / 2 * Math.PI / 180));
      const bb = [s - dy, w - dx, n + dy, e + dx].map(v => v.toFixed(3)).join(',');
      try {
        const j = await get(`[out:json][timeout:25][bbox:${bb}];(${sel});out center tags 1500;`, signal);
        for (const el of j.elements || []) {
          const t = el.tags || {}, id = el.type[0] + el.id;
          const cat = cats.find(k => CATS[k].test(t));
          const lat = el.lat ?? (el.center && el.center.lat), lon = el.lon ?? (el.center && el.center.lon);
          if (!cat || lat == null || seen.has(id)) continue;
          seen.add(id);
          out.push({ id, cat, name: label(t, cat), c: [lon, lat], tags: t });
        }
      } catch (e) {
        if (signal && signal.aborted) throw e;
        failed++; lastErr = e;
      }
      done++;
      if (onProgress) onProgress(done, parts.length, out.slice());
    };
    // Deux requêtes à la fois au maximum (règle d'usage d'Overpass)
    let next = 0;
    await Promise.all([0, 1].map(async () => { while (next < parts.length) await work(parts[next++]); }));
    if (failed === parts.length) throw lastErr;
    return { items: out, partial: failed > 0 };
  }

  return { CATS, BY_MODE, along };
})();
