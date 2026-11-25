/* Road trip sur plusieurs jours : étapes « Nuit », découpage en journées, pauses dans la durée estimée.
   - Une étape intermédiaire marquée « Nuit » termine une journée.
   - Sans étape « Nuit », découpage automatique proposé si l'option est activée (désactivée par défaut).
   - Pauses ajoutées à la durée estimée si l'option est activée (désactivée par défaut). */
(() => {
  const U = T.util, A = T.analysis, I = T.icons;
  const DEF_KM = { moto: 250, velo: 80, run: 25 };
  const dayKm = mode => +((T.settings.get().dayKm || {})[mode]) || DEF_KM[mode];
  let cur = [];   // journées affichées

  const legDur = (L, mode) => L.status !== 'ok' ? 0
    : L.kind === 'route' && L.duration ? L.duration : L.distance / 1000 / A.speedKmh(mode) * 3600;

  // Pauses : X min toutes les Y h de route
  function pausesFor(sec) {
    const st = T.settings.get();
    if (!st.pauses) return 0;
    const every = Math.max(0.5, +st.pauseEvery || 2) * 3600, len = Math.max(0, +st.pauseMin || 15) * 60;
    return Math.floor(sec / every) * len;
  }

  // Fins de journée (distance en m) : étapes « Nuit », sinon découpage automatique si activé
  function cutsOf(s, comb) {
    const n = s.waypoints.length, cuts = [];
    s.waypoints.forEach((w, i) => { if (w.night && i > 0 && i < n - 1) cuts.push({ d: comb.starts[i], wi: i }); });
    if (cuts.length || !T.settings.get().autoDays) return { cuts, auto: false };
    const step = dayKm(s.mode) * 1000, k = Math.round(comb.total / step);
    for (let j = 1; j < k; j++) {
      const d = comb.total * j / k;
      // Une étape proche (moins de 10 % de l'étape du jour) sert de nuit plutôt qu'un point quelconque
      let wi = -1, best = step * 0.1;
      s.waypoints.forEach((w, i) => { if (i > 0 && i < n - 1 && !w.gap && Math.abs(comb.starts[i] - d) < best) { best = Math.abs(comb.starts[i] - d); wi = i; } });
      cuts.push(wi >= 0 ? { d: comb.starts[wi], wi } : { d, wi: -1 });
    }
    return { cuts, auto: true };
  }

  // Dénivelé sur une portion (seuil de 5 m pour ignorer le bruit)
  function climb(comb, a, b) {
    let up = 0, down = 0, ref = null;
    for (const p of comb.samples) {
      if (p.d < a) continue;
      if (p.d > b) break;
      if (ref == null) { ref = p.e; continue; }
      const dd = p.e - ref;
      if (dd >= 5) { up += dd; ref = p.e; } else if (dd <= -5) { down -= dd; ref = p.e; }
    }
    return { up, down };
  }

  function days(s, comb) {
    if (!s.legs.length || comb.total <= 0) return [];
    const { cuts, auto } = cutsOf(s, comb);
    if (!cuts.length) return [];
    const marks = [{ d: 0, wi: 0 }, ...cuts, { d: comb.total, wi: s.waypoints.length - 1 }];
    const out = [];
    for (let k = 0; k < marks.length - 1; k++) {
      const a = marks[k].d, b = marks[k + 1].d;
      let dist = 0, dur = 0, up = 0, down = 0;
      s.legs.forEach((L, i) => {
        const la = comb.starts[i], lb = comb.starts[i + 1], o = Math.min(b, lb) - Math.max(a, la);
        if (o <= 0 || lb <= la) return;
        const f = o / (lb - la);
        dist += o; dur += legDur(L, s.mode) * f;
        if (f > 0.999 && L.an && L.an.hasElev) { up += L.an.up || 0; down += L.an.down || 0; }
        else { const c = climb(comb, Math.max(a, la), Math.min(b, lb)); up += c.up; down += c.down; }
      });
      out.push({ i: k, a, b, dist, dur, pause: pausesFor(dur), up, down, from: marks[k], to: marks[k + 1], auto });
    }
    return out;
  }

  // Lieux où l'on dort (fin de chaque journée sauf la dernière)
  function nights(s, comb) {
    return cutsOf(s, comb).cuts.map((c, k) => ({ k, d: c.d, c: c.wi >= 0 ? s.waypoints[c.wi].c : U.at(comb.coords, comb.cum, c.d) })).filter(x => x.c);
  }

  // Durée totale affichée : avec les pauses si l'option est activée
  function totalDuration(s, sum) {
    if (!T.settings.get().pauses) return sum.duration;
    const D = days(s, A.combine(s));
    return D.length ? D.reduce((t, d) => t + d.dur + d.pause, 0) : sum.duration + pausesFor(sum.duration);
  }

  const label = (s, m) => m.wi >= 0 ? T.io.export.wpName(s.waypoints[m.wi], m.wi, s.waypoints.length) : `km ${U.nf(m.d / 1000)}`;
  const sleepNear = k => (T.poi && T.poi.data.items || []).filter(it => it.cat === 'sleep' && it.night === k).length;

  T.hooks.render.push((s, sum, comb) => {
    const el = document.getElementById('days');
    if (!el) return;
    const D = cur = days(s, comb);
    if (D.length < 2) { el.innerHTML = ''; return; }
    el.innerHTML = `<h3>Jours <span class="cnt">${D.length}</span></h3><ol class="days">${D.map(d => {
      const n = d.i < D.length - 1 ? sleepNear(d.i) : 0;
      return `<li class="day">
        <button class="day-h" data-act="dayFocus" data-i="${d.i}"><b>Jour ${d.i + 1}</b><span>${U.esc(label(s, d.from))}<i>→</i>${U.esc(label(s, d.to))}</span></button>
        <div class="day-figs"><span>${U.fmtKm(d.dist)}</span><span>${U.fmtDur(d.dur + d.pause)}${d.pause ? ` <small>dont ${U.fmtDur(d.pause)} de pause</small>` : ''}</span><span>+${U.nf(d.up)} m</span></div>
        <div class="day-a">${d.i < D.length - 1 ? `<button class="mini" data-act="daySleep" data-i="${d.i}">${I('bed', 'sm')}Dormir ici${n ? ` <b>${n}</b>` : ''}</button>` : ''}<button class="mini" data-act="dayGpx" data-i="${d.i}">${I('upload', 'sm')}GPX du jour</button></div></li>`;
    }).join('')}</ol>${D[0].auto ? '<p class="muted small">Découpage proposé automatiquement (réglage). Marquez une étape « Nuit » pour choisir vous-même où dormir.</p>' : ''}`;
  });

  Object.assign(T.hooks.act, {
    dayFocus: el => {
      const d = cur[+el.dataset.i]; if (!d) return;
      const comb = A.combine(T.app.st()), pts = comb.coords.filter((c, k) => comb.cum[k] >= d.a && comb.cum[k] <= d.b);
      if (pts.length > 1) T.map.fit(pts);
      T.app.collapseSheet();
    },
    daySleep: el => {
      const s = T.app.st(), nt = nights(s, A.combine(s))[+el.dataset.i]; if (!nt) return;
      if (T.poi) T.poi.ensureCat('sleep');
      T.map.flyTo(nt.c, 13);
      T.app.collapseSheet();
    },
    dayGpx: el => {
      const d = cur[+el.dataset.i], s = T.app.st(); if (!d) return;
      const title = `${s.name || 'Parcours'} - jour ${d.i + 1}`;
      const fn = T.io.export.safeName(s.name) + `-jour-${d.i + 1}.gpx`;
      T.io.export.download(fn, T.io.export.gpx(s, { trk: true, wpt: true, range: [d.a, d.b], title }), 'application/gpx+xml');
      T.ui.toast('GPX téléchargé : ' + fn);
    }
  });

  T.days = { days: s => days(s, A.combine(s)), nights: s => nights(s, A.combine(s)), totalDuration, pausesFor, dayKm, DEF_KM };
})();
