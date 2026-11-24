/* Fournisseur de points d'intérêt : Overpass (données OpenStreetMap, gratuit, sans clé).
   Une seule requête « couloir » le long du tracé simplifié (filtre around sur une ligne) :
   le serveur ne cherche que près du parcours, quelle que soit sa longueur.
   Plusieurs serveurs en relais (le suivant démarre si le premier tarde), résultats gardés en mémoire
   et dans le navigateur.
   Interface : key(coords) -> clé du tracé ; load(coords, key, cats, signal) -> { items } ; collect(key, cats) ; cached(key, cats) */
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
  const MAX_PTS = 180, LS = 'trajecto.poi.v2', LS_MAX = 12;

  const label = (t, cat) => t.name || t.brand || t.operator || CATS[cat].label.replace(/s$/, '').replace(/s et /, ' / ');

  // Ligne simplifiée (au plus MAX_PTS points) et tolérance utilisée
  // (on resimplifie le résultat précédent : l'écart au tracé reste inférieur à la somme des tolérances)
  let memo = { c: null, v: null };
  function line(coords) {
    if (memo.c === coords) return memo.v;
    let t = 40, sum = 40, pts = T.util.simplify(coords, t);
    while (pts.length > MAX_PTS) { t *= 1.6; sum += t; pts = T.util.simplify(pts, t); }
    memo = { c: coords, v: { pts, tol: sum } };
    return memo.v;
  }
  function key(coords) {
    const s = line(coords).pts.map(c => c[1].toFixed(4) + ',' + c[0].toFixed(4)).join(';');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + coords.length;
  }

  // Mémoire : clé du tracé|catégorie -> éléments (copie des derniers parcours dans le navigateur)
  const cache = new Map();
  try { (JSON.parse(localStorage.getItem(LS)) || []).forEach(([k, v]) => cache.set(k, v)); } catch (e) { /* stockage indisponible */ }
  function persist() {
    try { localStorage.setItem(LS, JSON.stringify([...cache].slice(-LS_MAX * 4))); } catch (e) { /* plein ou indisponible */ }
  }

  let preferred = 0;
  // Relais : le serveur préféré d'abord, le suivant s'il ne répond pas vite ; la première réponse valable gagne
  function query(body, signal) {
    const urls = T.config.poi.urls, delays = [0, 2500, 6000];
    return new Promise((resolve, reject) => {
      const ctrls = [], timers = [];
      let left = urls.length, done = false, lastErr = null;
      const stop = () => { done = true; timers.forEach(clearTimeout); ctrls.forEach(c => c.abort()); };
      if (signal) signal.addEventListener('abort', () => { stop(); reject(Object.assign(new Error('annulé'), { name: 'AbortError' })); }, { once: true });
      const fail = e => { lastErr = e; if (--left === 0 && !done) { done = true; reject(lastErr); } };
      urls.forEach((_, n) => {
        const i = (n + preferred) % urls.length;
        timers.push(setTimeout(async () => {
          if (done) { left--; return; }
          const c = new AbortController(); ctrls.push(c);
          try {
            const r = await T.util.fetchT(urls[i], { method: 'POST', body: 'data=' + encodeURIComponent(body),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: c.signal }, 30000);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j = await r.json();
            if (done) return;
            if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark) && !(j.elements || []).length) throw new Error(j.remark);
            preferred = i; stop(); resolve(j);
          } catch (e) { if (!done) fail(e); }
        }, delays[n] ?? n * 5000));
      });
    });
  }

  async function load(coords, k, cats, signal) {
    const miss = cats.filter(c => !cache.has(k + '|' + c));
    if (miss.length) {
      const { pts, tol } = line(coords);
      const poly = pts.map(c => c[1].toFixed(5) + ',' + c[0].toFixed(5)).join(',');
      const sel = miss.flatMap(c => CATS[c].q.map(q => `${q}(around:${Math.round(CATS[c].radius + tol)},${poly});`)).join('');
      const j = await query(`[out:json][timeout:25];(${sel});out center tags 3000;`, signal);
      const per = Object.fromEntries(miss.map(c => [c, []]));
      for (const el of j.elements || []) {
        const tg = el.tags || {}, cat = miss.find(c => CATS[c].test(tg));
        const lat = el.lat ?? (el.center && el.center.lat), lon = el.lon ?? (el.center && el.center.lon);
        if (cat && lat != null) per[cat].push({ id: el.type[0] + el.id, cat, name: label(tg, cat), c: [lon, lat], tags: tg });
      }
      miss.forEach(c => { cache.delete(k + '|' + c); cache.set(k + '|' + c, per[c]); });
      persist();
    }
    return collect(k, cats);
  }

  const cached = (k, cats) => cats.every(c => cache.has(k + '|' + c));
  function collect(k, cats) {
    const out = [], seen = new Set();
    cats.forEach(c => (cache.get(k + '|' + c) || []).forEach(it => { if (!seen.has(it.id)) { seen.add(it.id); out.push(it); } }));
    return out;
  }

  return { CATS, BY_MODE, key, load, cached, collect };
})();
