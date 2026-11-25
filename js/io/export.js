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

  function gpx(state, opts) {
    const comb = A.combine(state), name = U.esc(state.name || 'Parcours'), n = state.waypoints.length;
    const L = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<gpx version="1.1" creator="${T.config.appName}" xmlns="http://www.topografix.com/GPX/1/1">`,
      `<metadata><name>${name}</name><time>${new Date().toISOString()}</time></metadata>`
    ];
    // Étapes : sans les points techniques (coupures GPS comblées), 99 au plus (limite de Liberty Rider et de nombreux GPS)
    const real = state.waypoints.map((w, i) => ({ w, i })).filter(({ w, i }) => !w.gap || i === 0 || i === n - 1);
    real.forEach((x, j) => { x.label = wpName(x.w, j, real.length); });
    if (opts.wpt) thin(real, MAX).forEach(({ w, label }) => L.push(pt('wpt', w.c, `<name>${U.esc(label)}</name>`)));
    if (opts.rte) {
      // Étapes + points de guidage réguliers pour que le GPS suive les mêmes routes, 99 points au plus
      const keep = thin(real, MAX).map(({ i, label }) => ({ d: Math.round(comb.starts[i] ?? (i === n - 1 ? comb.total : 0)), i, label }));
      const G = Math.max(0, Math.min(Math.floor(comb.total / 5000), MAX - keep.length));
      const ds = keep.slice();
      for (let k = 1; k <= G; k++) {
        const d = Math.round(comb.total * k / (G + 1));
        if (!keep.some(x => Math.abs(x.d - d) < 1000)) ds.push({ d, i: -1 });
      }
      ds.sort((a, b) => a.d - b.d);
      L.push(`<rte><name>${name}</name>`);
      let g = 0;
      ds.forEach(({ d, i, label }) => {
        const c = i >= 0 ? state.waypoints[i].c : U.at(comb.coords, comb.cum, d);
        if (!c) return;
        L.push(pt('rtept', c, `<name>${U.esc(i >= 0 ? label : 'Guidage ' + (++g))}</name>`));
      });
      L.push('</rte>');
    }
    if (opts.trk) {
      L.push(`<trk><name>${name}</name><trkseg>`);
      comb.coords.forEach((c, k) => {
        const e = A.eleAt(comb, comb.cum[k]);
        L.push(pt('trkpt', c, e != null ? `<ele>${e.toFixed(1)}</ele>` : ''));
      });
      L.push('</trkseg></trk>');
    }
    L.push('</gpx>');
    return L.join('\n');
  }


  // ---------- Export par étapes (Liberty Rider…) ----------
  // Liberty Rider limite un roadbook à 99 points et en recrée environ un tous les 7 km : un long parcours
  // doit être découpé. On coupe entre les tracés importés (une journée chacun) ou, sinon, tous les ~200 km.
  function sections(state) {
    const comb = A.combine(state), st = comb.starts, legs = state.legs;
    const cuts = [0];
    let cur = null;
    legs.forEach((L, i) => {
      if (L.kind !== 'track' || !L.name) return;
      if (cur !== null && L.name !== cur && st[i] - cuts[cuts.length - 1] > 20000) cuts.push(st[i]);
      cur = L.name;
    });
    cuts.push(comb.total);
    const out = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], b = cuts[k + 1], n = Math.max(1, Math.round((b - a) / 200000));
      for (let j = 0; j < n; j++) out.push([a + (b - a) * j / n, a + (b - a) * (j + 1) / n]);
    }
    return out.length > 1 || comb.total > 250000 ? out : [[0, comb.total]];
  }

  function gpxRange(state, d0, d1, title) {
    const comb = A.combine(state), name = U.esc(title);
    const c = [U.at(comb.coords, comb.cum, d0)], ds = [d0];
    comb.coords.forEach((p, k) => { if (comb.cum[k] > d0 && comb.cum[k] < d1) { c.push(p); ds.push(comb.cum[k]); } });
    c.push(U.at(comb.coords, comb.cum, d1)); ds.push(d1);
    const len = d1 - d0, G = Math.min(MAX - 2, Math.max(1, Math.round(len / 7000)));
    const L = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<gpx version="1.1" creator="${T.config.appName}" xmlns="http://www.topografix.com/GPX/1/1">`,
      `<metadata><name>${name}</name><time>${new Date().toISOString()}</time></metadata>`,
      `<rte><name>${name}</name>`
    ];
    for (let k = 0; k <= G + 1; k++) {
      const p = U.at(comb.coords, comb.cum, d0 + len * k / (G + 1));
      if (p) L.push(pt('rtept', p, `<name>${k === 0 ? 'Départ' : k === G + 1 ? 'Arrivée' : 'WP' + k}</name>`));
    }
    L.push('</rte>', `<trk><name>${name}</name><trkseg>`);
    c.forEach((p, k) => { if (!p) return; const e = A.eleAt(comb, ds[k]); L.push(pt('trkpt', p, e != null ? `<ele>${e.toFixed(1)}</ele>` : '')); });
    L.push('</trkseg></trk>', '</gpx>');
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

  return { gpx, sections, gpxRange, download, safeName, googleMapsUrl, wpName };
})();
