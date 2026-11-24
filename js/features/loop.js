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
          <option value="gps">Ma position</option></select></label>
        <label class="field"><span>Direction</span><select id="lp-dir">${DIRS.map(([v, l]) => `<option value="${v}" ${v === o.dir ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Préférer</span><select id="lp-road">${[T.config.kinds.auto, ...m.roads].map(r => `<option value="${r.id}" ${r.id === o.road ? 'selected' : ''}>${U.esc(r.label)}</option>`).join('')}</select></label>
        ${s.waypoints.length ? '<p class="muted small">Le parcours actuel sera remplacé (Ctrl+Z pour revenir).</p>' : ''}`,
      actions: [{ label: 'Annuler' }, {
        label: 'Générer la boucle', primary: true, onClick: root => {
          const km = U.clamp(+root.querySelector('#lp-km').value || DEF[s.mode], 2, 600);
          last = { mode: s.mode, km, dir: root.querySelector('#lp-dir').value, road: root.querySelector('#lp-road').value, from: root.querySelector('#lp-from').value };
          start(last);
        }
      }]
    });
  }

  function origin(o) {
    const s = T.app.st();
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

  async function snapAll(pts, mode) {
    if (mode === 'run') return pts;
    return Promise.all(pts.map(async p => {
      try { return (await T.providers.routing.snap(p, mode, 1500)) || p; } catch (e) { return p; }
    }));
  }

  async function start(o) {
    const S = T.app.S, mode = T.app.st().mode;
    T.ui.toast('Création de la boucle…', 'info', 2500);
    const c0 = await origin(o);
    const theta = o.dir === '' ? Math.random() * 360 : +o.dir;
    const n = mode === 'run' ? 3 : 4;
    let D = o.km * 1000, pts = await snapAll(circle(c0, D, theta, n), mode);
    const build = ps => st => {
      const a = { id: U.uid(), c: c0 }, z = { id: U.uid(), c: c0 };
      st.waypoints = [a, ...ps.map(c => ({ id: U.uid(), c })), z];
      st.legs = [];
      st._nextRoad = o.road;
      if (st.name === 'Mon parcours' || /^Boucle /.test(st.name)) st.name = `Boucle ${Math.round(o.km)} km`;
    };
    S.commit(build(pts));
    await waitIdle();
    // Un ajustement si la distance obtenue s'écarte trop de la cible
    let total = T.analysis.summary(T.app.st()).distance;
    if (total > 0 && Math.abs(total / D - 1) > 0.2) {
      const scaled = await snapAll(circle(c0, D * (D / total), theta, n), mode);
      S.amend(st => { const keep = st.name; build(scaled)(st); st.name = keep; });
      await waitIdle();
      total = T.analysis.summary(T.app.st()).distance;
    }
    T.app.fitAll();
    T.ui.toast(`Boucle de ${U.fmtKm(total)} (cible ${o.km} km). Relancez « Créer une boucle » pour une autre proposition.`, 'info', 5000);
  }

  T.hooks.act.loop = () => { if (!T.app.guard()) dialog(); };
})();
