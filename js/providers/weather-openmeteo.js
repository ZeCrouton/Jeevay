/* Fournisseur météo : Open-Meteo (gratuit, sans clé, prévisions à 16 jours).
   Interface : at(points [{c, t (Date)}], signal) -> [{ temp, rainProb, rain, code, wind, gust, sunset (Date|null) } | null] */
window.T = window.T || {};
T.providers = T.providers || {};

T.providers.weather = (() => {
  const H = 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m';

  async function at(points, signal) {
    const lat = points.map(p => p.c[1].toFixed(3)).join(','), lon = points.map(p => p.c[0].toFixed(3)).join(',');
    const url = `${T.config.weather.url}?latitude=${lat}&longitude=${lon}&hourly=${H}&daily=sunset&timezone=auto&forecast_days=${T.config.weather.days}&wind_speed_unit=kmh`;
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error('Météo indisponible');
    let j = await r.json();
    if (!Array.isArray(j)) j = [j];
    return points.map((p, i) => {
      const f = j[i];
      if (!f || !f.hourly) return null;
      const off = (f.utc_offset_seconds || 0) * 1000;
      const local = new Date(p.t.getTime() + off).toISOString();
      const key = local.slice(0, 13) + ':00';
      const k = f.hourly.time.indexOf(key);
      if (k < 0) return null;
      const g = n => f.hourly[n] ? f.hourly[n][k] : null;
      const dk = f.daily && f.daily.time ? f.daily.time.indexOf(local.slice(0, 10)) : -1;
      // Les heures renvoyées sont locales sans fuseau : on les recale en heure absolue
      const sunset = dk >= 0 && f.daily.sunset[dk] ? new Date(Date.parse(f.daily.sunset[dk] + 'Z') - off) : null;
      return { temp: g('temperature_2m'), rainProb: g('precipitation_probability'), rain: g('precipitation'),
        code: g('weather_code'), wind: g('wind_speed_10m'), gust: g('wind_gusts_10m'), sunset };
    });
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
