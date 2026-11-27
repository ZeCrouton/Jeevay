/* V3 — Road-book imprimable (ou en PDF via « Imprimer ») : carte, profil, étapes, alertes, météo, lieux. */
(() => {
  const U = T.util, A = T.analysis;

  async function open() {
    const s = T.app.st(), comb = A.combine(s);
    if (comb.coords.length < 2) { T.ui.toast('Tracez d’abord un parcours', 'error'); return; }
    if (s.legs.some(l => l.status === 'pending')) { T.ui.toast('Patientez, des tronçons sont encore en calcul', 'error'); return; }
    const w = window.open('', '_blank');
    if (!w) { T.ui.toast('Fenêtre bloquée : autorisez les fenêtres pour ce site', 'error', 6000); return; }
    w.document.write('<p style="font:16px system-ui;padding:24px">Préparation du road-book…</p>');
    // Le road-book reprend tout le parcours, même si des jours sont masqués à l'écran
    if (T.days) T.days.showEverything(true);
    T.app.fitAll();
    await new Promise(r => setTimeout(r, 700));
    const mapImg = await T.map.snapshot();
    if (T.days) T.days.showEverything(false);
    let profImg = null;
    try { profImg = T.profile.image(); } catch (e) { /* ignore */ }
    const sum = A.summary(s);
    T.hooks.alerts.forEach(f => { try { f(s, sum, comb); } catch (e) { /* ignore */ } });
    w.document.open();
    w.document.write(html(s, sum, comb, mapImg, profImg));
    w.document.close();
  }

  function html(s, sum, comb, mapImg, profImg) {
    const mode = T.config.modes[s.mode], dep = T.weather ? T.weather.departure() : null, hm = T.weather ? T.weather.hm : () => '';
    const sc = s.mode === 'moto' && T.score ? T.score.total(sum) : null;
    const name = i => T.io.export.wpName(s.waypoints[i], i, s.waypoints.length, s.waypoints);
    const atLeg = (d, k) => { const x = multi && T.days.dateAt(s, d, k); return x ? hm(x) : at(d); };
    const at = d => dep ? hm(new Date(dep.getTime() + T.weather.timeAt(s, comb, sum, d) * 1000)) : '';
    const D = T.days ? T.days.days(s) : [], multi = D.length > 1;
    const dayDate = d => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const legDay = i => Math.max(0, D.findIndex(x => comb.starts[i] < x.b - 1));
    // Une ligne par trajet d'étape à étape (g : tronçons reliés par des points de passage)
    const legRow = (g, no, k) => {
      const i = g[0], end = g[g.length - 1] + 1, Ls = g.map(j => s.legs[j]);
      const roads = [...new Set(Ls.map(L => { const r = T.panel.roadOf(L, s.mode); return L.kind === 'track' ? (L.name || r.label) : r.label; }))];
      const mains = [...new Set(Ls.map(L => A.mismatch(L, L.an || {}, s.mode)).filter(Boolean).map(m => A.gLabel(m.main)))];
      const dist = Ls.reduce((t, L) => t + (L.distance || 0), 0);
      const hasElev = Ls.every(L => L.an && L.an.hasElev), up = Ls.reduce((t, L) => t + ((L.an && L.an.up) || 0), 0);
      return `<tr><td>${no + 1}</td><td>${U.esc(name(i))} → ${U.esc(name(end))}</td>
        <td>${roads.map(U.esc).join(', ')}${mains.length ? '<br><small>surtout ' + mains.map(U.esc).join(', ') + '</small>' : ''}</td>
        <td class="n">${U.fmtKm(dist)}</td><td class="n">${U.nf((comb.starts[end] || 0) / 1000, 1)}</td>
        <td class="n">${hasElev ? '+' + U.nf(up) + ' m' : '—'}</td><td class="n">${atLeg(comb.starts[end], k)}</td></tr>`;
    };
    const legRows = (idx, k) => T.io.export.groups(s.waypoints, idx).map(g => legRow(g, T.io.export.stepNo(s.waypoints, g[0]), k || 0)).join('');
    const head = `<thead><tr><th>#</th><th>Tronçon</th><th>Route</th><th class="n">Distance</th><th class="n">Cumul km</th><th class="n">D+</th><th class="n">${dep ? 'Arrivée' : ''}</th></tr></thead>`;
    const rows = multi ? '' : legRows(s.legs.map((L, i) => i));
    const wxRows = T.weather && T.weather.data.rows.length ? T.weather.data.rows.filter(r => r.w) : [];
    const wxTable = rs => rs.map(r =>
      `<tr><td class="n">${hm(r.t)}</td><td class="n">km ${U.nf(r.d / 1000)}</td><td>${T.providers.weather.kind(r.w.code)[1]}</td><td class="n">${Math.round(r.w.temp)} °C</td><td class="n">${r.w.rainProb ?? 0} %</td><td class="n">${Math.round(r.w.wind)} / ${Math.round(r.w.gust)} km/h</td></tr>`).join('');
    const wxHead = '<thead><tr><th class="n">Heure</th><th class="n">Lieu</th><th>Ciel</th><th class="n">Temp.</th><th class="n">Pluie</th><th class="n">Vent / rafales</th></tr></thead>';
    const wx = wxRows.length ? wxTable(wxRows) : '';
    const poiRow = p => `<tr><td class="n">km ${U.nf(p.d / 1000, 1)}</td><td>${U.esc(T.providers.poi.CATS[p.cat].label.replace(/s$/, ''))}</td><td>${U.esc(p.name)}</td><td class="n">à ${U.fmtKm(p.off)}</td></tr>`;
    const label = m => m.wi >= 0 ? name(m.wi) : `km ${U.nf(m.d / 1000)}`;
    const pois = T.poi ? T.poi.visible(s).filter(p => ['fuel', 'pass', 'water'].includes(p.cat)).slice(0, 60) : [];
    const pauseHtml = x => { const y = x.w.stay || {}; return `<div class="stay pause"><b>Pause — ${U.esc(y.name || name(x.i))}</b> · ${x.w.pause} min${y.addr ? `<div>${U.esc(y.addr)}</div>` : ''}${y.note ? `<div class="note">${U.esc(y.note).replace(/\n/g, '<br>')}</div>` : ''}</div>`; };
    const single = !multi && T.days ? T.days.stopsIn(s, { a: 0, b: comb.total + 2 }) : [];
    const stayHtml = d => {
      const w = d.i < D.length - 1 && d.to.wi >= 0 ? s.waypoints[d.to.wi] : null, y = w && w.stay || {};
      if (!w) return d.i < D.length - 1 ? `<div class="stay"><b>Nuit</b> autour du km ${U.nf(d.b / 1000)} <small>(à préciser en posant une étape « Nuit »)</small></div>` : '';
      return `<div class="stay"><b>Nuit — ${U.esc(y.name || name(d.to.wi))}</b>${y.addr ? `<div>${U.esc(y.addr)}</div>` : ''}${y.note ? `<div class="note">${U.esc(y.note).replace(/\n/g, '<br>')}</div>` : ''}</div>`;
    };
    const daysHtml = !multi ? '' : D.map(d => {
      const legs = s.legs.map((L, i) => i).filter(i => legDay(i) === d.i);
      const wr = wxRows.filter(r => r.k != null ? r.k === d.i : r.d >= d.a - 1 && r.d <= d.b + 1);
      const ps = pois.filter(p => p.d >= d.a - 1 && p.d <= d.b + 1);
      return `<section class="day"><h2>Jour ${d.i + 1} — ${U.esc(dayDate(d.start))}</h2>
        <p class="route">${U.esc(label(d.from))} → ${U.esc(label(d.to))}</p>
        <div class="figs f4"><div><b>${U.fmtKm(d.dist)}</b><span>Distance</span></div><div><b>${U.fmtDur(d.dur + d.pause)}</b><span>${d.pause ? 'Durée avec pauses' : 'Durée estimée'}</span></div>
          <div><b>+${U.nf(d.up)} m</b><span>Dénivelé +</span></div><div><b>${hm(d.start)} → ${hm(d.end)}</b><span>Départ → arrivée</span></div></div>
        <table>${head}<tbody>${legRows(legs, d.i)}</tbody></table>
        ${wr.length ? `<h3>Météo</h3><table>${wxHead}<tbody>${wxTable(wr)}</tbody></table>` : ''}
        ${ps.length ? `<h3>Sur le parcours</h3><table><tbody>${ps.map(poiRow).join('')}</tbody></table>` : ''}
        ${T.days.stopsIn(s, d).map(pauseHtml).join('')}
        ${stayHtml(d)}</section>`;
    }).join('');
    const css = `@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:11pt/1.4 Barlow,system-ui,sans-serif;color:#14161b;margin:0 auto;max-width:190mm;padding:12px}
      h1{font-size:22pt;margin:0 0 2px}h2{font-size:13pt;margin:18px 0 6px;border-bottom:2px solid ${T.app.accent()};padding-bottom:3px}
      .sub{color:#5f6672;margin:0 0 10px}.figs{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:10px 0}
      .figs div{border:1px solid #e3e6ea;border-radius:8px;padding:6px 8px}.figs b{display:block;font-size:15pt}.figs span{color:#5f6672;font-size:9pt}
      img{width:100%;border-radius:8px;border:1px solid #e3e6ea;display:block}.prof{margin-top:6px;height:auto}
      table{width:100%;border-collapse:collapse;font-size:10pt}td,th{padding:4px 6px;border-bottom:1px solid #e3e6ea;text-align:left;vertical-align:top}
      th{font-size:9pt;color:#5f6672}.n{text-align:right;white-space:nowrap}ul{margin:0;padding-left:18px}li{margin:2px 0}
      .warn{color:#a61e1e}.bar{display:flex;gap:8px;justify-content:flex-end;margin-bottom:8px}.bar button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #14161b;background:#14161b;color:#fff;cursor:pointer}
      .figs.f4{grid-template-columns:repeat(4,1fr)}.day{break-inside:auto}.day h2{font-size:15pt;background:${T.app.accent()}22;padding:5px 8px;border-radius:6px;border-bottom:0}
      h3{font-size:11pt;margin:12px 0 4px}.route{font-weight:600;margin:4px 0}
      .stay{border:1px solid #e3e6ea;border-left:4px solid #2f3a8f;border-radius:6px;padding:8px 10px;margin-top:10px;break-inside:avoid}.stay.pause{border-left-color:#e8590c}.stay .note{color:#3b4250;margin-top:3px}
      small{color:#5f6672}@media print{.day{break-before:auto}.bar{display:none}body{padding:0}h2{break-after:avoid}tr{break-inside:avoid}}`;
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Road-book — ${U.esc(s.name)}</title>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&display=swap"><style>${css}</style></head><body>
      <div class="bar"><button onclick="print()">Imprimer / enregistrer en PDF</button></div>
      <h1>${U.esc(s.name)}</h1>
      <p class="sub">${multi ? `<b>${D.length} jours</b> · ` : ''}${mode.label}${dep ? ' · départ ' + dep.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' à ' + hm(dep) : ''}${sum.level ? ' · niveau ' + sum.level[0] : ''}${sc ? ' · plaisir moto ' + U.nf(sc.v, 1) + '/10' : ''}</p>
      <div class="figs"><div><b>${U.fmtKm(sum.distance)}</b><span>Distance</span></div><div><b>${U.fmtDur(sum.duration)}</b><span>Durée estimée</span></div>
        <div><b>+${U.nf(sum.up)} m</b><span>Dénivelé +</span></div><div><b>−${U.nf(sum.down)} m</b><span>Dénivelé −</span></div>
        <div><b>${sum.maxE != null ? U.nf(sum.maxE) + ' m' : '—'}</b><span>Altitude max</span></div></div>
      ${mapImg ? `<img src="${mapImg}" alt="Carte du parcours">` : ''}
      ${profImg ? `<img class="prof" src="${profImg}" alt="Profil altimétrique">` : ''}
      ${multi ? daysHtml : `<h2>Étapes</h2><table>${head}<tbody>${rows}</tbody></table>`}
      ${sum.alerts.length ? `<h2>Points d’attention</h2><ul>${sum.alerts.map(a => `<li class="${a.lvl === 'warn' ? 'warn' : ''}">${U.esc(a.text)}</li>`).join('')}</ul>` : ''}
      ${single.length ? `<h2>Pauses</h2>${single.map(pauseHtml).join('')}` : ''}
      ${wx && !multi ? `<h2>Météo prévue</h2><table>${wxHead}<tbody>${wx}</tbody></table>` : ''}
      ${pois.length && !multi ? `<h2>Sur le parcours</h2><table><tbody>${pois.map(poiRow).join('')}</tbody></table>` : ''}
      <p class="sub" style="margin-top:16px">Créé avec ${T.config.appName} · données © contributeurs OpenStreetMap · prévisions indicatives, vérifiez avant de partir.</p>
      </body></html>`;
  }

  T.hooks.act.roadbook = open;
})();
