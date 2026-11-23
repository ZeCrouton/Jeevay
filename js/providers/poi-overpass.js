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

  async function along(coords, cats, signal) {
    const { pts, total } = T.util.resample(coords, 1000);
    const step = Math.max(400, total / 220);
    const line = T.util.resample(coords, step).pts.map(p => p.c[1].toFixed(5) + ',' + p.c[0].toFixed(5)).join(',');
    if (!pts.length) return [];
    const parts = [];
    cats.forEach(k => CATS[k].q.forEach(q => parts.push(`${q}(around:${CATS[k].radius},${line});`)));
    const query = `[out:json][timeout:60];(${parts.join('')});out center tags 3000;`;
    let lastErr = null;
    for (const url of T.config.poi.urls) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
        if (r.status === 429 || r.status === 504) { lastErr = new Error('Serveur de points d’intérêt saturé, réessayez dans une minute'); continue; }
        if (!r.ok) { lastErr = new Error('Points d’intérêt indisponibles (' + r.status + ')'); continue; }
        const j = await r.json();
        const out = [];
        for (const e of j.elements || []) {
          const t = e.tags || {};
          const cat = cats.find(k => CATS[k].test(t));
          const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
          if (!cat || lat == null) continue;
          out.push({ id: e.type[0] + e.id, cat, name: label(t, cat), c: [lon, lat], tags: t });
        }
        return out;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e instanceof TypeError ? new Error('Connexion au serveur de points d’intérêt impossible') : e;
      }
    }
    throw lastErr || new Error('Points d’intérêt indisponibles');
  }

  return { CATS, BY_MODE, along };
})();
