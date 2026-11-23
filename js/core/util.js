window.T = window.T || {};

T.util = (() => {
  const R = 6371008.8;
  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;

  const dist = (a, b) => {
    const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  };

  const bearing = (a, b) => {
    const p1 = rad(a[1]), p2 = rad(b[1]), dl = rad(b[0] - a[0]);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  };

  const angleDiff = (a, b) => ((b - a + 540) % 360) - 180;

  const cum = coords => {
    const c = [0];
    for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + dist(coords[i - 1], coords[i]));
    return c;
  };

  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  // Index du dernier élément de arr (trié) dont key(x) <= v
  function search(arr, v, key = x => x) {
    let lo = 0, hi = arr.length - 1;
    if (hi < 0) return -1;
    if (v < key(arr[0])) return -1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (key(arr[m]) <= v) lo = m; else hi = m - 1;
    }
    return lo;
  }

  // Point situé à la distance d le long de coords (c = distances cumulées)
  function at(coords, c, d) {
    const n = coords.length;
    if (!n) return null;
    if (d <= 0) return [coords[0][0], coords[0][1]];
    if (d >= c[n - 1]) return [coords[n - 1][0], coords[n - 1][1]];
    const i = search(c, d);
    const seg = c[i + 1] - c[i];
    return lerp(coords[i], coords[i + 1], seg ? (d - c[i]) / seg : 0);
  }

  function headingAt(coords, c, d) {
    const a = at(coords, c, Math.max(0, d - 15)), b = at(coords, c, d + 15);
    return a && b ? bearing(a, b) : 0;
  }

  function resample(coords, step) {
    const c = cum(coords), total = c[c.length - 1] || 0;
    const n = Math.max(1, Math.round(total / step));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const d = total * i / n;
      pts.push({ d, c: at(coords, c, d) });
    }
    return { pts, total };
  }

  function nearest(coords, p) {
    if (coords.length < 2) return { i: 0, t: 0, point: coords[0], d: 0 };
    const c = cum(coords), kx = Math.cos(rad(p[1]));
    let best = { dd: Infinity, i: 0, t: 0 };
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const ax = (a[0] - p[0]) * kx, ay = a[1] - p[1];
      const vx = (b[0] - a[0]) * kx, vy = b[1] - a[1];
      const L = vx * vx + vy * vy;
      let t = L ? -(ax * vx + ay * vy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const x = ax + vx * t, y = ay + vy * t, dd = x * x + y * y;
      if (dd < best.dd) best = { dd, i, t };
    }
    const point = lerp(coords[best.i], coords[best.i + 1], best.t);
    return { i: best.i, t: best.t, point, d: c[best.i] + (c[best.i + 1] - c[best.i]) * best.t };
  }

  // Polyline encodée (précision 6 pour Valhalla), ordre lat,lng dans la chaîne
  function decode(str, precision = 6) {
    const f = 10 ** precision, out = [];
    let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      let b, shift = 0, result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      out.push([lng / f, lat / f]);
    }
    return out;
  }

  function encode(coords, precision = 6) {
    const f = 10 ** precision;
    let out = '', pLat = 0, pLng = 0;
    const enc = v => {
      v = v < 0 ? ~(v << 1) : (v << 1);
      let s = '';
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      return s + String.fromCharCode(v + 63);
    };
    for (const p of coords) {
      const la = Math.round(p[1] * f), ln = Math.round(p[0] * f);
      out += enc(la - pLat) + enc(ln - pLng);
      pLat = la; pLng = ln;
    }
    return out;
  }

  const nf = (n, d = 0) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtKm = m => m < 1000 ? nf(Math.round(m)) + ' m' : nf(m / 1000, m < 100000 ? 1 : 0) + ' km';
  const fmtDur = s => {
    if (!isFinite(s) || s <= 0) return '—';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60), r = m % 60;
    return h + ' h ' + String(r).padStart(2, '0');
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const same = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Point à une distance (m) et un cap (°) donnés
  function destination(c, d, brg) {
    const dr = d / R, b = rad(brg), p1 = rad(c[1]), l1 = rad(c[0]);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
    return [((deg(l2) + 540) % 360) - 180, deg(p2)];
  }

  // Simplification Douglas-Peucker (tolérance en mètres)
  function simplify(coords, tol) {
    if (coords.length < 3) return coords.slice();
    const kx = Math.cos(rad(coords[0][1])) * 111320, ky = 110540;
    const P = coords.map(c => [c[0] * kx, c[1] * ky]);
    const keep = new Uint8Array(coords.length);
    keep[0] = keep[coords.length - 1] = 1;
    const stack = [[0, coords.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let md = 0, mi = -1;
      const [ax, ay] = P[a], [bx, by] = P[b], vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
      for (let i = a + 1; i < b; i++) {
        const [x, y] = P[i];
        let t = L ? ((x - ax) * vx + (y - ay) * vy) / L : 0;
        t = Math.max(0, Math.min(1, t));
        const dx = x - (ax + vx * t), dy = y - (ay + vy * t), dd = dx * dx + dy * dy;
        if (dd > md) { md = dd; mi = i; }
      }
      if (mi > 0 && md > tol * tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return coords.filter((_, i) => keep[i]);
  }

  const streetViewUrl = (c, heading) =>
    `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c[1].toFixed(6)},${c[0].toFixed(6)}` +
    (heading != null ? `&heading=${Math.round(heading)}` : '');

  return { dist, bearing, angleDiff, cum, lerp, search, at, headingAt, resample, nearest, decode, encode,
    nf, fmtKm, fmtDur, esc, uid, same, debounce, clamp, streetViewUrl, destination, simplify };
})();
