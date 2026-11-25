/* Export GPX (trace et/ou itinéraire) et lien vers Google Maps. */
window.T = window.T || {};
T.io = T.io || {};

T.io.export = (() => {
  const U = T.util, A = T.analysis;

  function wpName(w, i, n) {
    if (w.name) return w.name;
    return i === 0 ? 'Départ' : i === n - 1 ? 'Arrivée' : 'Étape ' + i;
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
    // Étapes : sans les points techniques (coupures GPS comblées), 99 au plus (limite de Liberty Rider et de nombreux GPS)
    const real = state.waypoints.map((w, i) => ({ w, i })).filter(({ w, i }) => !w.gap || i === 0 || i === n - 1);
    real.forEach((x, j) => { x.label = wpName(x.w, j, real.length) + (x.w.night && !x.w.name ? ' (nuit)' : '') + (x.w.pause && !x.w.name ? ' (pause)' : ''); });
    const mine = real.filter(({ i }) => inR(wd(i)));
    if (opts.wpt) thin(mine, MAX).forEach(({ w, label }) => L.push(pt('wpt', w.c, `<name>${U.esc(label)}</name>`)));
    if (opts.rte) {
      // Étapes + points de guidage réguliers pour que le GPS suive les mêmes routes, 99 points au plus
      const keep = thin(mine, MAX).map(({ i, label }) => ({ d: Math.round(wd(i)), i, label }));
      const len = r1 - r0, G = Math.max(0, Math.min(Math.floor(len / 5000), MAX - keep.length - 2));
      const ds = keep.slice();
      const edge = d => { if (!keep.some(x => Math.abs(x.d - d) < 50)) ds.push({ d, i: -1 }); };
      if (opts.range) { edge(r0); edge(r1); }
      for (let k = 1; k <= G; k++) {
        const d = Math.round(r0 + len * k / (G + 1));
        if (!keep.some(x => Math.abs(x.d - d) < 1000)) ds.push({ d, i: -1 });
      }
      ds.sort((a, b) => a.d - b.d);
      L.push(`<rte><name>${name}</name>`);
      let g = 0;
      thin(ds, MAX).forEach(({ d, i, label }) => {
        const c = i >= 0 ? state.waypoints[i].c : U.at(comb.coords, comb.cum, d);
        if (!c) return;
        L.push(pt('rtept', c, `<name>${U.esc(i >= 0 ? label : 'Guidage ' + (++g))}</name>`));
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

  // Ouvre l'itinéraire dans Google Maps (approximation : départ, arrivée et 8 points intermédiaires)
  function googleMapsUrl(state) {
    const comb = A.combine(state);
    if (comb.coords.length < 2) return null;
    const f = c => c[1].toFixed(5) + ',' + c[0].toFixed(5);
    const via = [];
    for (let k = 1; k <= 8; k++) via.push(U.at(comb.coords, comb.cum, comb.total * k / 9));
    const mode = { moto: 'driving', velo: 'bicycling', run: 'walking' }[state.mode];
    return 'https://www.google.com/maps/dir/?api=1&origin=' + f(comb.coords[0]) +
      '&destination=' + f(comb.coords[comb.coords.length - 1]) +
      '&waypoints=' + encodeURIComponent(via.map(f).join('|')) + '&travelmode=' + mode;
  }

  return { gpx, download, safeName, googleMapsUrl, wpName };
})();
