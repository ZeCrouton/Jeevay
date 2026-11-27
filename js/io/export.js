/* Export GPX (trace et/ou itinéraire) et lien vers Google Maps. */
window.T = window.T || {};
T.io = T.io || {};

T.io.export = (() => {
  const U = T.util, A = T.analysis;

  // « Point de passage » : force la route sans être une étape (une nuit ou une pause en refait une étape)
  const isVia = (w, i, n) => !!w.via && !w.night && !w.pause && i > 0 && i < n - 1;
  const isStep = (w, i, n) => i === 0 || i === n - 1 || (!w.gap && !isVia(w, i, n));
  // Numéro d'une étape : les points de passage et les coupures GPS ne comptent pas
  const stepNo = (wps, i) => wps.slice(1, i + 1).filter((w, k) => isStep(w, k + 1, wps.length)).length;
  // Tronçons regroupés d'une étape à la suivante (idx : numéros des tronçons, dans l'ordre)
  const groups = (wps, idx) => idx.reduce((g, i) => {
    const last = g[g.length - 1];
    if (last && last[last.length - 1] === i - 1 && isVia(wps[i], i, wps.length)) last.push(i); else g.push([i]);
    return g;
  }, []);
  // wps (facultatif) : liste complète des points, pour numéroter sans les points de passage
  function wpName(w, i, n, wps) {
    if (w.name) return w.name;
    if (i === 0) return 'Départ';
    if (i === n - 1) return 'Arrivée';
    return wps && isVia(w, i, n) ? 'Point de passage' : 'Étape ' + (wps ? stepNo(wps, i) : i);
  }
  const MAX = 99;
  // Garde au plus « max » éléments, en conservant le premier et le dernier, répartis régulièrement
  const thin = (arr, max) => arr.length <= max ? arr : Array.from({ length: max }, (_, k) => arr[Math.round(k * (arr.length - 1) / (max - 1))]);
  const pt = (tag, c, inner = '') => `<${tag} lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${inner}</${tag}>`;

  // opts : trk, rte, wpt (contenu) ; range [d0, d1] en mètres pour n'exporter qu'une portion (une journée) ; title
  function gpx(state, opts) {
    const comb = A.combine(state), name = U.esc(opts.title || state.name || 'Parcours'), n = state.waypoints.length;
    const [r0, r1] = opts.range || [0, comb.total];
    const inR = d => d >= r0 - 1 && d <= r1 + 1;
    const L = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<gpx version="1.1" creator="${T.config.appName}" xmlns="http://www.topografix.com/GPX/1/1">`,
      `<metadata><name>${name}</name><time>${new Date().toISOString()}</time></metadata>`
    ];
    const wd = i => i === n - 1 ? comb.total : (comb.starts[i] ?? 0);
    // Étapes : sans les points techniques (coupures GPS comblées) ni les points de passage, 99 au plus (limite de Liberty Rider et de nombreux GPS)
    const real = state.waypoints.map((w, i) => ({ w, i })).filter(({ w, i }) => isStep(w, i, n));
    real.forEach((x, j) => { x.label = wpName(x.w, j, real.length) + (x.w.night && !x.w.name ? ' (nuit)' : '') + (x.w.pause && !x.w.name ? ' (pause)' : ''); });
    const mine = real.filter(({ i }) => inR(wd(i)));
    if (opts.wpt) thin(mine, MAX).forEach(({ w, label }) => L.push(pt('wpt', w.c, `<name>${U.esc(label)}</name>`)));
    if (opts.rte) {
      // Étapes + points de guidage réguliers pour que le GPS suive les mêmes routes, 99 points au plus
      const keep = thin(mine, MAX).map(({ i, label }) => ({ d: Math.round(wd(i)), i, label }));
      // Les points de passage restent dans l'itinéraire comme points de guidage
      const vias = state.waypoints.map((w, i) => ({ w, i, d: Math.round(wd(i)) })).filter(x => isVia(x.w, x.i, n) && inR(x.d)).map(({ i, d }) => ({ d, i, via: true }));
      const len = r1 - r0, G = Math.max(0, Math.min(Math.floor(len / 5000), MAX - keep.length - vias.length - 2));
      const ds = keep.concat(thin(vias, Math.max(2, MAX - keep.length)));
      const edge = d => { if (!keep.some(x => Math.abs(x.d - d) < 50)) ds.push({ d, i: -1 }); };
      if (opts.range) { edge(r0); edge(r1); }
      for (let k = 1; k <= G; k++) {
        const d = Math.round(r0 + len * k / (G + 1));
        if (!ds.some(x => x.i >= 0 && Math.abs(x.d - d) < 1000)) ds.push({ d, i: -1 });
      }
      ds.sort((a, b) => a.d - b.d);
      L.push(`<rte><name>${name}</name>`);
      let g = 0;
      thin(ds, MAX).forEach(({ d, i, label, via }) => {
        const c = i >= 0 ? state.waypoints[i].c : U.at(comb.coords, comb.cum, d);
        if (!c) return;
        L.push(pt('rtept', c, `<name>${U.esc(i >= 0 && !via ? label : 'Guidage ' + (++g))}</name>`));
      });
      L.push('</rte>');
    }
    if (opts.trk) {
      L.push(`<trk><name>${name}</name><trkseg>`);
      const ptE = (c, d) => { const e = A.eleAt(comb, d); L.push(pt('trkpt', c, e != null ? `<ele>${e.toFixed(1)}</ele>` : '')); };
      if (opts.range) { const c = U.at(comb.coords, comb.cum, r0); if (c) ptE(c, r0); }
      comb.coords.forEach((c, k) => {
        const d = comb.cum[k];
        if (opts.range ? d > r0 && d < r1 : true) ptE(c, d);
      });
      if (opts.range) { const c = U.at(comb.coords, comb.cum, r1); if (c) ptE(c, r1); }
      L.push('</trkseg></trk>');
    }
    L.push('</gpx>');
    return L.join('\n');
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  const safeName = s => (s || 'parcours').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'parcours';

  /* Google Maps n'accepte que quelques points par lien et recalcule la route entre eux.
     Pour suivre au mieux le tracé : points aux étapes et là où il s'écarte le plus de la ligne droite,
     répartis en autant de liens (« parties ») que nécessaire. */
  const MAXPARTS = 12;
  // Distances (m) des points transmis. fixed : étapes à reprendre ; tol : écart toléré ; gap : espacement maximal
  function keyDistances(comb, fixed, tol, gap) {
    const base = [0, ...fixed.filter(d => d > 300 && d < comb.total - 300), comb.total]
      .sort((a, b) => a - b).filter((d, k, a) => !k || d - a[k - 1] > 300 || d === comb.total);
    const out = [0];
    // Point du tracé (entre les distances a et b) le plus éloigné de la droite qui les relie
    const farthest = (a, b) => {
      const p = U.at(comb.coords, comb.cum, a), q = U.at(comb.coords, comb.cum, b);
      const kx = Math.cos(p[1] * Math.PI / 180) * 111320, ky = 110540;
      const vx = (q[0] - p[0]) * kx, vy = (q[1] - p[1]) * ky, len = vx * vx + vy * vy;
      let best = { off: 0, d: null };
      comb.coords.forEach((c, k) => {
        const d = comb.cum[k];
        if (d < a + 500 || d > b - 500) return;
        const x = (c[0] - p[0]) * kx, y = (c[1] - p[1]) * ky;
        const t = len ? U.clamp((x * vx + y * vy) / len, 0, 1) : 0, off = Math.hypot(x - t * vx, y - t * vy);
        if (off > best.off) best = { off, d };
      });
      return best;
    };
    const split = (a, b, depth) => {
      const f = depth < 12 ? farthest(a, b) : { off: 0, d: null };
      const m = f.d != null && f.off > tol ? f.d : b - a > gap ? (a + b) / 2 : null;
      if (m == null) { out.push(b); return; }
      split(a, m, depth + 1); split(m, b, depth + 1);
    };
    for (let k = 1; k < base.length; k++) split(base[k - 1], base[k], 0);
    return out;
  }

  // Liens Google Maps successifs [{ url, from, to }] (distances en m) ; maxVia : points intermédiaires par lien
  function googleMapsParts(state, maxVia) {
    const comb = A.combine(state), n = state.waypoints.length;
    if (comb.coords.length < 2) return [];
    const fixed = state.waypoints.map((w, i) => ({ w, i })).filter(({ w, i }) => i > 0 && i < n - 1 && !w.gap)
      .map(({ i }) => comb.starts[i]);
    const size = maxVia + 1;
    let tol = 700, gap = 25000, ds = keyDistances(comb, fixed, tol, gap);
    // Trop de parties : on tolère des écarts plus grands (les étapes, elles, sont toujours gardées)
    for (let k = 0; k < 10 && ds.length - 1 > size * MAXPARTS; k++) { tol *= 1.5; gap *= 1.5; ds = keyDistances(comb, fixed, tol, gap); }
    const f = d => { const c = U.at(comb.coords, comb.cum, d); return c[1].toFixed(5) + ',' + c[0].toFixed(5); };
    const mode = { moto: 'driving', velo: 'bicycling', run: 'walking' }[state.mode];
    const parts = [];
    for (let k = 0; k < ds.length - 1; k += size) {
      const p = ds.slice(k, k + size + 1), via = p.slice(1, -1);
      parts.push({
        from: p[0], to: p[p.length - 1],
        url: 'https://www.google.com/maps/dir/?api=1&origin=' + f(p[0]) + '&destination=' + f(p[p.length - 1]) +
          (via.length ? '&waypoints=' + encodeURIComponent(via.map(f).join('|')) : '') + '&travelmode=' + mode
      });
    }
    return parts;
  }

  return { gpx, download, safeName, googleMapsParts, wpName, isVia, isStep, stepNo, groups };
})();
