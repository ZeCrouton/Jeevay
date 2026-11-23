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
    T.app.fitAll();
    await new Promise(r => setTimeout(r, 700));
    const mapImg = await T.map.snapshot();
    const prof = document.querySelector('#profile canvas');
    let profImg = null;
    try { profImg = prof && prof.width ? prof.toDataURL('image/png') : null; } catch (e) { /* ignore */ }
    const sum = A.summary(s);
    T.hooks.alerts.forEach(f => { try { f(s, sum, comb); } catch (e) { /* ignore */ } });
    w.document.open();
    w.document.write(html(s, sum, comb, mapImg, profImg));
    w.document.close();
  }

  function html(s, sum, comb, mapImg, profImg) {
    const mode = T.config.modes[s.mode], dep = T.weather ? T.weather.departure() : null, hm = T.weather ? T.weather.hm : () => '';
    const sc = s.mode === 'moto' && T.score ? T.score.total(sum) : null;
    const name = i => T.io.export.wpName(s.waypoints[i], i, s.waypoints.length);
    const at = d => dep ? hm(new Date(dep.getTime() + T.weather.timeAt(s, comb, sum, d) * 1000)) : '';
    const rows = s.legs.map((L, i) => {
      const r = T.panel.roadOf(L, s.mode), a = L.an || {}, mm = A.mismatch(L, a, s.mode);
      const main = a.comp ? Object.entries(a.comp).sort((x, y) => y[1] - x[1])[0] : null;
      return `<tr><td>${i + 1}</td><td>${U.esc(name(i))} → ${U.esc(name(i + 1))}</td>
        <td>${U.esc(L.kind === 'track' ? (L.name || r.label) : r.label)}${mm ? '<br><small>surtout ' + U.esc(A.gLabel(mm.main)) + '</small>' : main ? '' : ''}</td>
        <td class="n">${U.fmtKm(L.distance || 0)}</td><td class="n">${U.nf((comb.starts[i + 1] || 0) / 1000, 1)}</td>
        <td class="n">${a.hasElev ? '+' + U.nf(a.up) + ' m' : '—'}</td><td class="n">${at(comb.starts[i + 1])}</td></tr>`;
    }).join('');
    const wx = T.weather && T.weather.data.rows.length ? T.weather.data.rows.filter(r => r.w).map(r =>
      `<tr><td class="n">${hm(r.t)}</td><td class="n">km ${U.nf(r.d / 1000)}</td><td>${T.providers.weather.kind(r.w.code)[1]}</td><td class="n">${Math.round(r.w.temp)} °C</td><td class="n">${r.w.rainProb ?? 0} %</td><td class="n">${Math.round(r.w.wind)} / ${Math.round(r.w.gust)} km/h</td></tr>`).join('') : '';
    const pois = T.poi ? T.poi.visible(s).filter(p => ['fuel', 'pass', 'water'].includes(p.cat)).slice(0, 60) : [];
    const css = `@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:11pt/1.4 Barlow,system-ui,sans-serif;color:#14161b;margin:0 auto;max-width:190mm;padding:12px}
      h1{font-size:22pt;margin:0 0 2px}h2{font-size:13pt;margin:18px 0 6px;border-bottom:2px solid ${mode.accent};padding-bottom:3px}
      .sub{color:#5f6672;margin:0 0 10px}.figs{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:10px 0}
      .figs div{border:1px solid #e3e6ea;border-radius:8px;padding:6px 8px}.figs b{display:block;font-size:15pt}.figs span{color:#5f6672;font-size:9pt}
      img{width:100%;border-radius:8px;border:1px solid #e3e6ea;display:block}.prof{margin-top:6px;height:auto}
      table{width:100%;border-collapse:collapse;font-size:10pt}td,th{padding:4px 6px;border-bottom:1px solid #e3e6ea;text-align:left;vertical-align:top}
      th{font-size:9pt;color:#5f6672}.n{text-align:right;white-space:nowrap}ul{margin:0;padding-left:18px}li{margin:2px 0}
      .warn{color:#a61e1e}.bar{display:flex;gap:8px;justify-content:flex-end;margin-bottom:8px}.bar button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #14161b;background:#14161b;color:#fff;cursor:pointer}
      small{color:#5f6672}@media print{.bar{display:none}body{padding:0}h2{break-after:avoid}tr{break-inside:avoid}}`;
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Road-book — ${U.esc(s.name)}</title>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&display=swap"><style>${css}</style></head><body>
      <div class="bar"><button onclick="print()">Imprimer / enregistrer en PDF</button></div>
      <h1>${U.esc(s.name)}</h1>
      <p class="sub">${mode.label}${dep ? ' · départ ' + dep.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' à ' + hm(dep) : ''}${sum.level ? ' · niveau ' + sum.level[0] : ''}${sc ? ' · plaisir moto ' + U.nf(sc.v, 1) + '/10' : ''}</p>
      <div class="figs"><div><b>${U.fmtKm(sum.distance)}</b><span>Distance</span></div><div><b>${U.fmtDur(sum.duration)}</b><span>Durée estimée</span></div>
        <div><b>+${U.nf(sum.up)} m</b><span>Dénivelé +</span></div><div><b>−${U.nf(sum.down)} m</b><span>Dénivelé −</span></div>
        <div><b>${sum.maxE != null ? U.nf(sum.maxE) + ' m' : '—'}</b><span>Altitude max</span></div></div>
      ${mapImg ? `<img src="${mapImg}" alt="Carte du parcours">` : ''}
      ${profImg ? `<img class="prof" src="${profImg}" alt="Profil altimétrique">` : ''}
      <h2>Étapes</h2><table><thead><tr><th>#</th><th>Tronçon</th><th>Route</th><th class="n">Distance</th><th class="n">Cumul km</th><th class="n">D+</th><th class="n">${dep ? 'Arrivée' : ''}</th></tr></thead><tbody>${rows}</tbody></table>
      ${sum.alerts.length ? `<h2>Points d’attention</h2><ul>${sum.alerts.map(a => `<li class="${a.lvl === 'warn' ? 'warn' : ''}">${U.esc(a.text)}</li>`).join('')}</ul>` : ''}
      ${wx ? `<h2>Météo prévue</h2><table><thead><tr><th class="n">Heure</th><th class="n">Lieu</th><th>Ciel</th><th class="n">Temp.</th><th class="n">Pluie</th><th class="n">Vent / rafales</th></tr></thead><tbody>${wx}</tbody></table>` : ''}
      ${pois.length ? `<h2>Sur le parcours</h2><table><tbody>${pois.map(p => `<tr><td class="n">km ${U.nf(p.d / 1000, 1)}</td><td>${U.esc(T.providers.poi.CATS[p.cat].label.replace(/s$/, ''))}</td><td>${U.esc(p.name)}</td><td class="n">à ${U.fmtKm(p.off)}</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="sub" style="margin-top:16px">Créé avec ${T.config.appName} · données © contributeurs OpenStreetMap · prévisions indicatives, vérifiez avant de partir.</p>
      </body></html>`;
  }

  T.hooks.act.roadbook = open;
})();
