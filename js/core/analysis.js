/* Analyse des tronçons : dénivelé, pentes, virages, types de voies, difficultés. */
window.T = window.T || {};

T.analysis = (() => {
  const U = T.util;

  const GROUPS = [
    { id: 'autoroute', label: 'Autoroute', color: '#1f5fbf' },
    { id: 'nationale', label: 'Nationale / voie rapide', color: '#d7261e' },
    { id: 'departementale', label: 'Départementale', color: '#f5c400' },
    { id: 'locale', label: 'Petite route / rue', color: '#2f9e44' },
    { id: 'cyclable', label: 'Piste cyclable', color: '#00a37a' },
    { id: 'pieton', label: 'Voie piétonne', color: '#868e96' },
    { id: 'chemin', label: 'Chemin / sentier', color: '#8a5a2b' },
    { id: 'bac', label: 'Bac', color: '#15aabf' },
    { id: 'inconnu', label: 'Non analysé', color: '#ced4da' }
  ];
  const CLS = { motorway: 'autoroute', trunk: 'nationale', primary: 'nationale', secondary: 'departementale',
    tertiary: 'departementale', unclassified: 'locale', residential: 'locale', service_other: 'locale' };

  // Numéro de route français (A 8, N 7, RN 85, D 554, RD 25, M 6, C 3) : prioritaire sur la classe OSM,
  // car beaucoup de départementales importantes sont classées « primary » comme les nationales.
  const REF = /^(A|RN|N|RD|D|M|C|VC)\s?\d/i;
  const REF_G = { A: 'autoroute', RN: 'nationale', N: 'nationale', RD: 'departementale', D: 'departementale', M: 'departementale', C: 'locale', VC: 'locale' };
  function refGroup(names) {
    for (const n of names || []) {
      for (const part of String(n).split(/[;,/]/)) {
        const m = part.trim().match(REF);
        if (m) return REF_G[m[1].toUpperCase()];
      }
    }
    return null;
  }

  function group(e) {
    const u = e.use || '';
    if (u === 'ferry' || u === 'rail-ferry') return 'bac';
    if (u === 'cycleway') return 'cyclable';
    if (['track', 'path', 'mountain_bike', 'bridleway', 'steps'].includes(u)) return 'chemin';
    if (['footway', 'sidewalk', 'pedestrian', 'pedestrian_crossing', 'elevator', 'escalator'].includes(u)) return 'pieton';
    if (e.cls === 'motorway') return 'autoroute';
    return refGroup(e.names) || CLS[e.cls] || 'locale';
  }

  const slopeClass = s => { const a = Math.abs(s || 0); return a < 3 ? 0 : a < 6 ? 1 : a < 9 ? 2 : a < 12 ? 3 : 4; };

  // Ajoute la pente (s, en %) à chaque échantillon {d, e}, mesurée sur ~200 m
  function addSlopes(samples) {
    if (!samples || samples.length < 2) return samples;
    const n = samples.length;
    const sm = samples.map((s, i) => {
      let t = 0, k = 0;
      for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) { t += samples[j].e; k++; }
      return t / k;
    });
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) {
      const d = samples[i].d;
      while (a < i && d - samples[a + 1].d >= 100) a++;
      while (b < n - 1 && samples[b].d - d < 100) b++;
      const dd = samples[b].d - samples[a].d;
      samples[i].s = dd >= 50 ? Math.round((sm[b] - sm[a]) / dd * 1000) / 10 : 0;
      samples[i].m = sm[i];
    }
    return samples;
  }

  function elevStats(samples) {
    if (!samples || samples.length < 2) return null;
    addSlopes(samples);
    let up = 0, down = 0, ref = samples[0].m;
    let maxE = -Infinity, minE = Infinity, maxEAt = 0, maxS = 0, maxSAt = 0, minS = 0, minSAt = 0, steepUp = 0, steep = 0;
    samples.forEach((p, i) => {
      if (p.m - ref >= 3) { up += p.m - ref; ref = p.m; } else if (ref - p.m >= 3) { down += ref - p.m; ref = p.m; }
      if (p.e > maxE) { maxE = p.e; maxEAt = p.d; }
      if (p.e < minE) minE = p.e;
      if (p.s > maxS) { maxS = p.s; maxSAt = p.d; }
      if (p.s < minS) { minS = p.s; minSAt = p.d; }
      if (i) {
        const L = p.d - samples[i - 1].d;
        if (p.s >= 8) steepUp += L;
        if (Math.abs(p.s) >= 8) steep += L;
      }
    });
    return { up, down, maxE, minE, maxEAt, maxS, maxSAt, minS, minSAt, steepUp, steep };
  }

  // Sinuosité (degrés de virage par km) et virages en épingle
  function curves(coords) {
    const { pts, total } = U.resample(coords, 20);
    if (pts.length < 6 || total < 200) return { sinu: 0, hairpins: [] };
    const h = [];
    for (let i = 0; i < pts.length - 1; i++) h.push(U.bearing(pts[i].c, pts[i + 1].c));
    const dl = [];
    for (let i = 0; i < h.length - 1; i++) dl.push(U.angleDiff(h[i], h[i + 1]));
    let sum = 0;
    dl.forEach(x => { sum += Math.min(45, Math.abs(x)); });
    const hairpins = [];
    for (let i = 0; i < dl.length;) {
      let acc = 0, hit = -1;
      for (let k = i; k < Math.min(dl.length, i + 6); k++) {
        acc += dl[k];
        if (Math.abs(acc) >= 150) { hit = k; break; }
      }
      if (hit >= 0) {
        const after = h[Math.min(h.length - 1, hit + 3)];
        if (Math.abs(U.angleDiff(h[i], after)) >= 135) { hairpins.push(pts[i + 1].d); i = hit + 4; continue; }
      }
      i++;
    }
    return { sinu: sum / (total / 1000), hairpins };
  }

  function edgeStats(edges, legDist) {
    if (!edges || !edges.length) return null;
    const tot = edges.reduce((s, e) => s + e.len, 0) || 1, k = legDist / tot;
    const comp = {}, unpaved = [], runs = [];
    let toll = 0, ferry = false, rough = 0, d = 0, cur = null;
    for (const e of edges) {
      const L = e.len * k, g = group(e);
      comp[g] = (comp[g] || 0) + L;
      const r = runs[runs.length - 1];
      if (r && r.g === g) r.len += L; else runs.push({ d, len: L, g });
      if (e.unpaved && g !== 'bac') {
        if (cur && Math.abs(cur.d + cur.len - d) < 1) cur.len += L; else { cur = { d, len: L }; unpaved.push(cur); }
      }
      if (e.surface === 'paved_rough') rough += L;
      if (e.toll) toll += L;
      if (g === 'bac') ferry = true;
      d += L;
    }
    return { comp, runs: runs.map(r => ({ d: Math.round(r.d), len: Math.round(r.len), g: r.g })), unpaved: unpaved.filter(u => u.len >= 50), toll, ferry, rough };
  }

  function leg(coords, samples, edges, distance) {
    const el = elevStats(samples);
    const cv = curves(coords);
    const ed = edgeStats(edges, distance);
    return { ...(el || {}), hasElev: !!el, ...cv, ...(ed || { comp: null, runs: null, unpaved: [], toll: 0, ferry: false, rough: 0 }) };
  }

  // ---------- Parcours complet ----------
  let combCache = { legs: null, val: null };

  function combine(state) {
    if (combCache.legs === state.legs) return combCache.val;
    const coords = [], cum = [], samples = [], starts = [];
    let off = 0;
    for (const L of state.legs) {
      starts.push(off);
      if (L.status !== 'ok' || !L.coords) { off += U.dist(L.fromC, L.toC); continue; }
      const c = U.cum(L.coords);
      L.coords.forEach((p, i) => {
        if (i === 0 && coords.length && U.same(coords[coords.length - 1], p)) return;
        coords.push([p[0], p[1]]); cum.push(off + c[i]);
      });
      if (L.samples) L.samples.forEach(s => samples.push({ d: off + s.d, e: s.e, s: s.s || 0 }));
      off += c[c.length - 1] || 0;
    }
    starts.push(off);
    const val = { coords, cum, samples, starts, total: off };
    combCache = { legs: state.legs, val };
    return val;
  }

  function eleAt(comb, d) {
    const S = comb.samples;
    if (!S.length) return null;
    const i = U.search(S, d, x => x.d);
    if (i < 0) return S[0].e;
    if (i >= S.length - 1) return S[S.length - 1].e;
    const a = S[i], b = S[i + 1], t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
    return a.e + (b.e - a.e) * t;
  }
  function slopeAt(comb, d) {
    const S = comb.samples, i = U.search(S, d, x => x.d);
    return S.length ? S[Math.max(0, Math.min(S.length - 1, i))].s : 0;
  }

  function speedKmh(mode) {
    const st = T.settings.get();
    return mode === 'velo' ? st.bikeSpeed : mode === 'run' ? 60 / st.runPace : T.config.avgSpeed.moto;
  }

  function summary(state) {
    const mode = state.mode, comb = combine(state);
    const res = { distance: 0, duration: 0, up: 0, down: 0, maxE: null, maxEAt: 0, minE: null, maxS: 0, maxSAt: 0, minS: 0, minSAt: 0,
      steepUp: 0, hairpins: 0, sinuSum: 0, comp: {}, compKnown: 0, pending: 0, errors: 0, alerts: [], level: null, elevMissing: false };
    state.legs.forEach((L, i) => {
      const off = comb.starts[i];
      if (L.status === 'pending') { res.pending++; return; }
      if (L.status === 'error') {
        res.errors++;
        res.alerts.push({ lvl: 'warn', d: off, text: `Tronçon ${i + 1} : ${L.error}` });
        return;
      }
      const a = L.an || {};
      res.distance += L.distance;
      res.duration += L.kind === 'route' && L.duration ? L.duration : L.distance / 1000 / speedKmh(mode) * 3600;
      if (a.hasElev) {
        res.up += a.up; res.down += a.down;
        if (res.maxE == null || a.maxE > res.maxE) { res.maxE = a.maxE; res.maxEAt = off + a.maxEAt; }
        if (res.minE == null || a.minE < res.minE) res.minE = a.minE;
        if (a.maxS > res.maxS) { res.maxS = a.maxS; res.maxSAt = off + a.maxSAt; }
        if (a.minS < res.minS) { res.minS = a.minS; res.minSAt = off + a.minSAt; }
        res.steepUp += a.steepUp;
      } else res.elevMissing = true;
      res.hairpins += (a.hairpins || []).length;
      res.sinuSum += (a.sinu || 0) * L.distance;
      if (a.comp) {
        for (const k in a.comp) res.comp[k] = (res.comp[k] || 0) + a.comp[k];
        res.compKnown += L.distance;
      } else res.comp.inconnu = (res.comp.inconnu || 0) + L.distance;
      legAlerts(res.alerts, L, a, i, off, mode);
    });
    res.sinu = res.distance ? res.sinuSum / res.distance : 0;
    globalAlerts(res, mode);
    res.level = level(res, mode);
    res.alerts.sort((x, y) => (x.lvl === y.lvl ? x.d - y.d : x.lvl === 'warn' ? -1 : 1));
    return res;
  }

  const km = d => U.nf(d / 1000, 1);

  // Type de route choisi -> famille de voies attendue (moto)
  const WANT = { autoroute: 'autoroute', nationale: 'nationale', departementale: 'departementale', petites: 'locale' };
  const NONE = { autoroute: 'pas d’autoroute', nationale: 'pas de nationale', departementale: 'pas de départementale', locale: 'pas de petite route' };
  const gLabel = id => (GROUPS.find(g => g.id === id) || {}).label || id;

  // Compare le choix de l'utilisateur aux voies réellement empruntées
  function mismatch(L, a, mode) {
    if (mode !== 'moto' || L.kind !== 'route' || !a.comp || !L.distance) return null;
    const want = WANT[L.road];
    if (!want) return null;
    const share = (a.comp[want] || 0) / L.distance;
    if (share >= 0.5) return null;
    let main = null, mv = 0;
    for (const k in a.comp) if (a.comp[k] > mv) { mv = a.comp[k]; main = k; }
    if (!main || main === want) return null;
    return { want, main, share, absent: share < 0.03, mainShare: mv / L.distance };
  }

  function legAlerts(out, L, a, i, off, mode) {
    const n = i + 1;
    const mm = mismatch(L, a, mode);
    if (mm) out.push({ lvl: 'info', d: off, text: mm.absent
      ? `Tronçon ${n} : ${NONE[mm.want]} sur ce trajet, il suit surtout : ${gLabel(mm.main).toLowerCase()} (${U.nf(mm.mainShare * 100)} %)`
      : `Tronçon ${n} : ${gLabel(mm.want).toLowerCase()} minoritaire (${U.nf(mm.share * 100)} %), le trajet suit surtout : ${gLabel(mm.main).toLowerCase()} (${U.nf(mm.mainShare * 100)} %)` });
    const hp = a.hairpins || [];
    if (mode === 'moto' && hp.length >= 3) out.push({ lvl: 'info', d: off + hp[0], text: `${hp.length} virages en épingle sur le tronçon ${n}` });
    if (mode === 'velo' && hp.length >= 5) out.push({ lvl: 'info', d: off + hp[0], text: `${hp.length} virages en épingle sur le tronçon ${n} : prudence en descente` });
    const up = (a.unpaved || []);
    if (up.length && mode !== 'run') {
      const roadBike = mode === 'velo' && L.road === 'route';
      const lvl = mode === 'moto' || roadBike ? 'warn' : 'info';
      up.slice(0, 4).forEach(u => out.push({ lvl, d: off + u.d, text: `Portion non goudronnée de ${U.fmtKm(u.len)} (km ${km(off + u.d)})` }));
      if (up.length > 4) out.push({ lvl, d: off + up[4].d, text: `${up.length - 4} autres portions non goudronnées sur le tronçon ${n}` });
    }
    if (mode === 'velo' && L.road === 'route' && a.rough > 500) out.push({ lvl: 'info', d: off, text: `${U.fmtKm(a.rough)} de revêtement dégradé sur le tronçon ${n}` });
    if (a.toll > 0 && mode === 'moto') out.push({ lvl: 'info', d: off, text: `Péage sur le tronçon ${n}` });
    if (a.ferry) out.push({ lvl: 'info', d: off, text: `Traversée en bac sur le tronçon ${n} : vérifiez horaires et tarifs` });
    if (L.elevErr) out.push({ lvl: 'info', d: off, text: `Tronçon ${n} : altitudes indisponibles pour le moment` });
  }

  function globalAlerts(r, mode) {
    const lim = mode === 'velo' ? 8 : mode === 'run' ? 10 : 12;
    if (r.maxS >= lim) r.alerts.push({ lvl: 'warn', d: r.maxSAt, text: `Montée raide : jusqu’à ${U.nf(r.maxS, 0)} % (km ${km(r.maxSAt)})` });
    if (-r.minS >= lim) r.alerts.push({ lvl: 'warn', d: r.minSAt, text: `Descente raide : jusqu’à ${U.nf(-r.minS, 0)} % (km ${km(r.minSAt)})` });
    if (mode === 'velo' && r.steepUp > 500) r.alerts.push({ lvl: 'info', d: r.maxSAt, text: `${U.fmtKm(r.steepUp)} de montée à plus de 8 %` });
    if (r.maxE != null && r.maxE >= 1400 && mode !== 'run') {
      const month = new Date().getMonth();
      const cold = month >= 10 || month <= 4;
      r.alerts.push({ lvl: cold ? 'warn' : 'info', d: r.maxEAt,
        text: `Point haut à ${U.nf(r.maxE)} m (km ${km(r.maxEAt)}) : de novembre à mai, vérifiez que les cols sont ouverts` });
    }
    if (mode === 'moto' && r.distance > 500000) r.alerts.push({ lvl: 'info', d: 0, text: 'Plus de 500 km : prévoyez des pauses et le carburant' });
  }

  function level(r, mode) {
    if (!r.distance) return null;
    let p = 0;
    const kmTot = r.distance / 1000, dPlusKm = r.up / Math.max(1, kmTot);
    const unp = r.alerts.filter(a => /non goudronnée/.test(a.text)).length;
    if (mode === 'moto') {
      if (r.sinu > 150) p += 2; else if (r.sinu > 80) p += 1;
      if (r.hairpins >= 10) p += 1;
      if (r.maxS >= 12 || -r.minS >= 12) p += 1;
      if (unp >= 2) p += 2; else if (unp) p += 1;
      if (kmTot > 400) p += 1;
    } else if (mode === 'velo') {
      if (dPlusKm > 20) p += 2; else if (dPlusKm > 10) p += 1;
      if (kmTot > 100) p += 2; else if (kmTot > 50) p += 1;
      if (r.maxS >= 12) p += 1;
      if (r.up > 1500) p += 1;
    } else {
      if (kmTot > 21) p += 2; else if (kmTot > 10) p += 1;
      if (r.up > 800) p += 2; else if (r.up > 250) p += 1;
      if (r.maxS >= 15) p += 1;
    }
    const L = [['Facile', 0], ['Intermédiaire', 1], ['Confirmé', 2], ['Expert', 3]];
    return p <= 1 ? L[0] : p === 2 ? L[1] : p <= 4 ? L[2] : L[3];
  }

  const sinuLabel = s => s < 30 ? 'Rectiligne' : s < 80 ? 'Vallonnée' : s < 150 ? 'Sinueuse' : 'Très sinueuse';

  return { GROUPS, mismatch, gLabel, slopeClass, addSlopes, leg, combine, eleAt, slopeAt, summary, sinuLabel, speedKmh };
})();
