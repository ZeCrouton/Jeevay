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

  // Pauses posées sur le parcours (étapes « Pause », durée en minutes) : secondes d'arrêt entre les distances a et b (a exclu, b exclu)
  function stopSec(s, comb, a, b) {
    let sec = 0;
    s.waypoints.forEach((w, i) => { if (w.pause && i > 0 && i < s.waypoints.length - 1 && comb.starts[i] > a + 1 && comb.starts[i] < b - 1) sec += w.pause * 60; });
    return sec;
  }
  const hasPauses = s => s.waypoints.some(w => w.pause) || !!T.settings.get().pauses;

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
      s.waypoints.forEach((w, i) => { if (i > 0 && i < n - 1 && T.io.export.isStep(w, i, n) && Math.abs(comb.starts[i] - d) < best) { best = Math.abs(comb.starts[i] - d); wi = i; } });
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

  // Heure de départ de chaque journée : jour 1 = départ réglé dans « Météo au passage » ;
  // jours suivants = lendemain à l'heure choisie sur l'étape « Nuit » (sinon même heure que le jour 1)
  function startOf(s, k, first, prevEnd, nightW) {
    if (k === 0) return first;
    const d = new Date(prevEnd.getTime());
    d.setDate(d.getDate() + 1);
    const hhmm = (nightW && nightW.dep) || `${first.getHours()}:${first.getMinutes()}`;
    const [h, m] = hhmm.split(':').map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
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
      out.push({ i: k, a, b, dist, dur, pause: pausesFor(dur) + stopSec(s, comb, a, b), up, down, from: marks[k], to: marks[k + 1], auto });
    }
    // Horaires
    const first = T.weather ? T.weather.departure() : new Date();
    out.forEach((d, k) => {
      const nw = k > 0 && d.from.wi >= 0 ? s.waypoints[d.from.wi] : null;
      d.start = startOf(s, k, first, k ? out[k - 1].end : first, nw);
      d.end = new Date(d.start.getTime() + (d.dur + d.pause) * 1000);
      d.nightW = nw;
    });
    return out;
  }

  // Lieux où l'on dort (fin de chaque journée sauf la dernière)
  function nights(s, comb) {
    return cutsOf(s, comb).cuts.map((c, k) => ({ k, d: c.d, c: c.wi >= 0 ? s.waypoints[c.wi].c : U.at(comb.coords, comb.cum, c.d) })).filter(x => x.c);
  }

  // Heure de passage (Date) à la distance d ; null s'il n'y a qu'une journée
  // k : journée imposée (utile aux bornes, qui appartiennent à deux journées)
  function dateAt(s, comb, d, k) {
    const D = days(s, comb);
    if (D.length < 2) return null;
    const day = D[k] || D.find(x => d <= x.b + 1) || D[D.length - 1];
    let t = 0;
    s.legs.forEach((L, i) => {
      const la = comb.starts[i], lb = comb.starts[i + 1], a = Math.max(day.a, la), b = Math.min(d, day.b, lb);
      if (b > a && lb > la) t += legDur(L, s.mode) * (b - a) / (lb - la);
    });
    return new Date(day.start.getTime() + (t + pausesFor(t) + stopSec(s, comb, day.a, d)) * 1000);
  }

  // Signature des horaires (pour savoir si la météo est à jour)
  const schedSig = s => days(s, A.combine(s)).map(d => d.start.getTime()).join(',') + '~' + s.waypoints.map(w => w.pause || '').join(',');

  // Durée totale affichée : avec les pauses si l'option est activée
  function totalDuration(s, sum) {
    const comb = A.combine(s), D = days(s, comb);
    return D.length ? D.reduce((t, d) => t + d.dur + d.pause, 0) : sum.duration + pausesFor(sum.duration) + stopSec(s, comb, 0, comb.total + 2);
  }

  const W = () => T.weather;
  const day2 = dt => dt.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  function dayTime(d) {
    const hm = W().hm;
    if (d.i === 0) return `<span>départ <input type="datetime-local" class="time-in" data-dep1 value="${W().toInput(d.start)}" aria-label="Date et heure de départ du jour 1"></span><span>arrivée ${hm(d.end)}</span>`;
    const val = `${String(d.start.getHours()).padStart(2, '0')}:${String(d.start.getMinutes()).padStart(2, '0')}`;
    const startTxt = d.i > 0 && d.nightW
      ? `départ <input type="time" class="time-in" data-dep="${d.nightW.id}" value="${val}" aria-label="Heure de départ du jour ${d.i + 1}">`
      : `départ ${hm(d.start)}`;
    return `<span>${day2(d.start)}</span><span>${startTxt}</span><span>arrivée ${hm(d.end)}</span>`;
  }
  // Résumé météo du jour, à partir des prévisions déjà chargées (« Météo au passage »)
  function dayWx(d) {
    const wx = W() && W().data;
    if (!wx || !W().fresh(T.app.st())) return '';
    const rows = wx.rows.filter(r => r.w && (r.k != null ? r.k === d.i : r.d >= d.a - 1 && r.d <= d.b + 1));
    if (!rows.length) return '';
    const temps = rows.map(r => r.w.temp).filter(x => x != null);
    const rain = Math.max(...rows.map(r => r.w.rainProb || 0)), gust = Math.max(...rows.map(r => r.w.gust || 0));
    const worst = rows.reduce((a, r) => ((r.w.code || 0) > (a.w.code || 0) ? r : a), rows[0]);
    const [k, lbl] = T.providers.weather.kind(worst.w.code);
    return `<div class="day-wx" title="${U.esc(lbl)}">${W().icon(k)}<span>${Math.round(Math.min(...temps))}–${Math.round(Math.max(...temps))} °C</span>
      <span class="${rain >= 50 ? 'hi' : ''}">pluie ${rain} %</span><span>rafales ${Math.round(gust)} km/h</span></div>`;
  }

  const stopsIn = (s, d) => {
    const comb = A.combine(s);
    return s.waypoints.map((w, i) => ({ w, i, p: comb.starts[i] })).filter(x => x.w.pause && x.i > 0 && x.i < s.waypoints.length - 1 && x.p > d.a + 1 && x.p < d.b - 1);
  };
  const label = (s, m) => m.wi >= 0 ? T.io.export.wpName(s.waypoints[m.wi], m.wi, s.waypoints.length, s.waypoints) : `km ${U.nf(m.d / 1000)}`;
  const sleepNear = k => (T.poi && T.poi.data.items || []).filter(it => it.cat === 'sleep' && it.night === k).length;

  /* Jours masqués sur la carte (tous affichés par défaut, non mémorisé).
     Remis à zéro si le parcours ou le nombre de jours change. */
  let off = new Set(), offKey = '', showAll = false;
  function visibility(s, comb) {
    const D = days(s, comb), key = D.length + ':' + (s.waypoints[0] ? s.waypoints[0].id : '');
    if (key !== offKey) { off.clear(); offKey = key; }
    if (showAll || !off.size) return null;   // null : tout est visible
    // Vrai si la distance d appartient à un jour affiché (les bornes appartiennent aux deux jours voisins)
    return d => D.some(x => !off.has(x.i) && d >= x.a - 1 && d <= x.b + 1);
  }

  T.hooks.render.push((s, sum, comb) => {
    const el = document.getElementById('days');
    if (!el) return;
    const D = cur = days(s, comb);
    // Saisie d'une heure en cours : on ne remplace pas le champ sous les doigts
    const a = document.activeElement;
    if (D.length > 1 && a && a.tagName === 'INPUT' && el.contains(a)) { skipped = true; return; }
    if (D.length < 2) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="sec-h"><h3>Jours <span class="cnt">${D.length}</span></h3>${off.size ? `<button class="mini" data-act="dayAll">${I('eye', 'sm')}Tout afficher</button>` : ''}</div><ol class="days">${D.map(d => {
      const n = d.i < D.length - 1 ? sleepNear(d.i) : 0;
      const shown = !off.has(d.i);
      return `<li class="day${shown ? '' : ' day-off'}">
        <button class="day-h" data-act="dayFocus" data-i="${d.i}"><b>Jour ${d.i + 1}</b><span>${U.esc(label(s, d.from))}<i>→</i>${U.esc(label(s, d.to))}</span></button>
        <div class="day-time">${dayTime(d)}</div>
        ${dayWx(d)}
        ${stopsIn(s, d).map(x => `<p class="day-stay">${I('cup', 'sm')} Pause : <b>${U.esc((x.w.stay && x.w.stay.name) || T.io.export.wpName(x.w, x.i, s.waypoints.length, s.waypoints))}</b> · ${x.w.pause} min</p>`).join('')}
        ${d.i < D.length - 1 && d.to.wi >= 0 && s.waypoints[d.to.wi].stay && s.waypoints[d.to.wi].stay.name ? `<p class="day-stay">${I('bed', 'sm')} Nuit : <b>${U.esc(s.waypoints[d.to.wi].stay.name)}</b></p>` : ''}
        <div class="day-figs"><span>${U.fmtKm(d.dist)}</span><span>${U.fmtDur(d.dur + d.pause)}${d.pause ? ` <small>dont ${U.fmtDur(d.pause)} de pause</small>` : ''}</span><span>+${U.nf(d.up)} m</span></div>
        <div class="day-a"><button class="mini" data-act="dayShow" data-i="${d.i}" aria-pressed="${shown}" title="Afficher ou masquer ce jour sur la carte">${I('eye', 'sm')}${shown ? 'Affiché' : 'Masqué'}</button>${d.i < D.length - 1 ? `<button class="mini" data-act="daySleep" data-i="${d.i}">${I('bed', 'sm')}Dormir ici${n ? ` <b>${n}</b>` : ''}</button>` : ''}<button class="mini" data-act="dayGpx" data-i="${d.i}">${I('upload', 'sm')}GPX du jour</button></div></li>`;
    }).join('')}</ol>${D[0].auto ? '<p class="muted small">Découpage proposé automatiquement (réglage). Marquez une étape « Nuit » pour choisir vous-même où dormir.</p>' : ''}`;
  });

  let skipped = false;
  document.addEventListener('focusout', e => {
    if (skipped && e.target.closest && e.target.closest('#days')) setTimeout(() => { skipped = false; T.app.render(); }, 200);
  });

  // Sur écran tactile, la saisie est finie dès que le sélecteur est validé : on libère le champ pour rafraîchir
  document.addEventListener('change', e => {
    if (e.target.closest && e.target.closest('#days') && window.matchMedia('(pointer: coarse)').matches) e.target.blur();
  });

  // Heure de départ d'une journée (jour 1 : départ général ; ensuite : sur l'étape « Nuit » de la veille)
  document.addEventListener('change', e => {
    if (e.target && e.target.dataset && 'dep1' in e.target.dataset) {
      const d = new Date(e.target.value);
      if (!isNaN(d) && d >= new Date().setHours(0, 0, 0, 0)) { W().setDeparture(d); T.app.render(); }
      return;
    }
    const id = e.target && e.target.dataset && e.target.dataset.dep;
    if (!id || !/^\d{1,2}:\d{2}$/.test(e.target.value)) return;
    T.app.S.commit(x => { x.waypoints = x.waypoints.map(p => p.id === id ? { ...p, dep: e.target.value } : p); }, true);
  });

  // Cadre la carte sur les jours affichés
  function fitShown() {
    const comb = A.combine(T.app.st()), see = visibility(T.app.st(), comb);
    const pts = comb.coords.filter((c, k) => !see || cur.some(x => !off.has(x.i) && comb.cum[k] >= x.a && comb.cum[k] <= x.b));
    if (pts.length > 1) T.map.fit(pts);
  }

  Object.assign(T.hooks.act, {
    dayShow: el => {
      const i = +el.dataset.i;
      if (off.has(i)) off.delete(i);
      else if (off.size >= cur.length - 1) { T.ui.toast('Gardez au moins un jour affiché'); return; }
      else off.add(i);
      T.map.closePopup();
      T.app.render(); fitShown();
    },
    dayAll: () => { off.clear(); T.app.render(); fitShown(); },
    dayFocus: el => {
      const d = cur[+el.dataset.i]; if (!d) return;
      if (off.delete(d.i)) T.app.render();
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

  T.days = { visibility, showEverything: v => { showAll = v; T.app.render(); }, stopSec: (s, a, b) => stopSec(s, A.combine(s), a, b), hasPauses, stopsIn, days: s => days(s, A.combine(s)), nights: s => nights(s, A.combine(s)), dateAt: (s, d, k) => dateAt(s, A.combine(s), d, k), schedSig, totalDuration, pausesFor, dayKm, DEF_KM };
})();
