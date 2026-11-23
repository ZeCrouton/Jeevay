/* V2 — Points d'intérêt le long du parcours + alerte d'autonomie carburant (moto). */
(() => {
  const U = T.util, I = T.icons, P = T.providers.poi;
  let data = { sig: null, mode: null, items: [], loading: false, error: null };
  let ctrl = null, showAll = false;

  const sigOf = s => s.legs.map(l => l.id + ':' + l.rev + ':' + l.status).join('|');
  const catsFor = mode => {
    const saved = T.settings.get().poiCats[mode];
    return saved || P.BY_MODE[mode].on;
  };

  async function search() {
    const s = T.app.st(), comb = T.analysis.combine(s);
    if (comb.coords.length < 2) { T.ui.toast('Tracez d’abord un parcours', 'error'); return; }
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    const cats = P.BY_MODE[s.mode].all;
    data = { ...data, loading: true, error: null };
    T.app.render();
    try {
      const raw = await P.along(comb.coords, cats, ctrl.signal);
      // Position le long du parcours et écart à la route
      const { pts } = U.resample(comb.coords, Math.max(80, comb.total / 6000));
      const kx = Math.cos(comb.coords[0][1] * Math.PI / 180);
      const seen = new Set();
      const items = [];
      for (const it of raw) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        let best = Infinity, bd = 0;
        for (const p of pts) {
          const dx = (p.c[0] - it.c[0]) * kx, dy = p.c[1] - it.c[1], dd = dx * dx + dy * dy;
          if (dd < best) { best = dd; bd = p.d; }
        }
        items.push({ ...it, d: bd, off: Math.sqrt(best) * 111320 });
      }
      items.sort((a, b) => a.d - b.d);
      data = { sig: sigOf(s), mode: s.mode, items, loading: false, error: null };
      showAll = false;
      if (!items.length) T.ui.toast('Aucun point d’intérêt trouvé le long du parcours');
    } catch (e) {
      if (e.name === 'AbortError') return;
      data = { ...data, loading: false, error: e.message };
    }
    T.app.render();
  }

  function visible(s) {
    if (data.mode !== s.mode) return [];
    const on = new Set(catsFor(s.mode));
    return data.items.filter(i => on.has(i.cat));
  }

  function toggleCat(k) {
    const s = T.app.st(), cur = new Set(catsFor(s.mode));
    if (cur.has(k)) cur.delete(k); else cur.add(k);
    T.settings.set({ poiCats: { ...T.settings.get().poiCats, [s.mode]: [...cur] } });
    T.app.render();
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

  // Alerte : distance maximale sans station-service (moto)
  T.hooks.alerts.push((s, sum, comb) => {
    if (s.mode !== 'moto' || data.mode !== 'moto' || data.sig !== sigOf(s) || !comb.total) return;
    const range = T.settings.get().fuelRange * 1000;
    const fuel = data.items.filter(i => i.cat === 'fuel').map(i => i.d);
    const marks = [0, ...fuel, comb.total];
    let gap = 0, at = 0;
    for (let i = 1; i < marks.length; i++) if (marks[i] - marks[i - 1] > gap) { gap = marks[i] - marks[i - 1]; at = marks[i - 1]; }
    if (gap > range * 0.85) {
      sum.alerts.push({ lvl: 'warn', d: at, text: `Aucune station-service sur ${U.fmtKm(gap)} entre le km ${U.nf(at / 1000)} et le km ${U.nf((at + gap) / 1000)} (autonomie réglée : ${U.nf(range / 1000)} km)` });
    }
  });

  T.hooks.render.push((s, sum, comb) => {
    const el = document.getElementById('pois');
    if (!el) return;
    if (comb.coords.length < 2) { el.innerHTML = ''; T.map.setPois([]); return; }
    const stale = data.sig && data.sig !== sigOf(s);
    const list = visible(s), all = P.BY_MODE[s.mode].all, on = new Set(catsFor(s.mode));
    const counts = {};
    if (data.mode === s.mode) data.items.forEach(i => { counts[i.cat] = (counts[i.cat] || 0) + 1; });
    const btn = data.loading
      ? '<span class="calc"><i class="spin"></i>Recherche…</span>'
      : `<button class="mini" data-act="poiSearch">${I(data.sig ? 'retry' : 'gmaps')}${data.sig ? (stale ? 'Mettre à jour' : 'Actualiser') : 'Rechercher'}</button>`;
    const rows = list.slice(0, showAll ? 400 : 25);
    el.innerHTML = `<div class="sec-h"><h3>Sur le parcours</h3>${btn}</div>
      ${data.error ? `<p class="err">${U.esc(data.error)}</p>` : ''}
      ${!data.sig && !data.loading ? `<p class="muted small">Stations-service, cols, points d’eau, panoramas… le long de votre tracé.</p>` : ''}
      ${data.sig && data.mode === s.mode ? `<div class="cats">${all.map(k => `<button class="cat${on.has(k) ? ' on' : ''}" data-act="poiCat" data-k="${k}" style="--c:${P.CATS[k].color}"><i></i>${P.CATS[k].label}<b>${counts[k] || 0}</b></button>`).join('')}</div>
        ${stale ? '<p class="muted small">Le parcours a changé : mettez à jour pour recaler les distances.</p>' : ''}
        <ul class="pois">${rows.map(it => `<li><button data-act="poiGo" data-id="${it.id}"><i class="dot" style="background:${P.CATS[it.cat].color}"></i><span class="pn">${U.esc(it.name)}</span><span class="pk">km ${U.nf(it.d / 1000, 1)}</span></button></li>`).join('')}</ul>
        ${list.length > rows.length ? `<button class="mini" data-act="poiMore">Voir les ${list.length} lieux</button>` : ''}` : ''}`;
    T.map.setPois(list.map(it => ({ type: 'Feature', geometry: { type: 'Point', coordinates: it.c }, properties: { id: it.id, color: P.CATS[it.cat].color } })));
  });

  Object.assign(T.hooks.act, {
    poiSearch: search,
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
