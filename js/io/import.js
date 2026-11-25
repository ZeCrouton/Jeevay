/* Import : GPX, KML, GeoJSON et liens d'itinéraire Google Maps.
   Chaque fichier donne une liste d'éléments { name, type: 'track'|'points', coords:[[lng,lat]] } */
window.T = window.T || {};
T.io = T.io || {};

T.io.parse = (() => {
  const U = T.util;

  function clean(coords) {
    const out = [];
    for (const p of coords) {
      const x = +p[0], y = +p[1];
      if (!isFinite(x) || !isFinite(y) || Math.abs(y) > 90 || Math.abs(x) > 180) continue;
      const q = [+x.toFixed(6), +y.toFixed(6)];
      const l = out[out.length - 1];
      if (!l || l[0] !== q[0] || l[1] !== q[1]) out.push(q);
    }
    return out;
  }

  const xml = text => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Fichier illisible');
    return doc;
  };
  const all = (el, tag) => Array.from(el.getElementsByTagNameNS('*', tag));
  const childText = (el, tag) => {
    const c = Array.from(el.children).find(x => x.localName === tag);
    return c ? c.textContent.trim() : '';
  };
  const ll = p => [p.getAttribute('lon'), p.getAttribute('lat')];
  const length = c => { const k = U.cum(c); return k[k.length - 1] || 0; };

  function gpx(text, base) {
    const doc = xml(text), items = [];
    all(doc, 'trk').forEach((t, k) => {
      const c = clean(all(t, 'trkpt').map(ll));
      const n = childText(t, 'name');   // les noms techniques (identifiants) sont remplacés par le nom du fichier
      if (c.length > 1) items.push({ name: n && !/^(track|route|trace)?\s*[0-9a-f-]{20,}$/i.test(n) ? n : base + (k ? ` (${k + 1})` : ''), type: 'track', coords: c });
    });
    const hasTrack = items.length > 0;
    all(doc, 'rte').forEach((r, k) => {
      const c = clean(all(r, 'rtept').map(ll));
      if (c.length < 2) return;
      // Peu de points espacés = points de passage à recalculer ; sinon tracé fixe
      const sparse = length(c) / (c.length - 1) > 800;
      // Fichier avec tracé enregistré + itinéraire prévu (Liberty Rider…) : l'itinéraire est un doublon, décoché par défaut
      items.push({ name: base + ' (itinéraire prévu' + (k ? ' ' + (k + 1) : '') + ')', type: sparse ? 'points' : 'track', coords: c, off: hasTrack, dup: hasTrack });
    });
    if (!items.length) {
      const w = clean(all(doc, 'wpt').map(ll));
      if (w.length > 1) items.push({ name: base + ' (points)', type: 'points', coords: w });
    }
    return items;
  }

  function kml(text, base) {
    const doc = xml(text), items = [], pts = [];
    all(doc, 'Placemark').forEach(pm => {
      const name = childText(pm, 'name') || base;
      const lines = all(pm, 'LineString'), tracks = all(pm, 'Track');
      lines.forEach(ls => {
        const t = (all(ls, 'coordinates')[0] || {}).textContent || '';
        const c = clean(t.trim().split(/\s+/).map(s => s.split(',')));
        if (c.length > 1) items.push({ name, type: 'track', coords: c });
      });
      tracks.forEach(tr => {
        const c = clean(all(tr, 'coord').map(x => x.textContent.trim().split(/\s+/)));
        if (c.length > 1) items.push({ name, type: 'track', coords: c });
      });
      if (!lines.length && !tracks.length) {
        const p = all(pm, 'Point')[0];
        const t = p && (all(p, 'coordinates')[0] || {}).textContent;
        if (t) pts.push(t.trim().split(','));
      }
    });
    if (!items.length && pts.length > 1) items.push({ name: base + ' (points)', type: 'points', coords: clean(pts) });
    return items;
  }

  function geojson(text, base) {
    const j = JSON.parse(text), items = [], pts = [];
    const feats = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{ geometry: j, properties: {} }];
    feats.forEach((f, k) => {
      const g = f.geometry || {}, name = (f.properties && (f.properties.name || f.properties.title)) || base + (k ? ` (${k + 1})` : '');
      if (g.type === 'LineString') items.push({ name, type: 'track', coords: clean(g.coordinates) });
      else if (g.type === 'MultiLineString') g.coordinates.forEach((c, n) => items.push({ name: name + (n ? ` ${n + 1}` : ''), type: 'track', coords: clean(c) }));
      else if (g.type === 'Point') pts.push(g.coordinates);
    });
    if (!items.length && pts.length > 1) items.push({ name: base + ' (points)', type: 'points', coords: clean(pts) });
    return items.filter(i => i.coords.length > 1);
  }

  async function file(f) {
    const name = f.name.replace(/\.[^.]+$/, '');
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext === 'kmz') throw new Error(`${f.name} : format KMZ (compressé). Exportez en KML ou GPX.`);
    if (ext === 'fit') throw new Error(`${f.name} : format FIT non pris en charge. Exportez en GPX.`);
    const text = await f.text();
    const head = text.slice(0, 600).toLowerCase();
    let items;
    try {
      if (ext === 'gpx' || head.includes('<gpx')) items = gpx(text, name);
      else if (ext === 'kml' || head.includes('<kml')) items = kml(text, name);
      else if (ext === 'geojson' || ext === 'json' || head.trim().startsWith('{')) items = geojson(text, name);
      else throw new Error('format non reconnu');
    } catch (e) {
      throw new Error(`${f.name} : ${e.message}`);
    }
    if (!items.length) throw new Error(`${f.name} : aucun tracé trouvé`);
    return items.map(i => ({ ...i, id: U.uid(), file: f.name, reversed: false, km: length(i.coords) / 1000 }));
  }

  // ---------- Liens Google Maps ----------
  const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
  const asCoord = s => { const m = String(s).match(COORD); return m ? [+m[2], +m[1]] : null; };
  const stop = v => { const c = asCoord(v); return c ? { c } : { q: v }; };

  function gmaps(url) {
    url = (url || '').trim();
    if (/(goo\.gl|maps\.app)/i.test(url)) {
      throw new Error('C’est un lien court. Ouvrez-le dans votre navigateur, puis copiez l’adresse complète affichée dans la barre d’adresse.');
    }
    let u;
    try { u = new URL(url); } catch (e) { throw new Error('Ce n’est pas un lien valide.'); }
    if (!/google\./i.test(u.hostname)) throw new Error('Ce lien ne vient pas de Google Maps.');
    const P = u.searchParams;
    if (P.get('api') === '1' && (P.get('destination') || P.get('origin'))) {
      const out = [];
      if (P.get('origin')) out.push(stop(P.get('origin')));
      (P.get('waypoints') || '').split('|').filter(Boolean).forEach(w => out.push(stop(w)));
      if (P.get('destination')) out.push(stop(P.get('destination')));
      return { stops: out, vias: 0 };
    }
    const m = u.pathname.match(/\/maps\/dir\/(.*)$/);
    if (!m) throw new Error('Ce lien ne contient pas d’itinéraire. Dans Google Maps, calculez d’abord un itinéraire puis copiez son lien.');
    const segs = [];
    let data = '';
    m[1].split('/').filter(Boolean).forEach(p => {
      if (p.startsWith('@') || p.startsWith('am=')) return;
      if (p.startsWith('data=')) { data = p.slice(5); return; }
      segs.push(decodeURIComponent(p.replace(/\+/g, ' ')));
    });
    // Jetons de coordonnées dans « data » : étapes nommées et points de passage glissés
    const tokens = [];
    const re = /(!3m\d+!1m2)?!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g;
    let t;
    while ((t = re.exec(data))) tokens.push({ via: !!t[1], c: [+t[2], +t[3]] });
    const named = segs.filter(sg => !asCoord(sg));
    const groups = [];
    tokens.forEach(k => { if (!k.via) groups.push({ c: k.c, vias: [] }); else if (groups.length) groups[groups.length - 1].vias.push(k.c); });
    const out = [];
    let vias = 0;
    if (named.length && groups.length === named.length) {
      let g = 0;
      segs.forEach(sg => {
        const c = asCoord(sg);
        if (c) { out.push({ c }); return; }
        const G = groups[g++];
        out.push({ c: G.c, label: sg });
        G.vias.forEach(v => { out.push({ c: v, via: true }); vias++; });
      });
    } else segs.forEach(sg => out.push(stop(sg)));
    if (out.length < 2) throw new Error('Il faut au moins un départ et une arrivée dans le lien.');
    return { stops: out, vias };
  }

  return { file, gmaps, length };
})();
