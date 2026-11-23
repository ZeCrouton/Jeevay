/* Fournisseur d'altitudes : tuiles de relief « Terrarium » (données ouvertes AWS / Mapzen, gratuites, sans clé ni quota).
   L'altitude est lue directement dans les pixels des tuiles, gardées en mémoire : rapide et illimité.
   Open-Meteo n'est plus utilisé ici, pour garder son quota journalier pour la météo.
   Interface : get(points [[lng,lat]], signal) -> [altitude en m] */
window.T = window.T || {};
T.providers = T.providers || {};

T.providers.elevation = (() => {
  const tiles = new Map(); // "z/x/y" -> Promise<Float32Array(256*256)>

  const tileXY = (lng, lat, z) => {
    const n = 2 ** z, r = lat * Math.PI / 180;
    return [(lng + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
  };

  function load(z, x, y, signal) {
    const k = z + '/' + x + '/' + y;
    if (!tiles.has(k)) {
      const p = (async () => {
        const r = await T.util.fetchT(T.config.elevation.url.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal }, 15000);
        if (!r.ok) throw new Error('Altitudes indisponibles (' + r.status + ')');
        const bmp = await createImageBitmap(await r.blob());
        const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        const px = g.getImageData(0, 0, 256, 256).data, out = new Float32Array(256 * 256);
        for (let i = 0; i < out.length; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        return out;
      })();
      p.catch(() => tiles.delete(k));
      tiles.set(k, p);
    }
    return tiles.get(k);
  }

  async function get(points, signal) {
    if (!points.length) return [];
    // Zoom adapté à l'étendue pour limiter le nombre de tuiles (z12 ≈ 30 m de précision)
    let z = T.config.elevation.zoom;
    const count = zz => new Set(points.map(p => tileXY(p[0], p[1], zz).map(Math.floor).join('/'))).size;
    while (z > 8 && count(z) > 120) z--;
    const pos = points.map(p => tileXY(p[0], p[1], z));
    const need = [...new Set(pos.map(([fx, fy]) => Math.floor(fx) + '/' + Math.floor(fy)))];
    const grids = {};
    // 4 tuiles téléchargées à la fois
    let next = 0;
    await Promise.all([0, 1, 2, 3].map(async () => {
      while (next < need.length) {
        const k = need[next++], [x, y] = k.split('/').map(Number);
        grids[k] = await load(z, x, y, signal);
      }
    }));
    return pos.map(([fx, fy]) => {
      const x = Math.floor(fx), y = Math.floor(fy), grid = grids[x + '/' + y];
      // Interpolation bilinéaire dans la tuile
      const px = Math.min(254.999, Math.max(0, (fx - x) * 256 - 0.5)), py = Math.min(254.999, Math.max(0, (fy - y) * 256 - 0.5));
      const i = Math.floor(px), j = Math.floor(py), tx = px - i, ty = py - j;
      const v = (a, b) => grid[b * 256 + a];
      const e = v(i, j) * (1 - tx) * (1 - ty) + v(i + 1, j) * tx * (1 - ty) + v(i, j + 1) * (1 - tx) * ty + v(i + 1, j + 1) * tx * ty;
      return Math.max(-50, Math.round(e * 10) / 10);
    });
  }

  return { get };
})();
