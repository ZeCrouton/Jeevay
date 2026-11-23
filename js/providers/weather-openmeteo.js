/* Fournisseur météo : Open-Meteo (gratuit, sans clé, prévisions à 16 jours).
   Interface : at(points [{c, t (Date)}], signal) -> [{ temp, rainProb, rain, code, wind, gust, sunset (Date|null) } | null] */
window.T = window.T || {};
T.providers = T.providers || {};

T.providers.weather = (() => {
  const H = 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m';

  // Heures en temps universel (timeformat=unixtime) : aucun calcul de fuseau, donc pas d'erreur d'heure
  async function query(points, signal) {
    const lat = points.map(p => p.c[1].toFixed(3)).join(','), lon = points.map(p => p.c[0].toFixed(3)).join(',');
    const url = `${T.config.weather.url}?latitude=${lat}&longitude=${lon}&hourly=${H}&daily=sunset&timeformat=unixtime&forecast_days=${T.config.weather.days}`;
    const r = await T.util.fetchT(url, { signal }, 15000);
    let j = null;
    try { j = await r.json(); } catch (e) { /* réponse illisible */ }
    if (!r.ok) throw new Error('Météo indisponible' + (j && j.reason ? ' : ' + j.reason : ' (' + r.status + ')'));
    return Array.isArray(j) ? j : [j];
  }

  function pick(f, t) {
    if (!f || !f.hourly || !f.hourly.time) return null;
    const ts = t.getTime() / 1000, times = f.hourly.time;
    let k = 0, best = Infinity;
    for (let i = 0; i < times.length; i++) { const d = Math.abs(times[i] - ts); if (d < best) { best = d; k = i; } }
    if (best > 5400) return null; // hors de la période de prévision
    const g = n => (f.hourly[n] ? f.hourly[n][k] : null);
    let sunset = null;
    if (f.daily && f.daily.sunset) {
      const ss = f.daily.sunset.filter(Boolean).map(x => x * 1000);
      sunset = ss.reduce((a, x) => (Math.abs(x - t) < Math.abs(a - t) ? x : a), ss[0] || 0);
      sunset = sunset ? new Date(sunset) : null;
    }
    return { temp: g('temperature_2m'), rainProb: g('precipitation_probability'), rain: g('precipitation'),
      code: g('weather_code'), wind: g('wind_speed_10m'), gust: g('wind_gusts_10m'), sunset };
  }

  async function at(points, signal) {
    let res;
    try { res = await query(points, signal); }
    catch (e) {
      if (signal && signal.aborted) throw e;
      // Repli : un point à la fois
      res = [];
      for (const p of points) {
        try { res.push((await query([p], signal))[0]); } catch (x) { if (signal && signal.aborted) throw x; res.push(null); }
      }
      if (!res.some(Boolean)) throw e;
    }
    return points.map((p, i) => pick(res[i], p.t));
  }

  // Code météo OMM -> type d'icône et libellé
  function kind(code) {
    if (code == null) return ['cloud', '—'];
    if (code === 0) return ['sun', 'Ensoleillé'];
    if (code <= 2) return ['part', 'Éclaircies'];
    if (code === 3) return ['cloud', 'Couvert'];
    if (code === 45 || code === 48) return ['fog', 'Brouillard'];
    if (code >= 95) return ['storm', 'Orage'];
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', 'Neige'];
    if (code >= 51 && code <= 57) return ['rain', 'Bruine'];
    return ['rain', code >= 80 ? 'Averses' : 'Pluie'];
  }

  return { at, kind };
})();
