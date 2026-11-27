/* V2 — Météo à l'heure de passage (Open-Meteo, 16 jours). */
(() => {
  const U = T.util, W = T.providers.weather, KEY = T.config.storagePrefix + 'departure';
  let data = { sig: null, rows: [], loading: false, error: null };
  let ctrl = null;

  const nextHour = () => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; };
  function departure() {
    // L'heure choisie est gardée même si elle est passée, tant que la date n'est pas antérieure à aujourd'hui
    try { const v = localStorage.getItem(KEY); if (v && +v >= new Date().setHours(0, 0, 0, 0)) return new Date(+v); } catch (e) { /* ignore */ }
    return nextHour();
  }
  const setDeparture = d => { try { localStorage.setItem(KEY, String(d.getTime())); } catch (e) { /* ignore */ } };
  const toInput = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const hm = d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');

  // Heure de passage à la distance d (répartition de la durée par tronçon)
  function timeAt(s, comb, sum, d) {
    let t = 0;
    for (let i = 0; i < s.legs.length; i++) {
      const L = s.legs[i], a = comb.starts[i], b = comb.starts[i + 1];
      const dur = L.status !== 'ok' ? 0 : L.kind === 'route' && L.duration ? L.duration
        : L.distance / 1000 / T.analysis.speedKmh(s.mode) * 3600;
      if (d <= b || i === s.legs.length - 1) { const m = t + dur * U.clamp((d - a) / Math.max(1, b - a), 0, 1); return m + (T.days ? T.days.pausesFor(m) + T.days.stopSec(s, 0, d) : 0); }
      t += dur;
    }
    return t;
  }

  const sigOf = (s, dep) => s.legs.map(l => l.id + ':' + l.rev + ':' + l.status).join('|') + '@' + dep.getTime() + (T.days ? '#' + T.days.schedSig(s) : '');
  // Heure de passage : par journée si le parcours est découpé (nuits, pauses), sinon en continu
  const when = (s, comb, sum, dep, d, k) => (T.days && T.days.dateAt(s, d, k)) || new Date(dep.getTime() + timeAt(s, comb, sum, d) * 1000);

  async function load() {
    const s = T.app.st(), comb = T.analysis.combine(s), sum = T.analysis.summary(s);
    if (comb.coords.length < 2) return;
    const dep = departure();
    if (dep.getTime() > Date.now() + (T.config.weather.days - 0.5) * 86400e3) {
      data = { sig: null, rows: [], loading: false, error: `Prévisions disponibles jusqu’à ${T.config.weather.days} jours seulement` };
      T.app.render(); return;
    }
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    data = { ...data, loading: true, error: null };
    T.app.render();
    // Peu de points : le quota gratuit est compté par point. Sur plusieurs jours, des points pour chaque journée.
    const D = T.days ? T.days.days(s) : [], ds = [];
    if (D.length > 1) {
      const per = U.clamp(Math.floor(18 / D.length), 1, 4);
      D.forEach(day => { for (let j = 0; j <= per; j++) ds.push({ d: day.a + (day.b - day.a) * j / per, k: day.i }); });
    } else {
      const n = U.clamp(Math.round(comb.total / 30000), 1, 7);
      for (let j = 0; j <= n; j++) ds.push({ d: comb.total * j / n, k: null });
    }
    const pts = ds.map(({ d, k }) => ({ d, k, c: U.at(comb.coords, comb.cum, d), t: when(s, comb, sum, dep, d, k) }));
    const lastT = Math.max(...pts.map(p => p.t.getTime()));
    if (lastT > Date.now() + T.config.weather.days * 86400e3) T.ui.toast(`Prévisions disponibles à ${T.config.weather.days} jours : les derniers jours resteront sans météo`);
    try {
      const res = await W.at(pts, ctrl.signal);
      data = { sig: sigOf(s, dep), rows: pts.map((p, i) => ({ ...p, w: res[i] })), loading: false, error: null };
    } catch (e) {
      if (e.name === 'AbortError') return;
      data = { ...data, loading: false, error: e instanceof TypeError ? 'Connexion au service météo impossible' : e.message };
    }
    T.app.render();
  }

  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4.5" fill="#f5b400" stroke="none"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="#f5b400"/>',
    part: '<circle cx="9" cy="9" r="3.5" fill="#f5b400" stroke="none"/><path d="M7 19h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.4A3 3 0 0 0 7 19Z" fill="#dee2e6" stroke="#868e96"/>',
    cloud: '<path d="M6 19h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.6A3.3 3.3 0 0 0 6 19Z" fill="#dee2e6" stroke="#868e96"/>',
    fog: '<path d="M4 9h16M3 13h18M5 17h14" stroke="#868e96"/>',
    rain: '<path d="M6 15h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.6A3.3 3.3 0 0 0 6 15Z" fill="#ced4da" stroke="#868e96"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke="#1c7ed6"/>',
    snow: '<path d="M6 15h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.6A3.3 3.3 0 0 0 6 15Z" fill="#e9ecef" stroke="#868e96"/><path d="M8 19h.01M12 21h.01M16 19h.01" stroke="#4dabf7" stroke-width="3"/>',
    storm: '<path d="M6 14h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.6A3.3 3.3 0 0 0 6 14Z" fill="#adb5bd" stroke="#495057"/><path d="m12 14-2 4h3l-2 4" stroke="#f59f00"/>'
  };
  const icon = k => `<svg class="wx-ic" viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

  // Alertes météo
  T.hooks.alerts.push((s, sum) => {
    if (!data.sig || data.sig !== sigOf(s, departure())) return;
    const moto = s.mode === 'moto', bike = s.mode === 'velo';
    let rain = null, gust = null, cold = null, hot = null;
    data.rows.forEach(r => {
      const w = r.w;
      if (!w) return;
      if (w.rainProb >= 60 && (!rain || w.rainProb > rain.w.rainProb)) rain = r;
      if (w.gust >= (moto ? 60 : 50) && (moto || bike) && (!gust || w.gust > gust.w.gust)) gust = r;
      if (w.temp != null && w.temp <= 3 && (moto || bike) && (!cold || w.temp < cold.w.temp)) cold = r;
      if (w.temp != null && w.temp >= 32 && (!hot || w.temp > hot.w.temp)) hot = r;
    });
    const km = r => U.nf(r.d / 1000);
    const multi = T.days && T.days.days(s).length > 1, at = r => (multi && r.k != null ? `jour ${r.k + 1}, ` : '') + hm(r.t);
    if (rain) sum.alerts.push({ lvl: 'warn', d: rain.d, text: `Pluie probable ${multi ? '' : 'vers '}${at(rain)} (km ${km(rain)}, ${rain.w.rainProb} %)` });
    if (gust) sum.alerts.push({ lvl: 'warn', d: gust.d, text: `Rafales jusqu’à ${Math.round(gust.w.gust)} km/h ${multi ? '' : 'vers '}${at(gust)} (km ${km(gust)})` });
    if (cold) sum.alerts.push({ lvl: 'warn', d: cold.d, text: `${Math.round(cold.w.temp)} °C ${multi ? '' : 'vers '}${at(cold)} (km ${km(cold)}) : risque de verglas` });
    if (hot) sum.alerts.push({ lvl: 'info', d: hot.d, text: `Forte chaleur : ${Math.round(hot.w.temp)} °C ${multi ? '' : 'vers '}${at(hot)}, prévoyez de l’eau` });
    // Arrivée après le coucher du soleil : vérifiée pour chaque journée
    const D = T.days ? T.days.days(s) : [];
    const ends = D.length > 1 ? D.map(day => ({ day, r: data.rows.filter(r => r.k === day.i).pop() })) : [{ day: null, r: data.rows[data.rows.length - 1] }];
    ends.forEach(({ day, r }) => {
      if (r && r.w && r.w.sunset && r.t > r.w.sunset) {
        sum.alerts.push({ lvl: 'info', d: r.d, text: `${day ? `Jour ${day.i + 1} : arrivée` : 'Arrivée'} vers ${hm(r.t)}, après le coucher du soleil (${hm(r.w.sunset)})` });
      }
    });
  });

  T.hooks.render.push((s, sum, comb) => {
    const el = document.getElementById('weather');
    if (!el || (document.activeElement && document.activeElement.id === 'wx-dep')) return;
    if (comb.coords.length < 2) { el.innerHTML = ''; return; }
    const dep = departure(), stale = data.sig && data.sig !== sigOf(s, dep);
    const D = T.days ? T.days.days(s) : [];
    const end = D.length > 1 ? D[D.length - 1].end : new Date(dep.getTime() + (T.days ? T.days.totalDuration(s, sum) : sum.duration) * 1000);
    const btn = data.loading ? '<span class="calc"><i class="spin"></i>Prévision…</span>'
      : `<button class="mini" data-act="wxLoad">${T.icons('retry')}${data.sig ? (stale ? 'Mettre à jour' : 'Actualiser') : 'Voir la météo'}</button>`;
    el.innerHTML = `<div class="sec-h"><h3>Météo au passage</h3>${btn}</div>
      <div class="dep"><label>${D.length > 1 ? 'Départ du jour 1' : 'Départ'} <input type="datetime-local" id="wx-dep" value="${toInput(dep)}"></label>
        <span class="muted small">Arrivée estimée ${end.toLocaleDateString('fr-FR', { weekday: 'short' })} ${hm(end)}</span></div>
      ${data.error ? `<p class="err">${U.esc(data.error)}</p>` : ''}
      ${data.sig && !stale ? `<div class="wx">${data.rows.map(r => {
        if (!r.w) return `<div class="wx-c"><b>${hm(r.t)}</b><small>km ${U.nf(r.d / 1000)}</small><span class="muted small">—</span></div>`;
        const [k, lbl] = W.kind(r.w.code);
        const dl = D.length > 1 && r.k != null ? `J${r.k + 1} ` : '';
        return `<div class="wx-c" title="${lbl}"><b>${dl}${hm(r.t)}</b><small>km ${U.nf(r.d / 1000)}</small>${icon(k)}
          <span class="wx-t">${Math.round(r.w.temp)}°</span>
          <span class="wx-r${r.w.rainProb >= 50 ? ' hi' : ''}">${r.w.rainProb ?? 0} %</span>
          <span class="wx-w">${Math.round(r.w.wind)}<small>/${Math.round(r.w.gust)} km/h</small></span></div>`;
      }).join('')}</div>` : stale ? '<p class="muted small">Le parcours ou l’heure de départ a changé : mettez à jour la météo.</p>' : ''}`;
    const inp = el.querySelector('#wx-dep');
    inp.addEventListener('change', () => { const d = new Date(inp.value); if (!isNaN(d)) { setDeparture(d); T.app.render(); } });
  });

  T.hooks.act.wxLoad = load;
  const fresh = s => !!data.sig && data.sig === sigOf(s, departure());
  T.weather = { departure, setDeparture, toInput, timeAt, hm, icon, fresh, get data() { return data; } };
})();
