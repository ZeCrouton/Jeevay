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
      container: el, style: style.url, center: T.config.map.center, zoom: T.config.map.zoom,
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
    map.addLayer({ id: 'tj-poi', type: 'circle', source: 'tj-poi',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 4, 13, 7], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'tj-alerts', type: 'circle', source: 'tj-alerts',
      paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
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
      el.className = `wp wp-${kind}${w.locked ? ' wp-locked' : ''}`;
      el.textContent = i === 0 ? 'D' : i === n - 1 ? 'A' : String(i);
      el.title = (w.name ? w.name + ' — ' : '') + (w.locked ? 'extrémité d’un tracé importé' : 'glisser pour déplacer');
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
    map.setStyle(s.url, { diff: false });
  }
  const center = () => { const c = map.getCenter(); return [c.lng, c.lat]; };

  return { init, setPois, snapshot, setLegs, setAlerts, setHover, syncMarkers, openPopup, closePopup, fit, flyTo, setStyle, center, get raw() { return map; } };
})();
