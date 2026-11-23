/* V2 — Points d'intérêt le long du parcours + alerte d'autonomie carburant (moto).
   Chargement automatique de la zone affichée (rapide), ou de tout le parcours à la demande. */
(() => {
  const U = T.util, I = T.icons, P = T.providers.poi;
  // items : lieux projetés sur le parcours en cours ; route : cases traversées
  let data = { sig: null, mode: null, route: [], items: [], loading: false, progress: '', error: null, zoomHint: false };
  let ctrl = null, showAll = false, projCache = { key: '', items: [] };

  const sigOf = s => s.legs.map(l => l.id + ':' + l.rev + ':' + l.status).join('|');
  const catsFor = mode => T.settings.get().poiCats[mode] || P.BY_MODE[mode].on;

  function project(raw, comb) {
    const { pts } = U.resample(comb.coords, Math.max(80, comb.total / 6000));
    const kx = Math.cos(comb.coords[0][1] * Math.PI / 180), items = [];
    for (const it of raw) {
      let best = Infinity, bd = 0;
      for (const p of pts) {
        const dx = (p.c[0] - it.c[0]) * kx, dy = p.c[1] - it.c[1], dd = dx * dx + dy * dy;
        if (dd < best) { best = dd; bd = p.d; }
      }
      const off = Math.sqrt(best) * 111320;
      if (off <= P.CATS[it.cat].radius) items.push({ ...it, d: bd, off });
    }
    return items.sort((x, y) => x.d - y.d);
  }

  // Met à jour la liste à partir de ce qui est déjà en mémoire
  function refresh(s, comb) {
    const sig = sigOf(s);
    if (data.sig !== sig || data.mode !== s.mode) {
      data = { ...data, sig, mode: s.mode, route: comb.coords.length > 1 ? P.tiles(comb.coords) : [], error: null };
      showAll = false;
    }
    const cats = P.BY_MODE[s.mode].all, raw = P.collect(data.route, cats);
    const k = sig + '#' + raw.length;
    if (projCache.key !== k) projCache = { key: k, items: comb.coords.length > 1 ? project(raw, comb) : [] };
    data.items = projCache.items;
  }

  async function fetchTiles(keys, cats, label) {
    if (!keys.length || P.cached(keys, cats)) { T.app.render(); return; }
    if (ctrl) ctrl.abort();
    const my = ctrl = new AbortController();
    data = { ...data, loading: true, progress: '', error: null, label };
    T.app.render();
    try {
      const r = await P.load(keys, cats, my.signal, (d, n) => { if (my === ctrl) { data.progress = n > 1 ? `${d}/${n}` : ''; T.app.render(); } });
      if (r.partial) data.error = 'Une partie n’a pas pu être chargée (serveur saturé) : réessayez dans un moment.';
    } catch (e) {
      if (my.signal.aborted) return;
      data.error = e.message;
    }
    if (my === ctrl) { data.loading = false; data.progress = ''; T.app.render(); }
  }

  // Zone affichée : seulement les cases du parcours visibles à l'écran
  let viewTimer = 0;
  function onView() {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      const s = T.app.st(), map = T.map.raw;
      if (!map || !data.route.length) return;
      const z = map.getZoom(), b = map.getBounds();
      const keys = P.inView(data.route, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      const hint = z < 9.5 || keys.length > 16;
      if (hint !== data.zoomHint) { data.zoomHint = hint; T.app.render(); }
      if (hint || !keys.length) return;
      fetchTiles(keys, catsFor(s.mode), 'zone');
    }, 700);
  }

  function wholeRoute(cats) {
    const s = T.app.st();
    if (!data.route.length) { T.ui.toast('Tracez d’abord un parcours', 'error'); return; }
    fetchTiles(data.route, cats || catsFor(s.mode), 'all');
  }

  function toggleCat(k) {
    const s = T.app.st(), cur = new Set(catsFor(s.mode));
    if (cur.has(k)) cur.delete(k); else cur.add(k);
    T.settings.set({ poiCats: { ...T.settings.get().poiCats, [s.mode]: [...cur] } });
    T.app.render();
    if (cur.has(k)) onView();
  }

  function visible(s) {
    if (data.mode !== s.mode) return [];
    const on = new Set(catsFor(s.mode));
    return data.items.filter(i => on.has(i.cat));
  }

  function popup(el, c) {
    const it = data.items.find(x => x.id === el.dataset.id);
    if (!it) return;
    const t = it.tags, cat = P.CATS[it.cat];
    const extra = [t.opening_hours && `Horaires : ${U.esc(t.opening_hours)}`, t.ele && `Altitude : ${U.esc(t.ele)} m`,
      t['fuel:diesel'] === 'yes' && 'Gazole', t['fuel:octane_98'] === 'yes' && 'SP98', t.automated === 'yes' && 'Automate 24/24']
      .filter(Boolean).join(' · ');
    const node = document.createElement('div');
    node.className = 'pop';
    node.innerHTML = `<div class="pop-h"><i class="dot" style="background:${cat.color}"></i><b>${U.esc(it.name)}</b></div>
      <p class="pop-m">${cat.label} · km ${U.nf(it.d / 1000, 1)} · à ${U.fmtKm(it.off)} du tracé</p>
      ${extra ? `<p class="pop-x">${extra}</p>` : ''}
      <div class="pop-a"><a class="btn btn-sm" href="${U.streetViewUrl(it.c)}" target="_blank" rel="noopener">${I('eye')}Street View</a>
      <button class="btn btn-sm" data-add>${I('plus')}Ajouter comme étape</button></div>`;
    node.querySelector('[data-add]').addEventListener('click', () => { T.map.closePopup(); insertStop(it.c); });
    T.map.openPopup(c || it.c, node);
  }

  // Ajoute le lieu comme étape au bon endroit du parcours (dans le tronçon le plus proche)
  function insertStop(c) {
    const s = T.app.st(), comb = T.analysis.combine(s);
    if (!s.legs.length) { T.app.addPoint(c); return; }
    let bi = 0, bd = Infinity;
    s.legs.forEach((L, i) => {
      const pts = L.coords || [L.fromC, L.toC];
      const n = U.nearest(pts, c), d = U.dist(n.point, c);
      if (d < bd) { bd = d; bi = i; }
    });
    const L = s.legs[bi];
    if (L.kind === 'track') { T.ui.toast('Impossible d’ajouter une étape dans un tracé importé', 'error'); return; }
    let id;
    T.app.S.commit(st => {
      id = U.uid();
      const wi = st.waypoints.findIndex(w => w.id === L.from);
      st.waypoints.splice(wi + 1, 0, { id, c });
      st._nextRoad = L.kind === 'line' ? 'line' : L.road;
    });
    T.app.nameLater(id);
    void comb;
  }

  // Alerte : distance maximale sans station-service (moto), quand tout le parcours est chargé
  T.hooks.alerts.push((s, sum, comb) => {
    if (s.mode !== 'moto' || !comb.total || !data.route.length || data.sig !== sigOf(s) || !P.cached(data.route, ['fuel'])) return;
    const range = T.settings.get().fuelRange * 1000;
    const marks = [0, ...data.items.filter(i => i.cat === 'fuel').map(i => i.d), comb.total];
    let gap = 0, at = 0;
    for (let i = 1; i < marks.length; i++) if (marks[i] - marks[i - 1] > gap) { gap = marks[i] - marks[i - 1]; at = marks[i - 1]; }
    if (gap > range * 0.85) {
      sum.alerts.push({ lvl: 'warn', d: at, text: `Aucune station-service sur ${U.fmtKm(gap)} entre le km ${U.nf(at / 1000)} et le km ${U.nf((at + gap) / 1000)} (autonomie réglée : ${U.nf(range / 1000)} km)` });
    }
  });

  T.hooks.render.push((s, sum, comb) => {
    const el = document.getElementById('pois');
    if (!el) return;
    if (comb.coords.length < 2) { el.innerHTML = ''; T.map.setPois([]); data.route = []; return; }
    const before = data.sig;
    refresh(s, comb);
    if (before !== data.sig) onView();
    const list = visible(s), all = P.BY_MODE[s.mode].all, on = new Set(catsFor(s.mode));
    const counts = {};
    data.items.forEach(i => { counts[i.cat] = (counts[i.cat] || 0) + 1; });
    const allDone = P.cached(data.route, [...on]);
    const fuelDone = s.mode !== 'moto' || P.cached(data.route, ['fuel']);
    const status = data.loading
      ? `<span class="calc"><i class="spin"></i>${data.label === 'all' ? 'Tout le parcours' : 'Zone affichée'} ${data.progress}</span>`
      : !allDone ? `<button class="mini" data-act="poiAll">${I('route')}Tout le parcours</button>` : '';
    const rows = list.slice(0, showAll ? 500 : 25);
    el.innerHTML = `<div class="sec-h"><h3>Sur le parcours</h3>${status}</div>
      <div class="cats">${all.map(k => `<button class="cat${on.has(k) ? ' on' : ''}" data-act="poiCat" data-k="${k}" style="--c:${P.CATS[k].color}"><i></i>${P.CATS[k].label}${counts[k] ? `<b>${counts[k]}</b>` : ''}</button>`).join('')}</div>
      ${data.error ? `<p class="err">${U.esc(data.error)}</p>` : ''}
      ${data.zoomHint && !allDone ? '<p class="muted small">Zoomez sur le parcours pour afficher les lieux de la zone, ou chargez tout le parcours.</p>' : ''}
      ${!fuelDone && !data.loading ? '<p class="muted small">Alerte carburant : chargez « Tout le parcours » pour vérifier l’autonomie.</p>' : ''}
      ${rows.length ? `<ul class="pois">${rows.map(it => `<li><button data-act="poiGo" data-id="${it.id}"><i class="dot" style="background:${P.CATS[it.cat].color}"></i><span class="pn">${U.esc(it.name)}</span><span class="pk">km ${U.nf(it.d / 1000, 1)}</span></button></li>`).join('')}</ul>` : ''}
      ${list.length > rows.length ? `<button class="mini" data-act="poiMore">Voir les ${list.length} lieux</button>` : ''}`;
    T.map.setPois(list.map(it => ({ type: 'Feature', geometry: { type: 'Point', coordinates: it.c }, properties: { id: it.id, color: P.CATS[it.cat].color } })));
  });

  T.hooks.init.push(() => {
    const map = T.map.raw;
    if (map) map.on('moveend', onView);
  });

  Object.assign(T.hooks.act, {
    poiAll: () => wholeRoute(),
    poiCat: el => toggleCat(el.dataset.k),
    poiMore: () => { showAll = true; T.app.render(); },
    poiGo: el => {
      const it = data.items.find(x => x.id === el.dataset.id);
      if (!it) return;
      T.map.flyTo(it.c, 14);
      popup(el, it.c);
      T.app.collapseSheet();
    },
    poiPopup: (el, c) => popup(el, c)
  });

  T.poi = { get data() { return data; }, visible };
})();
