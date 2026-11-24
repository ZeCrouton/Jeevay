/* V3 — Boucle automatique : un départ, une distance, une direction ; l'app propose un circuit. */
(() => {
  const U = T.util;
  let last = null;

  const DEF = { moto: 120, velo: 50, run: 10 };
  const DIRS = [['', 'Au hasard'], ['0', 'Nord'], ['90', 'Est'], ['180', 'Sud'], ['270', 'Ouest']];

  function dialog() {
    const s = T.app.st(), m = T.config.modes[s.mode];
    const o = last && last.mode === s.mode ? last : { mode: s.mode, km: DEF[s.mode], dir: '', road: T.engine.defaultRoad(s.mode), from: s.waypoints.length ? 'first' : 'center' };
    T.ui.modal({
      title: 'Créer une boucle',
      body: `<p class="muted">L’app trace un circuit qui revient au départ. Relancez pour une autre proposition.</p>
        <label class="field"><span>Distance visée (km)</span><input id="lp-km" type="number" min="2" max="600" value="${o.km}"></label>
        <label class="field"><span>Départ</span><select id="lp-from">
          ${s.waypoints.length ? `<option value="first" ${o.from === 'first' ? 'selected' : ''}>Point de départ actuel</option>` : ''}
          <option value="center" ${o.from === 'center' ? 'selected' : ''}>Centre de la carte</option>
          <option value="place" ${o.from === 'place' ? 'selected' : ''}>Un lieu (recherche)</option>
          <option value="gps">Ma position</option></select></label>
        <div id="lp-place" ${o.from === 'place' ? '' : 'hidden'}>
          <input id="lp-q" type="search" placeholder="Rechercher un lieu…" autocomplete="off" aria-label="Lieu de départ" value="${U.esc(o.place ? o.place.label : '')}">
          <ul id="lp-res" class="lp-res"></ul>
        </div>
        <label class="field"><span>Direction</span><select id="lp-dir">${DIRS.map(([v, l]) => `<option value="${v}" ${v === o.dir ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Préférer</span><select id="lp-road">${[T.config.kinds.auto, ...m.roads].map(r => `<option value="${r.id}" ${r.id === o.road ? 'selected' : ''}>${U.esc(r.label)}</option>`).join('')}</select></label>
        ${s.waypoints.length ? '<p class="muted small">Le parcours actuel sera remplacé (Ctrl+Z pour revenir).</p>' : ''}`,
      actions: [{ label: 'Annuler' }, {
        label: 'Générer la boucle', primary: true, onClick: root => {
          const km = U.clamp(+root.querySelector('#lp-km').value || DEF[s.mode], 2, 600);
          const from = root.querySelector('#lp-from').value;
          if (from === 'place' && !place) { T.ui.toast('Choisissez un lieu de départ dans la liste', 'info', 2500); return false; }
          last = { mode: s.mode, km, dir: root.querySelector('#lp-dir').value, road: root.querySelector('#lp-road').value, from, place };
          start(last);
        }
      }]
    });
    // Choix du lieu de départ par recherche
    let place = o.place || null;
    const dlg = document.querySelector('.dlg-wrap'), box = dlg.querySelector('#lp-place'), q = dlg.querySelector('#lp-q'), res = dlg.querySelector('#lp-res');
    dlg.querySelector('#lp-from').addEventListener('change', e => { box.hidden = e.target.value !== 'place'; if (!box.hidden) q.focus(); });
    let ctl = null, items = [];
    const search = U.debounce(async () => {
      const v = q.value.trim();
      if (v.length < 3) { res.innerHTML = ''; return; }
      if (ctl) ctl.abort();
      const my = ctl = new AbortController();
      res.innerHTML = '<li class="muted small">Recherche…</li>';
      try { items = await T.providers.geocode.search(v, T.map.center(), my.signal); } catch (e) { if (my.signal.aborted) return; items = []; }
      if (my !== ctl) return;
      res.innerHTML = items.length ? items.map((r, k) => `<li><button type="button" data-k="${k}"><b>${U.esc(r.label)}</b><small>${U.esc(r.sub || '')}</small></button></li>`).join('') : '<li class="muted small">Aucun lieu trouvé</li>';
    }, 300);
    q.addEventListener('input', () => { place = null; search(); });
    res.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const r = items[+b.dataset.k]; if (!r) return;
      place = { label: r.label, c: r.c }; q.value = r.label; res.innerHTML = '';
    });
  }

  function origin(o) {
    const s = T.app.st();
    if (o.from === 'place' && o.place) return Promise.resolve(o.place.c);
    if (o.from === 'first' && s.waypoints.length) return Promise.resolve(s.waypoints[0].c);
    if (o.from === 'gps' && navigator.geolocation) {
      return new Promise(res => navigator.geolocation.getCurrentPosition(
        p => res([p.coords.longitude, p.coords.latitude]), () => res(T.map.center()), { timeout: 8000 }));
    }
    return Promise.resolve(T.map.center());
  }

  const waitIdle = () => new Promise(res => {
    const t0 = Date.now();
    const tick = () => {
      const pend = T.app.st().legs.some(l => l.status === 'pending');
      if (!pend || Date.now() - t0 > 40000) res(); else setTimeout(tick, 300);
    };
    setTimeout(tick, 300);
  });

  // Points de la boucle sur un cercle passant par le départ
  function circle(c0, D, theta, n) {
    const r = D / (2 * Math.PI) / 1.25;
    const center = U.destination(c0, r, theta);
    const back = (theta + 180) % 360, pts = [];
    for (let k = 1; k < n; k++) {
      const jitter = (Math.random() - 0.5) * (300 / n) * 0.35;
      pts.push(U.destination(center, r * (0.85 + Math.random() * 0.3), back + k * 360 / n + jitter));
    }
    return pts;
  }

  // Recale chaque point sur une route (rayon 1,5 km). Renvoie null si un point reste hors route (mer, forêt…).
  async function snapAll(pts, mode) {
    if (mode === 'run') return pts;
    const r = await Promise.all(pts.map(async p => { try { return await T.providers.routing.snap(p, mode, 1500); } catch (e) { return null; } }));
    return r.every(Boolean) ? r : null;
  }
  const hasFerryOrError = () => T.app.st().legs.some(l => l.status !== 'ok' || (l.an && l.an.ferry));

  async function start(o) {
    const S = T.app.S, mode = T.app.st().mode;
    T.ui.toast('Création de la boucle…', 'info', 2500);
    let c0 = await origin(o);
    if (mode !== 'run') {   // le départ doit être sur une route (pas en mer, pas hors réseau)
      let p = null;
      try { p = await T.providers.routing.snap(c0, mode, 3000); } catch (e) { /* ignoré */ }
      if (!p) { T.ui.toast('Aucune route près du départ : déplacez la carte ou choisissez un autre départ.', 'warn', 5000); return; }
      c0 = p;
    }
    const n = mode === 'run' ? 3 : 4;
    const build = ps => st => {
      const a = { id: U.uid(), c: c0 }, z = { id: U.uid(), c: c0 };
      st.waypoints = [a, ...ps.map(c => ({ id: U.uid(), c })), z];
      st.legs = [];
      st._nextRoad = o.road;
      if (st.name === 'Mon parcours' || /^Boucle /.test(st.name)) st.name = `Boucle ${Math.round(o.km)} km`;
    };
    const D = o.km * 1000;
    let theta = o.dir === '' ? Math.random() * 360 : +o.dir, pts = null, ok = false;
    // Jusqu'à 4 propositions : tous les points sur route, aucun bac, aucun tronçon en erreur
    for (let k = 0; k < 4 && !ok; k++) {
      if (k) theta = o.dir === '' ? Math.random() * 360 : (+o.dir + (Math.random() - 0.5) * 70 + 360) % 360;
      let cand = null;
      for (let t = 0; t < 4 && !cand; t++) cand = await snapAll(circle(c0, D, theta, n), mode);
      if (!cand) continue;
      pts = cand;
      S.commit(build(pts));
      await waitIdle();
      ok = !hasFerryOrError();
    }
    if (!pts) { T.ui.toast('Impossible de trouver une boucle ici : essayez un autre départ ou une autre direction.', 'warn', 5000); return; }
    // Un ajustement si la distance obtenue s'écarte trop de la cible
    let total = T.analysis.summary(T.app.st()).distance;
    if (ok && total > 0 && Math.abs(total / D - 1) > 0.2) {
      const scaled = await snapAll(circle(c0, D * (D / total), theta, n), mode);
      if (scaled) {
        S.amend(st => { const keep = st.name; build(scaled)(st); st.name = keep; });
        await waitIdle();
        if (hasFerryOrError()) { S.amend(st => { const keep = st.name; build(pts)(st); st.name = keep; }); await waitIdle(); }
        total = T.analysis.summary(T.app.st()).distance;
      }
    }
    T.app.fitAll();
    T.ui.toast(ok ? `Boucle de ${U.fmtKm(total)} (cible ${o.km} km). Relancez « Créer une boucle » pour une autre proposition.`
      : 'Boucle approximative (bac ou tronçon en erreur) : relancez « Créer une boucle » pour une autre proposition.', 'info', 5000);
  }

  T.hooks.act.loop = () => { if (!T.app.guard()) dialog(); };
})();
