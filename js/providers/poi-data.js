/* Fournisseur de points d'intérêt : base de lieux OpenStreetMap préparée chaque mois par GitHub Actions
   (.github/workflows/poi.yml) et publiée sur la branche « poi-data » du dépôt : un petit fichier par case de 0,25°.
   Aucun serveur à interroger : on télécharge seulement les cases traversées par le parcours, gardées en mémoire.
   Interface : key(coords) -> clé du tracé ; load(coords, key, cats, signal) ; cached(key, cats) ; collect(key, cats) */
window.T = window.T || {};
T.providers = T.providers || {};

T.providers.poi = (() => {
  const CATS = {
    fuel: { label: 'Stations-service', color: '#e8590c', radius: 1200 },
    pass: { label: 'Cols', color: '#5f3dc4', radius: 300 },
    view: { label: 'Panoramas', color: '#2b8a3e', radius: 350 },
    water: { label: 'Points d’eau', color: '#1c7ed6', radius: 300 },
    food: { label: 'Cafés et restos', color: '#c2255c', radius: 150 },
    bike: { label: 'Réparation vélo', color: '#0b7285', radius: 600 },
    wc: { label: 'Toilettes', color: '#868e96', radius: 200 },
    sleep: { label: 'Hébergements', color: '#2f3a8f', radius: 400, nightRadius: 8000 }
  };
  const SLEEP_TYPES = { hotel: 'Hôtel', motel: 'Motel', guest_house: 'Chambre d’hôtes', hostel: 'Auberge', chalet: 'Gîte / chalet', apartment: 'Location', camp_site: 'Camping', alpine_hut: 'Refuge' };
  const BY_MODE = {
    moto: { all: ['fuel', 'pass', 'view', 'food', 'sleep'], on: ['fuel', 'pass', 'sleep'] },
    velo: { all: ['water', 'pass', 'view', 'food', 'bike', 'wc', 'sleep'], on: ['water', 'pass', 'bike', 'sleep'] },
    run: { all: ['water', 'wc', 'view', 'pass', 'sleep'], on: ['water', 'wc'] }
  };
  const TAGS = { fuel: { amenity: 'fuel' }, water: { amenity: 'drinking_water' }, wc: { amenity: 'toilets' }, food: { amenity: 'restaurant' }, bike: { shop: 'bicycle' }, pass: { mountain_pass: 'yes' }, view: { tourism: 'viewpoint' }, sleep: { tourism: 'hotel' } };
  const SIZE = 0.25, MARGIN = 1300; // marge autour du tracé (m), au moins le plus grand rayon de recherche

  const routes = new Map(); // clé du tracé -> cases traversées
  const tiles = new Map();  // case -> lieux
  let index = null, indexP = null;

  // Cases traversées par le parcours (et voisines quand il passe près d'un bord), plus les alentours des nuits
  function key(coords, around = []) {
    const set = new Set();
    const addBox = (c, metres) => {
      const m = metres / 111000, mx = m / Math.max(0.2, Math.cos(c[1] * Math.PI / 180));
      for (const dx of [-mx, 0, mx]) for (const dy of [-m, 0, m]) set.add(Math.floor((c[0] + dx) / SIZE) + '_' + Math.floor((c[1] + dy) / SIZE));
    };
    T.util.resample(coords, 400).pts.forEach(({ c }) => addBox(c, MARGIN));
    around.forEach(c => addBox(c, CATS.sleep.nightRadius + 500));
    const list = [...set].sort(), k = list.join(',');
    routes.set(k, list);
    return k;
  }

  // Téléchargement d'un fichier : adresse principale, puis le miroir (CDN) si elle échoue
  async function getJSON(path, signal) {
    let err = null;
    for (const base of T.config.poi.bases) {
      try {
        const r = await T.util.fetchT(base + path, { signal }, 15000);
        if (r.status === 404) { if (!err) err = Object.assign(new Error('absent'), { missing: true }); continue; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) { if (signal && signal.aborted) throw e; err = e; }
    }
    throw err;
  }

  const NOT_READY = 'Base de lieux en cours de préparation, revenez dans quelques minutes.';
  function loadIndex(signal) {
    if (index) return Promise.resolve(index);
    if (!indexP) {
      indexP = getJSON('index.json', signal).then(j => { index = { ...j, set: new Set(j.tiles) }; return index; })
        .catch(e => { indexP = null; throw e.missing ? Object.assign(new Error(NOT_READY), { detail: NOT_READY }) : e; });
    }
    return indexP;
  }

  function parse(j) {
    return (j.p || []).map(([cat, lon, lat, name, ex, id]) => ({
      id, cat, c: [lon, lat], name: name || (cat === 'sleep' && ex && SLEEP_TYPES[ex.tourism]) || CATS[cat].label.replace(/s$/, '').replace(/s et /, ' / '),
      tags: { ...TAGS[cat], ...(ex || {}) }
    }));
  }

  async function load(coords, k, cats, signal) {
    const idx = await loadIndex(signal);
    const todo = (routes.get(k) || []).filter(t => idx.set.has(t) && !tiles.has(t));
    let next = 0, failed = 0, lastErr = null;
    const worker = async () => {
      while (next < todo.length) {
        const t = todo[next++];
        try { tiles.set(t, parse(await getJSON(t + '.json', signal))); }
        catch (e) { if (signal && signal.aborted) throw e; failed++; lastErr = e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
    if (failed) throw Object.assign(new Error('incomplet'), { detail: `${failed} zone(s) non chargée(s) (${lastErr && lastErr.message})` });
    return collect(k, cats);
  }

  const cached = (k, cats) => !!index && (routes.get(k) || []).every(t => !index.set.has(t) || tiles.has(t));
  function collect(k, cats) {
    const on = new Set(cats), out = [];
    (routes.get(k) || []).forEach(t => (tiles.get(t) || []).forEach(it => { if (on.has(it.cat)) out.push(it); }));
    return out;
  }
  // Le parcours passe-t-il dans la zone couverte (France) ?
  const covered = k => !index || (routes.get(k) || []).some(t => index.set.has(t));

  return { CATS, BY_MODE, SLEEP_TYPES, key, load, cached, collect, covered };
})();
