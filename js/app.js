/* Jeevay — assemblage de l'application : actions utilisateur, rendu, dialogues. */
(() => {
  const U = T.util, I = T.icons, S = T.store, E = T.engine, A = T.analysis, M = T.map, UI = T.ui, $ = UI.$;
  const st = () => S.state;
  // Couleur de l'appli : choix des réglages, sinon celle de l'activité (moto orange, vélo vert, running magenta)
  // Texte lisible sur la couleur d'accent : blanc ou encre, selon le meilleur contraste (WCAG)
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const onAccent = hex => { const L = lum(hex); return (1.05 / (L + 0.05)) >= ((L + 0.05) / (lum('#14161b') + 0.05)) ? '#fff' : '#14161b'; };
  const setAccent = c => { const r = document.documentElement.style; r.setProperty('--accent', c); r.setProperty('--on-accent', /^#[0-9a-f]{6}$/i.test(c) ? onAccent(c) : '#fff'); };
  const accent = () => { const c = T.settings.get().accent; return /^#[0-9a-f]{6}$/i.test(c || '') ? c : T.config.modes[st().mode].accent; };

  // ---------- Actions sur le parcours ----------
  let appendMode = false, lockToast = 0;
  // Tracé verrouillé : refuse la modification et le dit (au plus une fois toutes les 1,5 s)
  function guard() {
    if (!S.locked) return false;
    if (Date.now() - lockToast > 1500) { lockToast = Date.now(); UI.toast('Tracé verrouillé : touche le cadenas pour le modifier', 'info', 2200); }
    return true;
  }
  function addPoint(c) {
    if (guard()) return;
    UI.closeChooser();
    const snap = T.settings.get().snapMain && st().mode !== 'run';
    let id;
    S.commit(s => { id = U.uid(); s.waypoints.push({ id, c, snapping: snap || undefined }); });
    if (snap) snapPoint(id, c); else nameLater(id);
  }

  // Recale le point sur la voie principale la plus proche (l'utilisateur peut ensuite le déplacer)
  async function snapPoint(id, c) {
    let p = null, failed = false;
    for (let k = 0; k < 2 && !p; k++) {   // 2 essais de 5 s : le serveur public est parfois lent
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 5000);
      try { p = await T.providers.routing.snap(c, st().mode, 90, ctrl.signal); failed = false; break; } catch (e) { failed = true; }
      finally { clearTimeout(t); }
      const w0 = st().waypoints.find(x => x.id === id); if (!w0 || !U.same(w0.c, c)) return;
    }
    if (failed) UI.toast('Point non recalé sur la route (serveur lent) : posé tel quel', 'info', 2500);
    const w = st().waypoints.find(x => x.id === id);
    if (!w || !U.same(w.c, c)) return;
    S.amend(s => { s.waypoints = s.waypoints.map(x => x.id === id ? { ...x, c: p || c, snapping: undefined } : x); });
    nameLater(id);
  }

  function movePoint(id, c) {
    if (guard()) return;
    S.commit(s => { s.waypoints = s.waypoints.map(w => w.id === id ? { ...w, c, name: null } : w); });
    nameLater(id);
  }

  function removePoint(id) {
    if (guard()) return;
    M.closePopup();
    S.commit(s => {
      const i = s.waypoints.findIndex(w => w.id === id);
      const prev = s.legs[i - 1];
      if (prev && prev.kind === 'route') s._nextRoad = prev.road;
      s.waypoints.splice(i, 1);
    });
  }

  function insertOnLeg(i, c) {
    if (guard()) return;
    M.closePopup();
    let newId;
    S.commit(s => {
      const L = s.legs[i];
      const a = s.waypoints.find(w => w.id === L.from), b = s.waypoints.find(w => w.id === L.to);
      const at = L.coords ? U.nearest(L.coords, c) : { point: c, i: 0 };
      const w = { id: U.uid(), c: [at.point[0], at.point[1]], locked: L.kind === 'track' };
      newId = w.id;
      const wi = s.waypoints.findIndex(x => x.id === L.from);
      s.waypoints.splice(wi + 1, 0, w);
      let l1, l2;
      if (L.kind === 'track') {
        const c1 = L.coords.slice(0, at.i + 1).concat([w.c]), c2 = [w.c].concat(L.coords.slice(at.i + 1));
        l1 = { ...E.makeLeg(a, w, s, null), kind: 'track', name: L.name, coords: c1 };
        l2 = { ...E.makeLeg(w, b, s, null), kind: 'track', name: L.name, coords: c2 };
      } else {
        const road = L.kind === 'line' ? 'line' : L.road;
        l1 = E.makeLeg(a, w, s, road); l2 = E.makeLeg(w, b, s, road);
      }
      s.legs.splice(i, 1, l1, l2);
    });
    nameLater(newId);
  }

  function setLegRoad(i, road) {
    if (guard()) return;
    S.commit(s => {
      s.legs = s.legs.slice();
      s.legs[i] = E.invalidate(s.legs[i], road === 'line' ? { kind: 'line', road: null } : { kind: 'route', road });
    });
  }

  function setMode(mode) {
    if (mode === st().mode || guard()) return;
    S.commit(s => {
      s.mode = mode;
      const r = E.defaultRoad(mode);
      s.legs = s.legs.map(L => L.kind === 'route' ? E.invalidate(L, { mode, road: r }) : L);
    });
  }

  function reverse() {
    if (st().waypoints.length < 2 || guard()) return;
    S.commit(s => {
      s.waypoints = s.waypoints.slice().reverse();
      s.legs = s.legs.slice().reverse().map(L => {
        const sw = { from: L.to, to: L.from, fromC: L.toC, toC: L.fromC };
        return L.kind === 'track' ? E.invalidate(L, { ...sw, coords: L.coords.slice().reverse() }) : E.invalidate(L, sw);
      });
    });
    UI.toast('Parcours inversé');
  }

  function clearAll() {
    if (!st().waypoints.length || guard()) return;
    const n = st().waypoints.length;
    UI.modal({
      title: 'Tout effacer ?',
      body: `<p class="muted">Le parcours « ${U.esc(st().name)} » (${n} point${n > 1 ? 's' : ''}) sera effacé. Tu pourras le récupérer avec le bouton Annuler.</p>`,
      actions: [{ label: 'Garder' }, {
        label: 'Tout effacer', primary: true, danger: true, onClick: () => {
          if (guard()) return;
          S.commit(s => { s.waypoints = []; s.legs = []; s.name = 'Mon parcours'; });
          UI.toast('Parcours effacé : touche Annuler pour le récupérer');
        }
      }]
    });
  }

  // Coupures du signal GPS : écart anormal entre deux points d'un tracé enregistré
  const GAP = 1200;
  function splitGaps(coords) {
    const out = [[coords[0]]];
    for (let i = 1; i < coords.length; i++) {
      if (U.dist(coords[i - 1], coords[i]) > GAP) out.push([coords[i - 1]]);
      out[out.length - 1].push(coords[i]);
    }
    // le morceau commencé par le point d'avant la coupure démarre en fait au point suivant
    return out.map((p, k) => k ? p.slice(1) : p).filter(p => p.length > 1);
  }
  const countGaps = c => { let n = 0; for (let i = 1; i < c.length; i++) if (U.dist(c[i - 1], c[i]) > GAP) n++; return n; };

  function addItems(items, { replace, connect, fill }) {
    if (guard()) return;
    S.commit(s => {
      if (replace) { s.waypoints = []; s.legs = []; }
      for (const it of items) {
        const all = it.reversed ? it.coords.slice().reverse() : it.coords;
        if (it.type === 'points') {
          all.forEach(c => s.waypoints.push({ id: U.uid(), c }));
          continue;
        }
        const parts = fill ? splitGaps(all) : [all];
        parts.forEach((coords, pk) => {
        const start = coords[0], end = coords[coords.length - 1];
        const last = s.waypoints[s.waypoints.length - 1];
        let a;
        if (!last) { a = { id: U.uid(), c: start, locked: true }; s.waypoints.push(a); }
        else if (U.dist(last.c, start) < 150) {   // extrémités quasi jointes : pas de liaison à calculer
          a = last;
          if (!last.locked) { last.c = start; last.locked = true; }
        } else {
          a = { id: U.uid(), c: start, locked: true, gap: pk > 0 || undefined };
          s.waypoints.push(a);
          if (pk > 0) s.legs.push(E.makeLeg(last, a, s, null));          // coupure GPS : comblée par la route
          else if (!connect) s.legs.push(E.makeLeg(last, a, s, 'line'));
        }
        const b = { id: U.uid(), c: end, locked: true, name: null, gap: pk < parts.length - 1 || undefined };
        s.waypoints.push(b);
        s.legs.push({ ...E.makeLeg(a, b, s, null), kind: 'track', road: null, name: it.name, coords: [a.c].concat(coords.slice(1, -1), [b.c]) });
        });
      }
    });
    st().waypoints.forEach(w => { if (!w.name && !w.gap) nameLater(w.id); });
    setTimeout(fitAll, 50);
  }

  function nameLater(id) {
    const w = st().waypoints.find(x => x.id === id);
    if (!w) return;
    const c = w.c;
    T.providers.geocode.reverse(c).then(name => {
      if (!name) return;
      const cur = st().waypoints.find(x => x.id === id);
      if (cur && U.same(cur.c, c) && !cur.name) S.silent(s => { s.waypoints = s.waypoints.map(x => x.id === id ? { ...x, name } : x); });
    });
  }

  function fitAll() {
    const comb = A.combine(st());
    const pts = comb.coords.length ? comb.coords : st().waypoints.map(w => w.c);
    M.fit(pts);
  }

  // ---------- Choix du type de route ----------
  function askRoad(i, fromAdd) {
    const s = st(), L = s.legs[i];
    if (!L || L.kind === 'track') return;
    UI.roadChooser({
      title: `Tronçon ${i + 1} · préférer :`, mode: s.mode, current: L.road, kind: L.kind,
      autoShown: L.road === 'auto' && L.an && L.an.comp ? T.panel.roadOf(L, s.mode).id : null,
      onPick: road => {
        const cur = st().legs[i];
        if (!cur) return;
        if ((road === 'line' && cur.kind === 'line') || (road === cur.road && cur.kind === 'route')) return;
        setLegRoad(i, road);
      }
    });
  }

  // ---------- Fenêtres sur la carte ----------
  function legPopup(i, c) {
    const s = st(), L = s.legs[i];
    if (!L) return;
    const comb = A.combine(s), r = T.panel.roadOf(L, s.mode);
    let d = comb.starts[i], p = c, head = null;
    if (L.coords && L.status === 'ok') {
      const n = U.nearest(L.coords, c);
      d += n.d; p = n.point;
      head = U.headingAt(L.coords, U.cum(L.coords), n.d);
    }
    const e = A.eleAt(comb, d), sl = A.slopeAt(comb, d);
    const el = document.createElement('div');
    el.className = 'pop';
    el.innerHTML = `<div class="pop-h"><span class="cart" style="--c:${r.color};--ci:${r.ink}">${U.esc(r.short)}</span><b>Tronçon ${i + 1} · ${U.esc(L.kind === 'track' ? (L.name || r.label) : r.label)}</b></div>
      <p class="pop-m">km ${U.nf(d / 1000, 1)}${e != null ? ` · ${U.nf(e)} m · pente ${sl > 0 ? '+' : ''}${U.nf(sl, 0)} %` : ''}</p>
      <div class="pop-a">
        <a class="btn btn-sm" href="${U.streetViewUrl(p, head)}" target="_blank" rel="noopener">${I('eye')}Street View</a>
        ${S.locked ? '' : `<button class="btn btn-sm" data-a="ins">${I('plus')}Point ici</button>
        <button class="btn btn-sm" data-a="end">${I('append')}Continuer ici</button>
        ${L.kind !== 'track' ? `<button class="btn btn-sm" data-a="road">${I('route')}Préférer…</button>` : ''}`}
      </div>`;
    el.addEventListener('click', ev => {
      const a = ev.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'ins') insertOnLeg(i, p);
      if (a.dataset.a === 'end') { M.closePopup(); addPoint(p); }
      if (a.dataset.a === 'road') { M.closePopup(); askRoad(i); }
    });
    M.openPopup(p, el);
  }

  function wpPopup(id) {
    const s = st(), i = s.waypoints.findIndex(w => w.id === id), w = s.waypoints[i];
    if (!w) return;
    const label = T.io.export.wpName(w, i, s.waypoints.length);
    const el = document.createElement('div');
    el.className = 'pop';
    el.innerHTML = `<div class="pop-h"><b>${U.esc(label)}</b></div>
      ${S.locked ? '<p class="pop-m">Tracé verrouillé</p>' : w.locked ? '<p class="pop-m">Extrémité d’un tracé importé</p>' : '<p class="pop-m">Glissez le point pour le déplacer</p>'}
      <div class="pop-a">
        <a class="btn btn-sm" href="${U.streetViewUrl(w.c)}" target="_blank" rel="noopener">${I('eye')}Street View</a>
        ${S.locked ? '' : `<button class="btn btn-sm btn-danger" data-a="del">${I('trash')}Supprimer</button>`}
      </div>`;
    const del = el.querySelector('[data-a="del"]');
    if (del) del.addEventListener('click', () => removePoint(id));
    M.openPopup(w.c, el);
  }

  // ---------- Rendu ----------
  let raf = 0;
  const render = () => { if (!raf) raf = requestAnimationFrame(doRender); };

  function legFeatures(s) {
    const colorBy = T.settings.get().colorBy, feats = [];
    s.legs.forEach((L, i) => {
      if (L.status !== 'ok' || !L.coords) {
        feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [L.fromC, L.toC] }, properties: { leg: i, pending: true, error: L.status === 'error' } });
        return;
      }
      if (colorBy === 'slope' && L.samples && L.samples.length > 1) {
        const c = U.cum(L.coords), Sm = L.samples;
        let j = 0, cur = null;
        for (let k = 0; k < L.coords.length - 1; k++) {
          const mid = (c[k] + c[k + 1]) / 2;
          while (j < Sm.length - 2 && Sm[j + 1].d < mid) j++;
          const cls = A.slopeClass(Sm[j].s);
          if (!cur || cur.cls !== cls) { cur = { cls, coords: [L.coords[k]] }; feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: cur.coords }, properties: { leg: i, color: T.config.slopeColors[cls] } }); }
          cur.coords.push(L.coords[k + 1]);
        }
      } else {
        // Couleur = voie réellement empruntée (autoroute bleu, nationale rouge, départementale jaune…),
        // plus claire sur le plat, plus foncée dans les pentes raides
        const c = U.cum(L.coords), Sm = L.samples || [];
        const R = L.kind !== 'line' && L.an && L.an.runs && L.an.runs.length ? L.an.runs : null;
        const base = T.panel.roadOf(L, s.mode).color;
        const col = g => (A.GROUPS.find(x => x.id === g) || { color: base }).color;
        let j = 0, q = 0, cur = null;
        for (let k = 0; k < L.coords.length - 1; k++) {
          const mid = (c[k] + c[k + 1]) / 2;
          if (R) while (j < R.length - 1 && R[j].d + R[j].len < mid) j++;
          if (Sm.length > 1) while (q < Sm.length - 2 && Sm[q + 1].d < mid) q++;
          const g = R ? R[j].g : null, cls = Sm.length > 1 ? A.slopeClass(Sm[q].s) : 2, key = g + ':' + cls;
          if (!cur || cur.key !== key) {
            cur = { key, coords: [L.coords[k]] };
            feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: cur.coords }, properties: { leg: i, color: shade(R ? col(g) : base, cls) } });
          }
          cur.coords.push(L.coords[k + 1]);
        }
      }
    });
    return feats;
  }

  // Éclaircit (plat) ou fonce (raide) une couleur
  const SHADE = [0.55, 0.28, 0, -0.3, -0.52];
  const shadeCache = new Map();
  function shade(hex, cls) {
    const k = hex + cls;
    if (shadeCache.has(k)) return shadeCache.get(k);
    const v = parseInt(hex.slice(1), 16), f = SHADE[cls];
    const ch = x => Math.round(f >= 0 ? x + (255 - x) * f : x * (1 + f));
    const out = '#' + [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => ch(x).toString(16).padStart(2, '0')).join('');
    shadeCache.set(k, out);
    return out;
  }

  function doRender() {
    raf = 0;
    const s = st(), sum = A.summary(s), comb = A.combine(s);
    T.hooks.alerts.forEach(f => { try { f(s, sum, comb); } catch (e) { console.warn(e); } });
    sum.alerts.sort((x, y) => (x.lvl === y.lvl ? x.d - y.d : x.lvl === 'warn' ? -1 : 1));
    setAccent(accent());
    document.querySelectorAll('.modes [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode)));
    M.setLegs(legFeatures(s));
    M.syncMarkers(s.waypoints);
    M.setAlerts(sum.alerts.map(a => {
      const c = U.at(comb.coords, comb.cum, a.d);
      return c ? { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { text: a.text, lvl: a.lvl } } : null;
    }).filter(Boolean));

    const has = s.waypoints.length > 0;
    $('#app').classList.toggle('has-route', has);
    $('#summary').innerHTML = has ? T.panel.summary(sum, s) : T.panel.empty(s.mode);
    $('#composition').innerHTML = T.panel.composition(sum);
    $('#alerts').innerHTML = T.panel.alerts(sum);
    $('#legs').innerHTML = s.waypoints.length === 1
      ? '<p class="hint-inline">Ajoutez un deuxième point pour tracer le premier tronçon.</p>' : T.panel.legs(s);
    const nm = $('#route-name');
    if (document.activeElement !== nm) nm.value = s.name;
    $('[data-act="undo"]').disabled = S.locked || !S.canUndo();
    $('[data-act="redo"]').disabled = S.locked || !S.canRedo();
    const numMode = ['num', 'dot', 'off'].includes(T.settings.get().nums) ? T.settings.get().nums : 'num';
    $('#app').classList.toggle('hide-nums', numMode === 'dot'); $('#app').classList.toggle('nums-off', numMode === 'off');
    const nb = $('#tool-nums'), lab = { num: 'Points numérotés', dot: 'Points sans numéro', off: 'Tracé seul (points masqués)' }[numMode];
    if (nb.dataset.m !== numMode) { nb.dataset.m = numMode; nb.innerHTML = I({ num: 'hash', dot: 'dots', off: 'hashoff' }[numMode]); }
    nb.title = lab + ' — toucher pour changer'; nb.setAttribute('aria-label', lab);
    const lk = $('#tool-lock');
    if (lk.getAttribute('aria-pressed') !== String(S.locked)) {
      lk.setAttribute('aria-pressed', String(S.locked));
      lk.innerHTML = I(S.locked ? 'lock' : 'unlock');
      lk.title = S.locked ? 'Déverrouiller le tracé' : 'Verrouiller le tracé (évite les modifications involontaires)';
      lk.setAttribute('aria-label', S.locked ? 'Déverrouiller le tracé' : 'Verrouiller le tracé');
      $('#app').classList.toggle('trace-locked', S.locked);
    }
    $('#tool-slope').setAttribute('aria-pressed', String(T.settings.get().colorBy === 'slope'));
    $('#calc').hidden = !s.legs.some(l => l.status === 'pending');   // jauge : routes en cours de calcul
    const lg = $('#slope-legend'), bySlope = T.settings.get().colorBy === 'slope';
    lg.hidden = !(bySlope && A.combine(s).coords.length);   // légende affichée seulement quand la couleur par pente est active
    lg.innerHTML = bySlope
      ? '<b>Pente</b>' + T.config.slopeColors.map((c, k) => `<span><i style="background:${c}"></i>${T.config.slopeLabels[k]}</span>`).join('')
      : '<b>Pente</b>' + [0, 2, 4].map(k => `<span><i class="sh">${['#1f5fbf', '#d7261e', '#f5c400'].map(c => `<em style="background:${shade(c, k)}"></em>`).join('')}</i>${['plat', 'moyenne', 'raide'][k / 2]}</span>`).join('');
    T.profile.set({ samples: comb.samples, total: comb.total, comb, marks: comb.starts, accent: accent() });
    T.hooks.render.forEach(f => { try { f(s, sum, comb); } catch (e) { console.warn(e); } });
  }

  // ---------- Dialogues ----------
  async function handleFiles(files) {
    const items = [], errs = [];
    for (const f of files) {
      try { items.push(...await T.io.parse.file(f)); } catch (e) { errs.push(e.message); }
    }
    errs.forEach(m => UI.toast(m, 'error', 6000));
    if (items.length) importDialog(items);
  }

  // Ordre automatique des tracés importés : enchaîne les extrémités les plus proches
  // (chemin le plus court entre fin d'un tracé et début du suivant, calcul exact jusqu'à 12 tracés).
  function autoOrder(items) {
    const on = items.filter(i => !i.off), off = items.filter(i => i.off);
    const n = on.length;
    if (n < 2) return { items: on.concat(off), changed: false };
    const ends = on.map(i => i.reversed ? [i.coords[i.coords.length - 1], i.coords[0]] : [i.coords[0], i.coords[i.coords.length - 1]]);
    // Noms de fichiers « départ-arrivée » (Liberty Rider…) : si l'arrivée de l'un est le départ de l'autre, liaison favorisée
    const nm = on.map(i => (i.file || '').toLowerCase().replace(/\.[^.]+$/, '').replace(/[-_ ]\d+$/, '').split(/[-_ ]+/));
    const chain = (a, b) => {
      const x = nm[a], y = nm[b];
      for (let k = 1; k < x.length; k++) {
        const t = x.slice(k);
        if (t.join('').length >= 4 && t.length < y.length && t.every((w, q) => w === y[q])) return true;
      }
      return false;
    };
    const G = on.map((_, a) => on.map((_, b) => U.dist(ends[a][1], ends[b][0]) * (chain(a, b) ? 0.25 : 1)));
    const g = (a, b) => G[a][b];
    let order;
    if (n <= 12) {
      const N = 1 << n, cost = new Float64Array(N * n).fill(Infinity), prev = new Int8Array(N * n).fill(-1);
      for (let i = 0; i < n; i++) cost[(1 << i) * n + i] = 0;
      for (let m = 1; m < N; m++) for (let i = 0; i < n; i++) {
        const c = cost[m * n + i];
        if (c === Infinity) continue;
        for (let j = 0; j < n; j++) {
          if (m & (1 << j)) continue;
          const k = (m | (1 << j)) * n + j, v = c + g(i, j);
          if (v < cost[k]) { cost[k] = v; prev[k] = i; }
        }
      }
      let best = 0;
      for (let i = 1; i < n; i++) if (cost[(N - 1) * n + i] < cost[(N - 1) * n + best]) best = i;
      order = [];
      for (let m = N - 1, i = best; i >= 0;) { order.unshift(i); const p = prev[m * n + i]; m &= ~(1 << i); i = p; }
    } else {
      const left = new Set(on.map((_, k) => k));
      order = [0]; left.delete(0);
      while (left.size) {
        const a = order[order.length - 1];
        let b = -1;
        left.forEach(j => { if (b < 0 || g(a, j) < g(a, b)) b = j; });
        order.push(b); left.delete(b);
      }
    }
    return { items: order.map(k => on[k]).concat(off), changed: order.some((k, i) => k !== i) };
  }

  function importDialog(items) {
    let ord = autoOrder(items);
    items = ord.items;
    const hasRoute = st().waypoints.length > 0;
    const body = document.createElement('div');
    const draw = () => {
      const dups = items.filter(i => i.dup).length;
      body.innerHTML = `<p class="muted">Cochez les tracés à garder et réglez leur ordre : ils seront mis bout à bout.</p>
        ${ord.changed ? '<p class="muted small">Ordre réglé automatiquement : chaque tracé commence là où finit le précédent.</p>' : ''}
        ${dups ? `<p class="muted small">${dups > 1 ? `${dups} itinéraires prévus ont été décochés` : 'Un itinéraire prévu a été décoché'} : ils doublent les tracés enregistrés du même fichier.</p>` : ''}
        <ul class="imp">${items.map((it, k) => `<li>
          <label class="chk"><input type="checkbox" data-k="${k}" ${it.off ? '' : 'checked'}>
          <span><b>${U.esc(it.name)}</b><small>${it.type === 'points' ? `${it.coords.length} points de passage (recalculé)` : `Tracé fixe · ${U.nf(it.km, 1)} km${(it.gaps = it.gaps ?? countGaps(it.coords)) ? ` · ${it.gaps} coupure${it.gaps > 1 ? 's' : ''} GPS` : ''}`} · ${U.esc(it.file)}${it.reversed ? ' · inversé' : ''}</small></span></label>
          <span class="imp-b">
            <button class="icon-btn" data-up="${k}" ${k === 0 ? 'disabled' : ''} aria-label="Monter">${I('up')}</button>
            <button class="icon-btn" data-dn="${k}" ${k === items.length - 1 ? 'disabled' : ''} aria-label="Descendre">${I('down')}</button>
            <button class="icon-btn" data-rv="${k}" aria-label="Inverser le sens">${I('swap')}</button>
          </span></li>`).join('')}</ul>
        <button class="btn btn-sm" data-more="1">${I('plus')}Ajouter un autre fichier</button>
        <label class="chk"><input type="checkbox" id="imp-fill" ${T.settings.get().fillGaps !== false ? 'checked' : ''}> Combler les coupures du signal GPS par la route (sinon en ligne droite)</label>
        <label class="chk"><input type="checkbox" id="imp-connect" ${T.settings.get().autoConnect ? 'checked' : ''}> Relier les tracés entre eux par la route (sinon en ligne droite)</label>
        ${hasRoute ? '<label class="chk"><input type="checkbox" id="imp-replace"> Remplacer le parcours actuel (sinon, ajout à la fin)</label>' : ''}`;
    };
    draw();
    body.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.more) {
        // Certains téléphones n'autorisent qu'un fichier à la fois : on complète la liste sans fermer la fenêtre
        const inp = document.createElement('input');
        inp.type = 'file'; inp.multiple = true;
        inp.onchange = async () => {
          const seen = new Set(items.map(i => i.file));
          for (const f of inp.files) {
            if (seen.has(f.name)) { UI.toast(`${f.name} est déjà dans la liste`); continue; }
            try { items.push(...await T.io.parse.file(f)); } catch (err) { UI.toast(err.message, 'error', 6000); }
          }
          ord = autoOrder(items); items = ord.items; draw();
        };
        inp.click();
        return;
      }
      const sw = (a, c) => { [items[a], items[c]] = [items[c], items[a]]; draw(); };
      if (b.dataset.up) sw(+b.dataset.up, +b.dataset.up - 1);
      if (b.dataset.dn) sw(+b.dataset.dn, +b.dataset.dn + 1);
      if (b.dataset.rv) { items[+b.dataset.rv].reversed = !items[+b.dataset.rv].reversed; draw(); }
    });
    body.addEventListener('change', e => { if (e.target.dataset.k) items[+e.target.dataset.k].off = !e.target.checked; });
    UI.modal({
      title: 'Importer des tracés', body, wide: true,
      actions: [{ label: 'Annuler' }, {
        label: 'Ajouter au parcours', primary: true, onClick: root => {
          const pick = items.filter(i => !i.off);
          if (!pick.length) { UI.toast('Aucun tracé sélectionné', 'error'); return false; }
          const connect = $('#imp-connect', root).checked, rep = $('#imp-replace', root);
          const fill = $('#imp-fill', root).checked;
          T.settings.set({ autoConnect: connect, fillGaps: fill });
          addItems(pick, { replace: rep ? rep.checked : false, connect, fill });
          UI.toast(`${pick.length} élément${pick.length > 1 ? 's' : ''} importé${pick.length > 1 ? 's' : ''}`);
        }
      }]
    });
  }

  function gmapsDialog() {
    UI.modal({
      title: 'Importer depuis Google Maps',
      body: `<p class="muted">Dans Google Maps, calculez votre itinéraire puis copiez son adresse (barre d’adresse sur ordinateur). Les étapes et les points glissés sont repris, puis l’itinéraire est recalculé ici avec le type de route de votre choix.</p>
        <textarea id="gm-url" rows="4" placeholder="https://www.google.com/maps/dir/…"></textarea>
        <p class="muted small">Les liens courts (maps.app.goo.gl) doivent d’abord être ouverts dans le navigateur pour obtenir l’adresse complète.</p>
        ${st().waypoints.length ? '<label class="chk"><input type="checkbox" id="gm-replace" checked> Remplacer le parcours actuel</label>' : ''}`,
      actions: [{ label: 'Annuler' }, {
        label: 'Importer', primary: true, onClick: root => {
          const url = $('#gm-url', root).value, rep = $('#gm-replace', root);
          let parsed;
          try { parsed = T.io.parse.gmaps(url); } catch (e) { UI.toast(e.message, 'error', 6000); return false; }
          resolveStops(parsed, rep ? rep.checked : false);
        }
      }]
    });
  }

  async function resolveStops(parsed, replace) {
    UI.toast('Lecture du lien…');
    const pts = [];
    for (const s of parsed.stops) {
      if (s.c) { pts.push({ c: s.c, name: s.label || null }); continue; }
      try {
        const r = await T.providers.geocode.search(s.q, M.center());
        if (r[0]) pts.push({ c: r[0].c, name: r[0].label }); else UI.toast(`Lieu introuvable : ${s.q}`, 'error', 6000);
      } catch (e) { UI.toast(`Recherche impossible pour : ${s.q}`, 'error'); }
    }
    if (pts.length < 2) { UI.toast('Pas assez d’étapes reconnues dans ce lien', 'error'); return; }
    if (guard()) return;
    S.commit(s => {
      if (replace) { s.waypoints = []; s.legs = []; }
      pts.forEach(p => s.waypoints.push({ id: U.uid(), c: p.c, name: p.name && p.name.length < 40 ? p.name.split(',')[0] : null }));
    });
    st().waypoints.forEach(w => { if (!w.name) nameLater(w.id); });
    setTimeout(fitAll, 50);
    UI.toast(`${pts.length} étapes importées${parsed.vias ? ` (dont ${parsed.vias} points de passage)` : ''}`);
  }

  function exportDialog() {
    const s = st();
    if (!A.combine(s).coords.length) { UI.toast('Rien à exporter pour le moment', 'error'); return; }
    if (s.legs.some(l => l.status === 'pending')) UI.toast('Des tronçons sont encore en calcul : ils ne seront pas inclus');
    const gm = T.io.export.googleMapsUrl(s);
    UI.modal({
      title: 'Exporter le parcours',
      body: `<label class="field"><span>Nom du fichier</span><input id="ex-name" value="${U.esc(T.io.export.safeName(s.name))}"></label>
        <fieldset class="radios"><legend>Contenu du GPX</legend>
          <label><input type="radio" name="ex-k" value="trk" checked><span><b>Trace</b><small>Recommandé : GPS moto, Garmin, Zepp, Strava, Liberty Rider…</small></span></label>
          <label><input type="radio" name="ex-k" value="rte"><span><b>Itinéraire</b><small>Pour les GPS qui recalculent (TomTom…), avec points de guidage</small></span></label>
          <label><input type="radio" name="ex-k" value="both"><span><b>Les deux</b></span></label>
          <label><input type="radio" name="ex-k" value="lr"><span><b>Liberty Rider</b><small>Un seul fichier, 99 points au plus (limite de Liberty Rider) : il recalcule la route entre eux</small></span></label>
        </fieldset>
        <label class="chk"><input type="checkbox" id="ex-wpt" checked> Inclure les étapes comme points d’intérêt</label>
        ${gm ? `<p class="muted small">Autre option : <a href="${gm}" target="_blank" rel="noopener">ouvrir dans Google Maps</a> (approximatif, Google recalcule à sa façon).</p>` : ''}`,
      actions: [{ label: 'Annuler' }, {
        label: 'Télécharger le GPX', primary: true, onClick: root => {
          const k = root.querySelector('input[name="ex-k"]:checked').value;
          const txt = T.io.export.gpx(st(), k === 'lr' ? { rte: true } : { trk: k !== 'rte', rte: k !== 'trk', wpt: $('#ex-wpt', root).checked });
          const fn = (T.io.export.safeName($('#ex-name', root).value) || 'parcours') + '.gpx';
          T.io.export.download(fn, txt, 'application/gpx+xml');
          UI.toast('GPX téléchargé : ' + fn);
        }
      }]
    });
  }

  function libraryDialog() {
    const body = document.createElement('div');
    const draw = () => {
      const list = T.storage.library.list();
      body.innerHTML = `<div class="save-row"><input id="lib-name" value="${U.esc(st().name)}" aria-label="Nom du parcours"><button class="btn btn-primary" data-save>${I('save')}Enregistrer</button></div>
        ${list.length ? `<ul class="lib">${list.map(e => `<li>
          <span class="lib-m">${I(e.mode)}</span>
          <span class="lib-t"><b>${U.esc(e.name)}</b><small>${U.nf(e.km, 1)} km · ${new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</small></span>
          <button class="btn btn-sm" data-open="${e.id}">Ouvrir</button>
          <span class="lib-del" data-id="${e.id}"><button class="icon-btn" data-ask="${e.id}" aria-label="Supprimer ${U.esc(e.name)}">${I('trash')}</button></span></li>`).join('')}</ul>`
          : '<p class="muted">Aucun parcours enregistré pour l’instant. Ils restent dans ce navigateur, sur cet appareil.</p>'}`;
    };
    draw();
    body.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.more) {
        // Certains téléphones n'autorisent qu'un fichier à la fois : on complète la liste sans fermer la fenêtre
        const inp = document.createElement('input');
        inp.type = 'file'; inp.multiple = true;
        inp.onchange = async () => {
          const seen = new Set(items.map(i => i.file));
          for (const f of inp.files) {
            if (seen.has(f.name)) { UI.toast(`${f.name} est déjà dans la liste`); continue; }
            try { items.push(...await T.io.parse.file(f)); } catch (err) { UI.toast(err.message, 'error', 6000); }
          }
          ord = autoOrder(items); items = ord.items; draw();
        };
        inp.click();
        return;
      }
      if (b.hasAttribute('data-save')) {
        const name = $('#lib-name', body).value.trim() || 'Mon parcours';
        S.silent(s => { s.name = name; });
        try { T.storage.library.save(st(), A.summary(st()).distance); UI.toast('Parcours enregistré'); T.sync.auto(); draw(); }
        catch (err) { UI.toast('Stockage du navigateur plein : supprimez d’anciens parcours', 'error', 6000); }
      }
      if (b.dataset.open) {
        const data = T.storage.library.get(b.dataset.open);
        if (data) { if (guard()) return; S.replace(data); UI.close(); setTimeout(fitAll, 50); }
      }
      if (b.dataset.ask) {
        const slot = b.parentElement;
        slot.innerHTML = `<span class="lib-conf">Supprimer ce parcours ? <button class="btn btn-sm btn-danger" data-confdel="${b.dataset.ask}">Supprimer</button> <button class="btn btn-sm" data-cancel>Annuler</button></span>`;
        return;
      }
      if (b.hasAttribute('data-cancel')) { draw(); return; }
      if (b.dataset.confdel) {
        T.storage.library.remove(b.dataset.confdel);
        UI.toast('Parcours supprimé');
        T.sync.auto();
        draw();
        return;
      }
    });
    UI.modal({ title: 'Mes parcours', body, wide: true });
  }

  function settingsDialog() {
    const s = T.settings.get();
    const pace = `${Math.floor(s.runPace)}:${String(Math.round((s.runPace % 1) * 60)).padStart(2, '0')}`;
    UI.modal({
      title: 'Réglages',
      body: `<label class="field"><span>Route préférée par défaut (${U.esc(T.config.modes[st().mode].label)})</span><select id="set-road">${[T.config.kinds.auto, ...T.config.modes[st().mode].roads].map(r => `<option value="${r.id}" ${r.id === E.defaultRoad(st().mode) ? 'selected' : ''}>${U.esc(r.label)}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" id="set-snap" ${s.snapMain ? 'checked' : ''}> Moto et vélo : placer les nouveaux points sur la route principale la plus proche</label>
        <label class="field"><span>Allure de course (min:s par km)</span><input id="set-pace" value="${pace}" inputmode="numeric" placeholder="6:00"></label>
        <label class="field"><span>Autonomie de la moto (km, pour l’alerte carburant)</span><input id="set-fuel" type="number" min="50" max="900" value="${s.fuelRange}"></label>
        <label class="field"><span>Vitesse moyenne à vélo (km/h)</span><input id="set-bike" type="number" min="8" max="45" value="${s.bikeSpeed}"></label>
        <fieldset class="radios"><legend>Couleur de l’appli</legend><div class="swatches">${[['auto', 'Automatique : une couleur par activité'], ...T.config.palette].map(([c, n]) => `<label title="${U.esc(n)}"><input type="radio" name="set-accent" value="${c}" aria-label="${U.esc(n)}" ${(s.accent || 'auto') === c ? 'checked' : ''}><i style="--c:${c === 'auto' ? '#ff4d00' : c}" class="${c === 'auto' ? 'sw-auto' : ''}"></i></label>`).join('')}</div></fieldset>
        <label class="field"><span>Fond de carte</span><select id="set-style">${T.config.map.styles.map(x => `<option value="${x.id}" ${x.id === s.mapStyle ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
        <p class="muted small">Tout fonctionne gratuitement avec des services ouverts (OpenStreetMap, Valhalla, Open-Meteo, Photon). Vos parcours restent dans votre navigateur. Version ${T.config.version}.</p>`,
      actions: [{ label: 'Annuler' }, {
        label: 'Enregistrer', primary: true, onClick: root => {
          const m = $('#set-pace', root).value.trim().match(/^(\d{1,2})(?:[:.,h'](\d{1,2}))?$/);
          const runPace = m ? U.clamp(+m[1] + (m[2] ? +m[2] / 60 : 0), 2.5, 20) : s.runPace;
          const bikeSpeed = U.clamp(+$('#set-bike', root).value || s.bikeSpeed, 8, 45);
          const style = $('#set-style', root).value;
          const accentPick = ($('input[name="set-accent"]:checked', root) || {}).value || 'auto';
          const speedChanged = runPace !== s.runPace || bikeSpeed !== s.bikeSpeed;
          T.settings.set({ snapMain: $('#set-snap', root).checked, runPace, bikeSpeed, mapStyle: style, accent: accentPick,
            fuelRange: U.clamp(+$('#set-fuel', root).value || s.fuelRange, 50, 900),
            lastRoad: { ...s.lastRoad, [st().mode]: $('#set-road', root).value } });
          M.setStyle(style);
          if (speedChanged && st().mode !== 'moto') {
            S.commit(x => { x.legs = x.legs.map(L => L.kind === 'route' ? E.invalidate(L) : L); });
          } else render();
        }
      }],
      onClose: render
    });
    // Aperçu immédiat de la couleur ; « Annuler » ou fermer rétablit la couleur choisie (via render)
    document.querySelectorAll('input[name="set-accent"]').forEach(r => r.addEventListener('change', () => {
      const c = /^#/.test(r.value) ? r.value : T.config.modes[st().mode].accent;
      setAccent(c);
    }));
  }

  function syncDialog() {
    const SY = T.sync, ago = t => t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais';
    const wrap = document.createElement('div');
    const fail = e => UI.toast('Synchronisation impossible (' + (e && e.message === 'Failed to fetch' ? 'hors ligne ou service indisponible' : e.message) + ')');
    const draw = () => {
      const c = SY.code();
      wrap.innerHTML = c ? `
        <p>Votre code personnel :</p>
        <p class="sync-code" id="sync-code">${U.esc(c)}</p>
        <p class="muted">Saisissez-le sur un autre appareil (menu « ⋯ » → Retrouver mes parcours) pour y retrouver vos parcours enregistrés. Gardez-le secret : toute personne qui le connaît peut lire vos parcours.</p>
        <p class="muted">Dernière synchronisation : ${ago(T.settings.get().syncAt)}. Les parcours sont fusionnés (le plus récent l’emporte) ; une suppression n’est pas répercutée sur les autres appareils.</p>
        <div class="sync-btns"><button class="btn btn-primary" data-s="run">Synchroniser maintenant</button><button class="btn" data-s="copy">Copier le code</button><button class="btn btn-danger" data-s="off">Arrêter</button></div>`
      : `
        <p>Retrouvez vos parcours enregistrés sur un autre appareil, sans compte ni mot de passe.</p>
        <div class="sync-btns"><button class="btn btn-primary" data-s="new">Créer mon code</button></div>
        <p class="muted" style="margin-top:16px">J’ai déjà un code :</p>
        <div class="sync-join"><input id="sync-in" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" maxlength="14" aria-label="Code"><button class="btn" data-s="join">Utiliser</button></div>`;
    };
    wrap.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-s]'); if (!b) return;
      const s = b.dataset.s; b.disabled = true;
      try {
        if (s === 'new') { T.settings.set({ syncCode: SY.create() }); const r = await SY.run(); UI.toast(r.total ? 'Code créé, parcours envoyés' : 'Code créé'); }
        else if (s === 'join') {
          const c = SY.norm($('#sync-in', wrap).value);
          if (!SY.valid(c)) { UI.toast('Code invalide (12 caractères)'); b.disabled = false; return; }
          const r = await SY.run(SY.fmt(c)); T.settings.set({ syncCode: SY.fmt(c) });
          UI.toast(r.added > 0 ? r.added + ' parcours récupéré' + (r.added > 1 ? 's' : '') : 'Code enregistré');
        }
        else if (s === 'run') { const r = await SY.run(); UI.toast('Synchronisé : ' + r.total + ' parcours'); }
        else if (s === 'copy') { try { await navigator.clipboard.writeText(SY.code()); UI.toast('Code copié'); } catch (e) { UI.toast('Copie impossible'); } }
        else if (s === 'off') { T.settings.set({ syncCode: '' }); UI.toast('Synchronisation arrêtée (vos parcours restent ici)'); }
      } catch (e) { if (s === 'new') T.settings.set({ syncCode: '' }); fail(e); }
      draw();
    });
    draw();
    UI.modal({ title: 'Retrouver mes parcours', body: wrap, actions: [{ label: 'Fermer' }] });
  }

  function helpDialog() {
    const rows = [
      ['Carte', [['undo', 'Annuler', 'Annule la dernière modification (Ctrl+Z).'], ['redo', 'Rétablir', 'Rétablit ce que vous venez d’annuler (Ctrl+Y).'],
        ['fit', 'Voir tout le parcours', 'Cadre la carte sur l’ensemble du tracé.'], ['append', 'Ajouter à la fin', 'Chaque clic ajoute un point au bout du parcours, même sur le tracé (utile pour un aller-retour).'],
        ['slope', 'Pente', 'Colore le tracé selon la pente.'], ['layers', 'Fond de carte', 'Change l’aspect de la carte.'], ['locate', 'Me localiser', 'Centre la carte sur votre position.'],
        ['play', 'Parcourir le tracé', 'Un point se déplace sur le tracé du début à la fin : pause, reprise, vitesse, recommencer, ou faites glisser la barre.'], ['hash', 'Points du tracé', 'Chaque appui change l’affichage : points numérotés, points sans numéro, puis tracé seul (aucun point).'], ['lock', 'Verrouiller', 'Empêche toute modification du tracé par erreur.'], ['help', 'Aide', 'Affiche cette page.']]],
      ['Panneau du parcours', [['download', 'Importer', 'Ouvre un fichier GPX pour le charger sur la carte.'], ['link', 'Partager', 'Crée un lien vers votre parcours.'],
        ['upload', 'Exporter GPX', 'Enregistre le parcours en fichier GPX pour votre GPS ou votre montre.'], ['more', 'Plus d’options', 'Mes parcours, boucle, road-book, inverser le sens, Google Maps, réglages, tout effacer.'], ['link', 'Retrouver mes parcours (code)', 'Crée un code personnel pour retrouver vos parcours enregistrés sur un autre appareil. Gardez-le secret : il donne accès à vos parcours.']]]
    ];
    UI.modal({
      title: 'À quoi servent les boutons ?', wide: true,
      body: rows.map(([h, items]) => `<h3 class="help-h">${h}</h3><ul class="help-list">${items.map(([ic, n, d]) => `<li><span class="help-ic">${I(ic)}</span><div><b>${n}</b><span>${d}</span></div></li>`).join('')}</ul>`).join(''),
      actions: [{ label: 'Compris', primary: true }]
    });
  }

  function moreMenu(btn) {
    const r = btn.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'menu';
    const items = [
      ['library', 'folder', 'Mes parcours'], ['loop', 'route', 'Créer une boucle'], ['roadbook', 'save', 'Road-book (imprimer / PDF)'],
      ['gmaps', 'gmaps', 'Importer un lien Google Maps'], ['reverse', 'swap', 'Inverser le sens'],
      ['openGmaps', 'gmaps', 'Ouvrir dans Google Maps'], ['fit', 'fit', 'Voir tout le parcours'],
      ['sync', 'link', 'Retrouver mes parcours (code)'], ['settings', 'gear', 'Réglages'], ['clear', 'trash', 'Tout effacer']
    ];
    el.innerHTML = items.map(([a, ic, l]) => `<button data-act="${a}" class="${a === 'clear' ? 'danger' : ''}">${I(ic)}${l}</button>`).join('');
    document.body.appendChild(el);
    const w = el.offsetWidth, hgt = el.offsetHeight;
    el.style.left = U.clamp(r.right - w, 8, window.innerWidth - w - 8) + 'px';
    el.style.top = (r.top - hgt - 8 > 8 ? r.top - hgt - 8 : r.bottom + 8) + 'px';
    const off = ev => { if (!el.contains(ev.target)) { el.remove(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true));
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-act]');
      if (b) { el.remove(); document.removeEventListener('pointerdown', off, true); act(b.dataset.act, b); }
    });
  }

  // ---------- Délégation des boutons ----------
  function act(a, el) {
    const i = el && el.dataset.i != null ? +el.dataset.i : null;
    switch (a) {
      case 'nums': { const o = ['num', 'dot', 'off'], c = o.indexOf(T.settings.get().nums); T.settings.set({ nums: o[(c + 1) % 3] }); render(); UI.toast({ num: 'Points numérotés', dot: 'Points sans numéro', off: 'Tracé seul' }[T.settings.get().nums], 'info', 1200); break; }
      case 'help': helpDialog(); break;
      case 'sync': syncDialog(); break;
      case 'lock': {
        T.settings.set({ locked: !S.locked });
        S.setLocked(!S.locked);
        M.closePopup(); UI.closeChooser();
        UI.toast(S.locked ? 'Tracé verrouillé' : 'Tracé déverrouillé', 'info', 1800);
        break;
      }
      case 'undo': S.undo(); break;
      case 'redo': S.redo(); break;
      case 'fit': fitAll(); break;
      case 'import': if (!guard()) $('#file-input').click(); break;
      case 'gmaps': if (!guard()) gmapsDialog(); break;
      case 'export': exportDialog(); break;
      case 'library': libraryDialog(); break;
      case 'settings': settingsDialog(); break;
      case 'reverse': reverse(); break;
      case 'clear': clearAll(); break;
      case 'more': moreMenu(el); break;
      case 'openGmaps': {
        const u = T.io.export.googleMapsUrl(st());
        if (u) window.open(u, '_blank', 'noopener'); else UI.toast('Tracez d’abord un parcours', 'error');
        break;
      }
      case 'road': askRoad(i); break;
      case 'retry': E.retry(st().legs[i].id); break;
      case 'focus': {
        const L = st().legs[i];
        M.fit(L.coords && L.coords.length ? L.coords : [L.fromC, L.toC]);
        collapseSheet();
        break;
      }
      case 'goto': {
        const comb = A.combine(st()), c = U.at(comb.coords, comb.cum, +el.dataset.d);
        if (c) { M.flyTo(c, 14); M.setHover(c, accent()); collapseSheet(); }
        break;
      }
      case 'slope': {
        T.settings.set({ colorBy: T.settings.get().colorBy === 'slope' ? 'road' : 'slope' });
        render();
        break;
      }
      case 'style': {
        const L = T.config.map.styles, cur = L.findIndex(x => x.id === T.settings.get().mapStyle);
        const nx = L[(cur + 1) % L.length];
        T.settings.set({ mapStyle: nx.id }); M.setStyle(nx.id); UI.toast('Fond de carte : ' + nx.label, 'info', 1800);
        break;
      }
      case 'append': {
        appendMode = !appendMode;
        M.closePopup();
        $('#app').classList.toggle('append-mode', appendMode);
        $('#tool-append').setAttribute('aria-pressed', String(appendMode));
        UI.toast(appendMode ? 'Ajout à la fin : chaque clic ajoute un point au bout du parcours' : 'Mode ajout désactivé', 'info', 2400);
        break;
      }
      case 'locate': locate(); break;
      case 'sheet': $('#panel').classList.toggle('open'); break;
      default: if (T.hooks.act[a]) T.hooks.act[a](el);
    }
  }
  // Tiroir mobile : glisser la poignée vers le haut / le bas (un appui simple bascule aussi)
  function initSheet() {
    const panel = $('#panel'), handle = panel.querySelector('.sheet-handle');
    let y0 = null, t0 = 0, base = 0, moved = false, suppress = false;
    const peek = () => 132;
    const closedY = () => Math.max(0, panel.offsetHeight - peek());
    handle.addEventListener('pointerdown', e => {
      if (window.innerWidth > 760) return;
      y0 = e.clientY; t0 = Date.now(); moved = false;
      base = panel.classList.contains('open') ? 0 : closedY();
      panel.style.transition = 'none';
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (y0 == null) return;
      const dy = e.clientY - y0;
      if (Math.abs(dy) > 6) moved = true;
      if (moved) panel.style.setProperty('transform', `translateY(${U.clamp(base + dy, 0, closedY())}px)`, 'important');
    });
    const end = e => {
      if (y0 == null) return;
      const dy = e.clientY - y0, v = dy / Math.max(1, Date.now() - t0);
      y0 = null;
      panel.style.transition = '';
      panel.style.removeProperty('transform');
      if (!moved) return;
      suppress = true;
      const open = v < -0.3 ? true : v > 0.3 ? false : base + dy < closedY() / 2;
      panel.classList.toggle('open', open);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('click', e => { if (suppress) { suppress = false; e.stopPropagation(); } });
  }

  const collapseSheet = () => { if (window.innerWidth <= 760) $('#panel').classList.remove('open'); };

  function locate() {
    if (!navigator.geolocation) { UI.toast('Géolocalisation indisponible', 'error'); return; }
    const ok = p => {
      M.flyTo([p.coords.longitude, p.coords.latitude], p.coords.accuracy > 2000 ? 11 : 13);
      if (p.coords.accuracy > 2000) UI.toast(`Position approximative (± ${Math.round(p.coords.accuracy / 1000)} km) : sur PC, le navigateur n’a pas de GPS. Recherchez votre lieu dans la barre pour être précis.`, 'info', 7000);
    };
    const fail = e => UI.toast(e && e.code === 1
      ? 'Localisation refusée pour ce site : autorisez-la (cadenas près de l’adresse → Autorisations) et vérifiez que la localisation du téléphone est activée.'
      : e && e.code === 2 ? 'Position indisponible : activez la localisation du téléphone (GPS) et réessayez.'
      : 'Position introuvable pour le moment : réessayez à l’extérieur ou avec le GPS activé.', 'error', 6000);
    UI.toast('Recherche de votre position…', 'info', 2500);
    navigator.geolocation.getCurrentPosition(ok,
      e => { if (e && e.code === 1) return fail(e); navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }

  // ---------- Recherche ----------
  function initSearch() {
    const input = $('#q'), list = $('#q-results');
    let ctrl = null, results = [], note = '';
    const show = () => {
      list.hidden = !results.length && !note;
      list.innerHTML = note && !results.length ? `<li class="res-note">${U.esc(note)}</li>` : results.map((r, k) => `<li><button class="res" data-k="${k}"><b>${U.esc(r.label)}</b><small>${U.esc(r.sub)}</small></button>
        <button class="icon-btn add" data-add="${k}" title="Ajouter comme point du parcours" aria-label="Ajouter comme point">${I('plus')}</button></li>`).join('');
    };
    const run = U.debounce(async () => {
      const q = input.value.trim();
      if (q.length < 3) { results = []; note = ''; show(); return; }
      if (ctrl) ctrl.abort();
      const my = ctrl = new AbortController();
      note = 'Recherche…'; results = []; show();
      try {
        results = await T.providers.geocode.search(q, M.center(), my.signal);
        note = results.length ? '' : 'Aucun lieu trouvé';
      } catch (e) {
        if (my.signal.aborted) return;
        results = []; note = e.message || 'Recherche indisponible';
      }
      if (my === ctrl) show();
    }, 280);
    input.addEventListener('input', run);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && results[0]) { M.flyTo(results[0].c, 13); results = []; show(); input.blur(); }
      if (e.key === 'Escape') { results = []; show(); input.blur(); }
    });
    list.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.more) {
        // Certains téléphones n'autorisent qu'un fichier à la fois : on complète la liste sans fermer la fenêtre
        const inp = document.createElement('input');
        inp.type = 'file'; inp.multiple = true;
        inp.onchange = async () => {
          const seen = new Set(items.map(i => i.file));
          for (const f of inp.files) {
            if (seen.has(f.name)) { UI.toast(`${f.name} est déjà dans la liste`); continue; }
            try { items.push(...await T.io.parse.file(f)); } catch (err) { UI.toast(err.message, 'error', 6000); }
          }
          ord = autoOrder(items); items = ord.items; draw();
        };
        inp.click();
        return;
      }
      const r = results[+(b.dataset.k ?? b.dataset.add)];
      if (!r) return;
      M.flyTo(r.c, 13);
      if (b.dataset.add != null) addPoint(r.c);
      results = []; show(); input.value = r.label;
    });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('.search')) { results = []; note = ''; show(); } });
  }

  // ---------- Démarrage ----------
  function init() {
    document.querySelectorAll('[data-icon]').forEach(el => { el.insertAdjacentHTML('afterbegin', I(el.dataset.icon)); });
    M.init('map', {
      appendMode: () => appendMode,
      isLocked: () => S.locked,
      mapClick: c => { M.closePopup(); addPoint(c); },
      legClick: (i, c) => { UI.closeChooser(); legPopup(i, c); },
      wpClick: id => { UI.closeChooser(); wpPopup(id); },
      wpMove: (id, c) => movePoint(id, c),
      poiClick: (p, c) => T.hooks.act.poiPopup && T.hooks.act.poiPopup({ dataset: { id: p.id } }, c),
      alertClick: (p, c) => { const el = document.createElement('div'); el.className = 'pop'; el.innerHTML = `<p class="pop-m">${U.esc(p.text)}</p>`; M.openPopup(c, el); }
    });
    T.profile.init($('#profile'), d => {
      if (d == null) { M.setHover(null); return; }
      const comb = A.combine(st());
      M.setHover(U.at(comb.coords, comb.cum, d), accent());
    });
    initSearch();
    initSheet();

    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b && !b.closest('.menu')) act(b.dataset.act, b);
    });
    document.querySelectorAll('.modes [data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('#route-name').addEventListener('change', e => S.silent(s => { s.name = e.target.value.trim() || 'Mon parcours'; }));
    // Android : un filtre par extension (.gpx…) bloque souvent la sélection multiple ; le format est vérifié à l'ouverture
    if (/Android/i.test(navigator.userAgent)) $('#file-input').removeAttribute('accept');
    $('#file-input').addEventListener('change', e => { handleFiles([...e.target.files]); e.target.value = ''; });

    // Glisser-déposer de fichiers
    let dragN = 0;
    const dz = $('#drop-zone');
    window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragN++; dz.classList.add('on'); } });
    window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) dz.classList.remove('on'); });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => { e.preventDefault(); dragN = 0; dz.classList.remove('on'); if (e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]); });

    document.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (e.key === 'Escape') { if (!UI.close()) if (!UI.closeChooser()) M.closePopup(); }
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); S.undo(); }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); S.redo(); }
    });

    T.app = { st, S, render, fitAll, addPoint, accent, nameLater, collapseSheet, act, guard };
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    setTimeout(() => T.sync.auto(), 2500);
    T.hooks.init.forEach(f => { try { f(); } catch (e) { console.warn(e); } });
    S.on(render);
    S.load();
    if (T.settings.get().locked) S.setLocked(true);
    if (st().waypoints.length) setTimeout(fitAll, 400);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
