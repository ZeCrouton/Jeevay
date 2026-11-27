/* Carte (MapLibre + OpenFreeMap) : tracé, points, alertes, survol. */
window.T = window.T || {};

T.map = (() => {
  let map, ready = false, h = {}, popup = null;
  const markers = new Map();
  const last = { legs: null, alerts: null, hover: null };
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  const W = extra => ['interpolate', ['linear'], ['zoom'], 5, 3 + extra, 10, 4.5 + extra, 15, 8 + extra];

  function init(el, handlers) {
    h = handlers;
    const st = T.settings.get();
    const style = T.config.map.styles.find(s => s.id === st.mapStyle) || T.config.map.styles[0];
    map = new maplibregl.Map({
      container: el, style: style.style || style.url, center: T.config.map.center, zoom: T.config.map.zoom,
      attributionControl: false, dragRotate: false, pitchWithRotate: false
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution: 'Itinéraires <a href="https://valhalla.github.io/valhalla/" target="_blank">Valhalla</a> / FOSSGIS · Altitudes <a href="https://open-meteo.com" target="_blank">Open-Meteo</a> · Recherche <a href="https://photon.komoot.io" target="_blank">Photon</a>'
    }), 'bottom-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('style.load', () => { addLayers(); ready = true; flush(); });
    map.on('click', onClick);
    map.on('mousemove', e => {
      if (!ready) return;
      const f = map.queryRenderedFeatures(box(e.point, 6), { layers: ['tj-hit', 'tj-alerts', 'tj-poi'] });
      map.getCanvas().style.cursor = f.length ? 'pointer' : '';
    });
    return map;
  }

  const box = (p, r) => [[p.x - r, p.y - r], [p.x + r, p.y + r]];

  // Icône de point d'attention dessinée à la volée : triangle arrondi, liseré blanc, point d'exclamation
  function alertIcon(fill, ink) {
    const S = 52, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(S / 2, 6); g.lineTo(S - 6, S - 9); g.lineTo(6, S - 9); g.closePath();
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 4; g.shadowOffsetY = 1;
    g.lineWidth = 9; g.strokeStyle = '#fff'; g.stroke();
    g.shadowColor = 'transparent';
    g.fillStyle = fill; g.fill();
    g.lineWidth = 3; g.strokeStyle = fill; g.stroke();
    g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 4.5;
    g.beginPath(); g.moveTo(S / 2, 19); g.lineTo(S / 2, 32); g.stroke();
    g.beginPath(); g.arc(S / 2, 38.5, 2.6, 0, 7); g.fill();
    return g.getImageData(0, 0, S, S);
  }

  // Pictos des lieux (tracés en trait blanc sur pastille colorée)
  const GLYPH = {
    food: ['M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M9 3v6M17 21V3c-2 1-3.5 4-3.5 8h3.5'],
    fuel: ['M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 21h12M7 7h6v4H7zM15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3'],
    view: ['M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z', 'M12 17a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z'],
    sleep: ['M3 11.5 12 4l9 7.5M5.5 10v10h13V10M10 20v-5.5h4V20'],
    pass: ['M3 19 9.5 8l3.5 6 2-3L21 19H3Z'],
    water: ['M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.200 6-10.500 6-10.500Z'],
    bike: ['M14.500 6.500a4.500 4.500 0 0 1-6 6L4 17l3 3 4.500-4.500a4.500 4.500 0 0 0 6-6l-3 3-2-2 3-3Z'],
    wc: ['M8 4a2 2 0 1 0 0 .01M5 21v-8l-1-3h8l-1 3v8M17 4a2 2 0 1 0 0 .01M14.500 21v-6h-1.500l1.800-5h4.400l1.800 5H19.500v6']
  };
  function poiIcon(color, paths) {
    const S = 68, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 5; g.shadowOffsetY = 1.5;
    g.beginPath(); g.arc(S / 2, S / 2, 29, 0, 7); g.fillStyle = color; g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = 4.5; g.strokeStyle = '#fff'; g.stroke();
    g.save(); g.translate(S / 2 - 12 * 1.5, S / 2 - 12 * 1.5); g.scale(1.5, 1.5);
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 2.1; g.lineCap = g.lineJoin = 'round';
    (paths || []).forEach(d => g.stroke(new Path2D(d)));
    g.restore();
    return g.getImageData(0, 0, S, S);
  }

  function addLayers() {
    if (map.getSource('tj-legs')) return;
    map.addSource('tj-legs', { type: 'geojson', data: empty() });
    map.addSource('tj-alerts', { type: 'geojson', data: empty() });
    map.addSource('tj-hover', { type: 'geojson', data: empty() });
    map.addSource('tj-poi', { type: 'geojson', data: empty() });
    const lay = { 'line-cap': 'round', 'line-join': 'round' };
    map.addLayer({ id: 'tj-casing', type: 'line', source: 'tj-legs', filter: ['!=', ['get', 'pending'], true], layout: lay,
      paint: { 'line-color': '#14161b', 'line-opacity': 0.8, 'line-width': W(3.5) } });
    map.addLayer({ id: 'tj-line', type: 'line', source: 'tj-legs', filter: ['!=', ['get', 'pending'], true], layout: lay,
      paint: { 'line-color': ['get', 'color'], 'line-width': W(0) } });
    map.addLayer({ id: 'tj-pending', type: 'line', source: 'tj-legs', filter: ['==', ['get', 'pending'], true],
      paint: { 'line-color': ['case', ['==', ['get', 'error'], true], '#e03131', '#14161b'], 'line-width': 3, 'line-opacity': 0.75, 'line-dasharray': [1, 1.8] } });
    map.addLayer({ id: 'tj-hit', type: 'line', source: 'tj-legs', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 22 } });
    // Données invisibles (eau et routes) pour refuser les points posés dans la mer ou un plan d'eau, quel que soit le fond de carte
    if (!map.getSource('tj-ovt')) map.addSource('tj-ovt', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
    map.addLayer({ id: 'tj-water', type: 'fill', source: 'tj-ovt', 'source-layer': 'water', paint: { 'fill-opacity': 0 } });
    map.addLayer({ id: 'tj-roads', type: 'line', source: 'tj-ovt', 'source-layer': 'transportation', filter: ['!=', ['get', 'class'], 'ferry'], paint: { 'line-opacity': 0, 'line-width': 1 } });
    const CATS = T.providers.poi.CATS;
    Object.keys(CATS).forEach(k => { const id = 'tj-poi-' + k; if (!map.hasImage(id)) map.addImage(id, poiIcon(CATS[k].color, GLYPH[k]), { pixelRatio: 2 }); });
    map.addLayer({ id: 'tj-poi', type: 'symbol', source: 'tj-poi',
      layout: { 'icon-image': ['concat', 'tj-poi-', ['get', 'cat']], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 11, 1, 15, 1.2] } });
    // Points d'attention : triangles « ! » (rouge = alerte, ambre = information), pour ne pas les confondre avec les lieux (ronds colorés)
    for (const [id, fill, ink] of [['tj-warn', '#d92d20', '#fff'], ['tj-info', '#f5a300', '#14161b']]) if (!map.hasImage(id)) map.addImage(id, alertIcon(fill, ink), { pixelRatio: 2 });
    map.addLayer({ id: 'tj-alerts', type: 'symbol', source: 'tj-alerts',
      layout: { 'icon-image': ['match', ['get', 'lvl'], 'warn', 'tj-warn', 'tj-info'], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 13, 1] } });
    map.addLayer({ id: 'tj-hover', type: 'circle', source: 'tj-hover',
      paint: { 'circle-radius': 7, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 4 } });
  }

  function flush() {
    if (!ready) return;
    if (last.legs) map.getSource('tj-legs').setData(last.legs);
    if (last.alerts) map.getSource('tj-alerts').setData(last.alerts);
    if (last.poi) map.getSource('tj-poi').setData(last.poi);
    map.getSource('tj-hover').setData(last.hover || empty());
  }

  function onClick(e) {
    const c = [e.lngLat.lng, e.lngLat.lat];
    if (ready && !(h.appendMode && h.appendMode())) {
      const f = map.queryRenderedFeatures(box(e.point, 8), { layers: ['tj-poi', 'tj-alerts', 'tj-hit'] });
      const po = f.find(x => x.layer.id === 'tj-poi');
      if (po) return h.poiClick && h.poiClick(po.properties, po.geometry.coordinates);
      const al = f.find(x => x.layer.id === 'tj-alerts');
      if (al) return h.alertClick && h.alertClick(al.properties, c);
      const lg = f.find(x => x.layer.id === 'tj-hit');
      if (lg) return h.legClick(lg.properties.leg, c);
    }
    h.mapClick(c);
  }

  // Vrai si le point tombe dans la mer, un lac ou un grand fleuve (sauf pont, digue ou route à cet endroit)
  function isWater(c) {
    if (!ready || !map.getLayer('tj-water')) return false;
    try {
      const p = map.project(c);
      if (!map.queryRenderedFeatures([[p.x - 1, p.y - 1], [p.x + 1, p.y + 1]], { layers: ['tj-water'] }).length) return false;
      return !map.queryRenderedFeatures(box(p, 9), { layers: ['tj-roads'] }).length;
    } catch (e) { return false; }
  }

  function setPois(features) { last.poi = { type: 'FeatureCollection', features }; flush(); }

  // Capture de la carte (pour le road-book)
  function snapshot() {
    return new Promise(res => {
      const grab = () => {
        map.once('render', () => { try { res(map.getCanvas().toDataURL('image/jpeg', 0.85)); } catch (e) { res(null); } });
        map.triggerRepaint();
      };
      if (map.loaded() && !map.isMoving()) grab(); else map.once('idle', grab);
      setTimeout(() => res(null), 8000);
    });
  }

  function setLegs(features) { last.legs = { type: 'FeatureCollection', features }; flush(); }
  function setAlerts(features) { last.alerts = { type: 'FeatureCollection', features }; flush(); }
  function setHover(c, color) {
    last.hover = c ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { color } }] } : null;
    flush();
  }

  function syncMarkers(wps) {
    const ids = new Set(wps.map(w => w.id));
    for (const [id, m] of markers) if (!ids.has(id)) { m.remove(); markers.delete(id); }
    const n = wps.length;
    let num = 0;   // les points de reprise après une coupure GPS ne sont pas numérotés
    wps.forEach((w, i) => {
      let m = markers.get(w.id);
      if (!m) {
        const el = document.createElement('div');
        el.dataset.id = w.id;
        el.innerHTML = '<button type="button" class="wp"></button>';
        m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(w.c).addTo(map);
        m.on('dragstart', () => { el.dataset.drag = '1'; closePopup(); });
        m.on('dragend', () => {
          const p = m.getLngLat();
          h.wpMove(el.dataset.id, [p.lng, p.lat]);
          setTimeout(() => { delete el.dataset.drag; }, 60);
        });
        el.addEventListener('click', ev => { ev.stopPropagation(); if (!el.dataset.drag) h.wpClick(el.dataset.id); });
        markers.set(w.id, m);
      }
      const el = m.getElement().firstChild;
      const kind = n === 1 ? 'start' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'mid';
      const gap = w.gap && kind === 'mid';
      if (kind === 'mid' && !gap) num++;
      el.className = `wp wp-${kind}${w.locked ? ' wp-locked' : ''}${gap ? ' wp-gap' : ''}${w.night && kind === 'mid' ? ' wp-night' : ''}${w.pause && kind === 'mid' ? ' wp-pause' : ''}`;
      if (w.night && kind === 'mid') el.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13 9a7.500 7.500 0 1 0 9 10.500A8.500 8.500 0 0 1 13 9Z" fill="#fff"/><text x="19" y="15" font-size="12" font-weight="800" fill="#ffd43b" font-family="system-ui,sans-serif">z</text><text x="24.5" y="9" font-size="8.5" font-weight="800" fill="#ffd43b" font-family="system-ui,sans-serif">z</text></svg>';
      else if (w.pause && kind === 'mid') el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z"/><path d="M17 10h1.500a2.500 2.500 0 0 1 0 5H17M8 3v3M12 3v3"/></svg>';
      else el.textContent = i === 0 ? 'D' : i === n - 1 ? 'A' : gap ? '' : String(num);
      el.title = gap ? 'Coupure du signal GPS, comblée par la route' : (w.night && kind === 'mid' ? 'Nuit — ' : '') + (w.pause && kind === 'mid' ? `Pause ${w.pause} min — ` : '') + (w.name ? w.name + ' — ' : '') + (w.locked ? 'extrémité d’un tracé importé' : 'glisser pour déplacer');
      m.setDraggable(!w.locked && !(h.isLocked && h.isLocked()));
      const p = m.getLngLat();
      if (Math.abs(p.lng - w.c[0]) > 1e-9 || Math.abs(p.lat - w.c[1]) > 1e-9) m.setLngLat(w.c);
    });
  }

  function openPopup(c, node) {
    closePopup();
    popup = new maplibregl.Popup({ closeButton: true, offset: 16, maxWidth: '300px', className: 'tj-pop' })
      .setLngLat(c).setDOMContent(node).addTo(map);
    return popup;
  }
  function closePopup() { if (popup) { popup.remove(); popup = null; } }

  function padding() {
    const wide = window.innerWidth > 760;
    return wide ? { top: 90, left: 40, right: 440, bottom: 220 } : { top: 110, left: 30, right: 30, bottom: Math.round(window.innerHeight * 0.38) };
  }
  function fit(coords) {
    if (!coords || !coords.length) return;
    if (coords.length === 1) return map.flyTo({ center: coords[0], zoom: 12 });
    const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
    coords.forEach(c => b.extend(c));
    map.fitBounds(b, { padding: padding(), maxZoom: 15, duration: 600 });
  }
  function flyTo(c, zoom) { map.flyTo({ center: c, zoom: zoom || Math.max(map.getZoom(), 12), duration: 600 }); }
  function setStyle(id) {
    const s = T.config.map.styles.find(x => x.id === id);
    if (!s) return;
    ready = false;
    map.setStyle(s.style || s.url, { diff: false });
  }
  // Point « ma position » : un seul repère, déplacé à chaque nouvelle localisation ; il laisse passer les clics.
  let me = null;
  function setMe(c) {
    if (!me) {
      const el = document.createElement('div');
      el.className = 'me-dot';
      el.setAttribute('aria-label', 'Ma position');
      me = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(c).addTo(map);
    } else me.setLngLat(c);
  }
  // Repère de l'adresse recherchée (épingle rouge, pointe sur la position exacte) ; null pour l'enlever.
  let found = null;
  function setFound(c) {
    if (found) { found.remove(); found = null; }
    if (!c) return;
    found = new maplibregl.Marker({ color: '#e03131' }).setLngLat(c).addTo(map);
    found.getElement().style.pointerEvents = 'none';
    found.getElement().querySelectorAll('*').forEach(e => { e.style.pointerEvents = 'none'; });
  }
  const center = () => { const c = map.getCenter(); return [c.lng, c.lat]; };

  return { init, isWater, setPois, snapshot, setLegs, setAlerts, setHover, syncMarkers, openPopup, closePopup, fit, flyTo, setStyle, setMe, setFound, center, get raw() { return map; } };
})();
