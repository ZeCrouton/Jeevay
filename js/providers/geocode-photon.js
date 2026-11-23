/* Fournisseur de recherche de lieux : Photon (Komoot, gratuit, sans clé).
   Interface : search(text, near, signal) -> [{ label, sub, c:[lng,lat] }]
               reverse(c) -> nom court | null */
window.T = window.T || {};
T.providers = T.providers || {};

T.providers.geocode = (() => {
  const base = () => T.config.geocode.url;
  const revCache = new Map();

  function label(p) {
    const main = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || '';
    const sub = [p.city !== main ? p.city : null, p.county, p.state, p.country]
      .filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 3).join(', ');
    return { main, sub };
  }

  const cache = new Map();

  async function photon(q, near, signal) {
    let url = `${base()}/api/?q=${encodeURIComponent(q)}&limit=6&lang=fr`;
    if (near) url += `&lat=${near[1].toFixed(4)}&lon=${near[0].toFixed(4)}`;
    const r = await T.util.fetchT(url, { signal }, 6000);
    if (!r.ok) throw new Error('Photon ' + r.status);
    const j = await r.json();
    return (j.features || []).map(f => {
      const l = label(f.properties || {});
      return { label: l.main, sub: l.sub, c: f.geometry.coordinates };
    }).filter(x => x.label);
  }

  async function nominatim(q, near, signal) {
    let url = `${T.config.geocode.fallback}/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&accept-language=fr&addressdetails=1`;
    if (near) {
      const d = 1.5;
      url += `&viewbox=${(near[0] - d).toFixed(3)},${(near[1] + d).toFixed(3)},${(near[0] + d).toFixed(3)},${(near[1] - d).toFixed(3)}`;
    }
    const r = await T.util.fetchT(url, { signal }, 8000);
    if (!r.ok) throw new Error('Nominatim ' + r.status);
    const j = await r.json();
    return j.map(x => {
      const a = x.address || {}, main = x.name || (x.display_name || '').split(',')[0];
      const sub = [a.city || a.town || a.village, a.county, a.state, a.country].filter((v, i, arr) => v && v !== main && arr.indexOf(v) === i).slice(0, 3).join(', ');
      return { label: main, sub, c: [+x.lon, +x.lat] };
    }).filter(x => x.label && isFinite(x.c[0]));
  }

  // Photon (rapide, tolérant aux fautes), puis Nominatim si Photon échoue ou ne trouve rien
  async function search(q, near, signal) {
    const k = q.toLowerCase();
    if (cache.has(k)) return cache.get(k);
    let res = [], err = null;
    try { res = await photon(q, near, signal); } catch (e) { if (signal && signal.aborted) throw e; err = e; }
    if (!res.length) {
      try { res = await nominatim(q, near, signal); err = null; } catch (e) { if (signal && signal.aborted) throw e; err = err || e; }
    }
    if (!res.length && err) throw new Error('Recherche indisponible pour le moment');
    cache.set(k, res);
    return res;
  }

  async function reverse(c) {
    const k = c[1].toFixed(3) + ',' + c[0].toFixed(3);
    if (revCache.has(k)) return revCache.get(k);
    try {
      const r = await T.util.fetchT(`${base()}/reverse?lat=${c[1]}&lon=${c[0]}&lang=fr&limit=1`, {}, 6000);
      if (!r.ok) return null;
      const j = await r.json();
      const p = j.features && j.features[0] && j.features[0].properties;
      const name = p ? (p.city || p.town || p.village || p.locality || p.district || p.name || null) : null;
      revCache.set(k, name);
      return name;
    } catch (e) { return null; }
  }

  return { search, reverse };
})();
