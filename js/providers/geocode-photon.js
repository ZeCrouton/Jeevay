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

  async function search(q, near, signal) {
    let url = `${base()}/api/?q=${encodeURIComponent(q)}&limit=6&lang=fr`;
    if (near) url += `&lat=${near[1].toFixed(4)}&lon=${near[0].toFixed(4)}`;
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error('Recherche indisponible');
    const j = await r.json();
    return (j.features || []).map(f => {
      const l = label(f.properties || {});
      return { label: l.main, sub: l.sub, c: f.geometry.coordinates };
    }).filter(x => x.label);
  }

  async function reverse(c) {
    const k = c[1].toFixed(3) + ',' + c[0].toFixed(3);
    if (revCache.has(k)) return revCache.get(k);
    try {
      const r = await fetch(`${base()}/reverse?lat=${c[1]}&lon=${c[0]}&lang=fr&limit=1`);
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
