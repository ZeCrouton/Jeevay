/* Export GPX (trace et/ou itinéraire) et lien vers Google Maps. */
window.T = window.T || {};
T.io = T.io || {};

T.io.export = (() => {
  const U = T.util, A = T.analysis;

  function wpName(w, i, n) {
    if (w.name) return w.name;
    return i === 0 ? 'Départ' : i === n - 1 ? 'Arrivée' : 'Étape ' + i;
  }
  const pt = (tag, c, inner = '') => `<${tag} lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${inner}</${tag}>`;

  function gpx(state, opts) {
    const comb = A.combine(state), name = U.esc(state.name || 'Parcours'), n = state.waypoints.length;
    const L = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<gpx version="1.1" creator="${T.config.appName}" xmlns="http://www.topografix.com/GPX/1/1">`,
      `<metadata><name>${name}</name><time>${new Date().toISOString()}</time></metadata>`
    ];
    if (opts.wpt) state.waypoints.forEach((w, i) => L.push(pt('wpt', w.c, `<name>${U.esc(wpName(w, i, n))}</name>`)));
    if (opts.rte) {
      // Points de passage + points de guidage réguliers pour que le GPS suive les mêmes routes
      const step = Math.max(5000, comb.total / 120);
      const marks = new Set(comb.starts.map(d => Math.round(d)));
      for (let d = step; d < comb.total - step / 2; d += step) marks.add(Math.round(d));
      const ds = [...marks].sort((a, b) => a - b);
      L.push(`<rte><name>${name}</name>`);
      ds.forEach((d, k) => {
        const c = U.at(comb.coords, comb.cum, d);
        if (!c) return;
        const wi = comb.starts.findIndex(x => Math.round(x) === d);
        const nm = wi >= 0 && state.waypoints[wi] ? wpName(state.waypoints[wi], wi, n) : 'Guidage ' + k;
        L.push(pt('rtept', c, `<name>${U.esc(nm)}</name>`));
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
