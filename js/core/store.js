/* État de l'application, historique (annuler / rétablir), réglages et sauvegarde locale. */
window.T = window.T || {};

T.settings = (() => {
  const KEY = T.config.storagePrefix + 'settings';
  const def = { pauses: false, pauseEvery: 2, pauseMin: 15, autoDays: false, dayKm: {}, snapMain: true, lastRoad: {}, runPace: 6, bikeSpeed: 22, autoConnect: true, mapStyle: 'liberty', colorBy: 'road', nums: 'num', fuelRange: 200, poiCats: {} };
  const s = { ...def };
  try { Object.assign(s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* stockage indisponible */ }
  // v1.1 : la préférence par défaut devient « proposé par l'app »
  if (!s.v11) { s.lastRoad = {}; s.v11 = true; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  return {
    get: () => s,
    set(p) { Object.assign(s, p); try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  };
})();

T.storage = (() => {
  const U = T.util, P = T.config.storagePrefix, LIB = P + 'library';

  function serialize(s) {
    return {
      v: 2, name: s.name, mode: s.mode,
      waypoints: s.waypoints.map(w => ({ id: w.id, c: [+w.c[0].toFixed(6), +w.c[1].toFixed(6)], name: w.name || null, locked: !!w.locked, ...(w.gap ? { gap: true } : {}), ...(w.night ? { night: true } : {}), ...(w.dep ? { dep: w.dep } : {}), ...(w.stay ? { stay: w.stay } : {}), ...(w.pause ? { pause: w.pause } : {}) })),
      legs: s.legs.map(L => ({
        id: L.id, from: L.from, to: L.to, kind: L.kind, road: L.road, mode: L.mode, name: L.name || null,
        ok: L.status === 'ok', poly: L.coords ? U.encode(L.coords) : null,
        dist: Math.round(L.distance || 0), dur: Math.round(L.duration || 0),
        sd: L.samples ? L.samples.map(x => Math.round(x.d)) : null,
        se: L.samples ? L.samples.map(x => Math.round(x.e)) : null,
        an: L.an || null, elevErr: !!L.elevErr
      }))
    };
  }

  function deserialize(o) {
    const wps = (o.waypoints || []).map(w => ({ id: w.id, c: w.c, name: w.name || null, locked: !!w.locked, ...(w.gap ? { gap: true } : {}), ...(w.night ? { night: true } : {}), ...(w.dep ? { dep: w.dep } : {}), ...(w.stay ? { stay: w.stay } : {}), ...(w.pause ? { pause: w.pause } : {}) }));
    const byId = Object.fromEntries(wps.map(w => [w.id, w]));
    const legs = (o.legs || []).filter(L => byId[L.from] && byId[L.to]).map(L => {
      const coords = L.poly ? U.decode(L.poly) : null;
      const samples = L.sd ? L.sd.map((d, i) => ({ d, e: L.se[i] })) : null;
      if (samples) T.analysis.addSlopes(samples);
      const ok = L.ok && coords && o.v >= 2; // v2 : nouvelle analyse des voies, recalcul des anciens parcours
      return {
        id: L.id, rev: 1, from: L.from, to: L.to, kind: L.kind, road: L.road, mode: L.mode, name: L.name,
        fromC: byId[L.from].c, toC: byId[L.to].c,
        coords: ok || L.kind === 'track' ? coords : null, distance: L.dist, duration: L.dur,
        samples: ok ? samples : null, an: ok ? L.an : null, elevErr: L.elevErr,
        status: ok ? 'ok' : 'pending'
      };
    });
    return { name: o.name || 'Mon parcours', mode: T.config.modes[o.mode] ? o.mode : 'moto', waypoints: wps, legs };
  }

  // Bibliothèque des parcours : IndexedDB (des centaines de Mo) avec copie en mémoire ; localStorage (≈5 Mo) trop petit.
  // Repli sur localStorage si IndexedDB est indisponible. T.storage.ready : promesse à attendre avant de fusionner/écraser.
  let cache = [], idbOk = false, db = null;
  const lsRead = () => { try { return JSON.parse(localStorage.getItem(LIB) || '[]'); } catch (e) { return []; } };
  const idbReq = (mode, fn) => new Promise((res, rej) => {
    const tx = db.transaction('lib', mode), r = fn(tx.objectStore('lib'));
    tx.oncomplete = () => res(r.result); tx.onerror = tx.onabort = () => rej(tx.error || new Error('IndexedDB'));
  });
  const ready = new Promise(res => {
    try {
      const o = indexedDB.open(P + 'db', 1);
      o.onupgradeneeded = () => o.result.createObjectStore('lib');
      o.onerror = o.onblocked = () => { cache = lsRead(); res(); };
      o.onsuccess = async () => {
        db = o.result;
        try {
          const saved = await idbReq('readonly', s => s.get('all'));
          if (Array.isArray(saved)) cache = saved;
          else { cache = lsRead(); if (cache.length) await idbReq('readwrite', s => s.put(cache, 'all')); }
          idbOk = true;
          if (cache.length) { try { localStorage.removeItem(LIB); } catch (e) { /* ignore */ } }   // libère les 5 Mo
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        } catch (e) { cache = lsRead(); }
        res();
      };
    } catch (e) { cache = lsRead(); res(); }
  });
  const read = () => cache;
  const pruneTomb = d => Object.fromEntries(Object.entries(d).sort((x, y) => y[1] - x[1]).slice(0, 500));
  const write = all => {
    cache = all;
    if (!idbOk) { localStorage.setItem(LIB, JSON.stringify(all)); return; }
    idbReq('readwrite', s => s.put(all, 'all')).catch(() => T.ui && T.ui.toast('Stockage du navigateur plein : supprimez d’anciens parcours', 'error', 6000));
  };

  return {
    serialize, deserialize, ready, pruneTomb,
    library: {
      all: read, replaceAll: write,
      list: () => read().map(({ data, ...meta }) => meta),
      get: id => { const e = read().find(x => x.id === id); return e ? deserialize(e.data) : null; },
      save(s, distance) {
        const all = read();
        const entry = { id: U.uid(), name: s.name || 'Sans nom', mode: s.mode, km: distance / 1000, date: Date.now(), data: serialize(s) };
        const i = all.findIndex(x => x.name === entry.name);
        if (i >= 0) { entry.id = all[i].id; all.splice(i, 1); }
        if (T.settings.get().deleted && T.settings.get().deleted[entry.id]) entry.id = U.uid();   // id déjà supprimé : nouvel id
        all.unshift(entry);
        write(all);
      },
      // Suppression : l'id est mémorisé (« pierre tombale ») pour ne pas revenir par la synchronisation
      remove(id) {
        const d = { ...(T.settings.get().deleted || {}), [id]: Date.now() };
        T.settings.set({ deleted: pruneTomb(d) });
        write(read().filter(x => x.id !== id));
      }
    }
  };
})();

T.store = (() => {
  const KEY = T.config.storagePrefix + 'current';
  const listeners = new Set(), past = [], future = [];
  const blank = () => ({ name: 'Mon parcours', mode: 'moto', waypoints: [], legs: [] });
  const s = blank();

  const snap = () => ({ name: s.name, mode: s.mode, waypoints: s.waypoints.map(w => ({ ...w })), legs: s.legs.slice() });
  const restore = x => { s.name = x.name; s.mode = x.mode; s.waypoints = x.waypoints.map(({ snapping, ...w }) => w); s.legs = x.legs; };

  let saveT;
  function changed() {
    listeners.forEach(f => f(s));
    clearTimeout(saveT);
    saveT = setTimeout(save, 700);
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(T.storage.serialize(s))); } catch (e) { console.warn('Sauvegarde locale impossible', e); }
  }

  let locked = false;
  // Verrou : aucune modification du tracé (sauf force, pour le chargement volontaire d'un parcours partagé)
  function commit(fn, force) {
    if (locked && !force) return false;
    past.push(snap());
    if (past.length > 40) past.shift();
    future.length = 0;
    fn(s);
    T.engine.reconcile(s);
    changed();
    return true;
  }
  function silent(fn) { fn(s); changed(); }
  // Modification sans entrée d'historique, mais avec mise à jour des tronçons (ex. recalage d'un point)
  function amend(fn) { fn(s); T.engine.reconcile(s); changed(); }
  function undo() {
    if (locked || !past.length) return false;
    future.push(snap()); restore(past.pop()); T.engine.reconcile(s); changed(); return true;
  }
  function redo() {
    if (locked || !future.length) return false;
    past.push(snap()); restore(future.pop()); T.engine.reconcile(s); changed(); return true;
  }
  function replace(data) { commit(st => restore(data), true); }
  function setLocked(v) { locked = !!v; changed(); }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) restore(T.storage.deserialize(JSON.parse(raw)));
    } catch (e) { console.warn('Parcours précédent illisible', e); }
    T.engine.reconcile(s);
    changed();
  }

  return {
    get state() { return s; }, get locked() { return locked; }, setLocked, blank, commit, silent, amend, undo, redo, replace, load,
    canUndo: () => past.length > 0, canRedo: () => future.length > 0,
    on: f => listeners.add(f)
  };
})();
