/* Fournisseur de points d'intérêt : Overpass (données OpenStreetMap, gratuit, sans clé).
   Les recherches se font par petites cases fixes (0,15°), gardées en mémoire : rapide, léger pour le serveur,
   et on ne redemande jamais une case déjà chargée.
   Interface : tiles(coords) -> clés des cases traversées ; load(keys, cats, signal, onTile) -> [{ id, cat, name, c, tags }] */
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
  const BY_MODE = {
    moto: { all: ['fuel', 'pass', 'view', 'food'], on: ['fuel', 'pass'] },
    velo: { all: ['water', 'pass', 'view', 'food', 'bike', 'wc'], on: ['water', 'pass', 'bike'] },
    run: { all: ['water', 'wc', 'view', 'pass'], on: ['water', 'wc'] }
  };
  const SIZE = 0.15;

  function label(t, cat) {
    return t.name || t.brand || t.operator || CATS[cat].label.replace(/s$/, '').replace(/s et /, ' / ');
  }

  const key = (x, y) => x + ':' + y;
  // Cases traversées par le parcours (et leurs voisines quand le tracé passe près d'un bord)
  function tiles(coords) {
    const set = new Set(), m = 1300 / 111000;
    T.util.resample(coords, 400).pts.forEach(({ c }) => {
      const mx = m / Math.max(0.2, Math.cos(c[1] * Math.PI / 180));
      for (const dx of [-mx, 0, mx]) for (const dy of [-m, 0, m]) set.add(key(Math.floor((c[0] + dx) / SIZE), Math.floor((c[1] + dy) / SIZE)));
    });
    return [...set];
  }
  function inView(keys, b) { // b = [ouest, sud, est, nord]
    return keys.filter(k => {
      const [x, y] = k.split(':').map(Number);
      return x * SIZE < b[2] && (x + 1) * SIZE > b[0] && y * SIZE < b[3] && (y + 1) * SIZE > b[1];
    });
  }

  const cache = new Map(); // case|catégorie -> éléments
  let preferred = 0;

  async function get(query, signal) {
    let lastErr = null;
    const urls = T.config.poi.urls;
    for (let n = 0; n < urls.length; n++) {
      const i = (n + preferred) % urls.length;
      try {
        const r = await T.util.fetchT(urls[i] + '?data=' + encodeURIComponent(query), { signal }, 10000);
        if (r.ok) { const j = await r.json(); preferred = i; return j; }
        lastErr = new Error(r.status === 429 || r.status === 504 ? 'Serveurs de points d’intérêt saturés, réessayez dans une minute' : 'Points d’intérêt indisponibles (' + r.status + ')');
      } catch (e) {
        if (signal && signal.aborted) throw e;
        lastErr = new Error('Serveurs de points d’intérêt injoignables pour le moment');
      }
    }
    throw lastErr;
  }

  // Charge les catégories demandées dans les cases données ; onTile(fait, total) à chaque case
  async function load(keys, cats, signal, onTile) {
    const todo = keys.map(k => ({ k, miss: cats.filter(c => !cache.has(k + '|' + c)) })).filter(t => t.miss.length);
    let done = 0, failed = 0, lastErr = null, next = 0;
    const work = async t => {
      const [x, y] = t.k.split(':').map(Number);
      const bb = [y * SIZE, x * SIZE, (y + 1) * SIZE, (x + 1) * SIZE].map(v => v.toFixed(3)).join(',');
      const sel = t.miss.flatMap(c => CATS[c].q).map(q => q + ';').join('');
      try {
        const j = await get(`[out:json][timeout:20][bbox:${bb}];(${sel});out center tags 800;`, signal);
        const per = Object.fromEntries(t.miss.map(c => [c, []]));
        for (const el of j.elements || []) {
          const tg = el.tags || {}, cat = t.miss.find(c => CATS[c].test(tg));
          const lat = el.lat ?? (el.center && el.center.lat), lon = el.lon ?? (el.center && el.center.lon);
          if (cat && lat != null) per[cat].push({ id: el.type[0] + el.id, cat, name: label(tg, cat), c: [lon, lat], tags: tg });
        }
        t.miss.forEach(c => cache.set(t.k + '|' + c, per[c]));
      } catch (e) {
        if (signal && signal.aborted) throw e;
        failed++; lastErr = e;
      }
      done++;
      if (onTile) onTile(done, todo.length);
    };
    await Promise.all([0, 1].map(async () => { while (next < todo.length) await work(todo[next++]); }));
    if (todo.length && failed === todo.length) throw lastErr;
    const out = [], seen = new Set();
    keys.forEach(k => cats.forEach(c => (cache.get(k + '|' + c) || []).forEach(it => { if (!seen.has(it.id)) { seen.add(it.id); out.push(it); } })));
    return { items: out, partial: failed > 0, missing: failed };
  }

  const cached = (keys, cats) => keys.every(k => cats.every(c => cache.has(k + '|' + c)));
  // Lieux déjà en mémoire pour ces cases (sans rien télécharger)
  function collect(keys, cats) {
    const out = [], seen = new Set();
    keys.forEach(k => cats.forEach(c => (cache.get(k + '|' + c) || []).forEach(it => { if (!seen.has(it.id)) { seen.add(it.id); out.push(it); } })));
    return out;
  }

  return { CATS, BY_MODE, tiles, inView, load, cached, collect };
})();
