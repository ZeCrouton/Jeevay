/* Fournisseur d'altitudes : Open-Meteo (gratuit, sans clé).
   Interface : get(points [[lng,lat]], signal) -> [altitude en m] */
window.T = window.T || {};
T.providers = T.providers || {};

T.providers.elevation = (() => {
  const cache = new Map();
  const key = p => p[1].toFixed(4) + ',' + p[0].toFixed(4);

  async function get(points, signal) {
    const out = new Array(points.length);
    const need = [];
    points.forEach((p, i) => {
      const k = key(p);
      if (cache.has(k)) out[i] = cache.get(k); else need.push(i);
    });
    const B = T.config.elevation.batch;
    for (let s = 0; s < need.length; s += B) {
      const chunk = need.slice(s, s + B);
      const lat = chunk.map(i => points[i][1].toFixed(5)).join(',');
      const lon = chunk.map(i => points[i][0].toFixed(5)).join(',');
      const r = await fetch(`${T.config.elevation.url}?latitude=${lat}&longitude=${lon}`, { signal });
      if (!r.ok) throw new Error('Altitudes indisponibles');
      const j = await r.json();
      chunk.forEach((i, n) => {
        const v = j.elevation && j.elevation[n];
        out[i] = v == null || isNaN(v) ? null : v;
        cache.set(key(points[i]), out[i]);
      });
    }
    // Comble les trous éventuels (mer, données manquantes)
    let last = out.find(v => v != null) ?? 0;
    for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
    return out;
  }

  return { get };
})();
