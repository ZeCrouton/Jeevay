/* Rendu du panneau latéral : résumé, composition, alertes, tronçons. */
window.T = window.T || {};

T.panel = (() => {
  const U = T.util, I = T.icons, A = T.analysis;

  // Pour un tronçon « proposé », le type affiché est celui de la voie majoritaire du trajet calculé
  const AUTO_MAP = {
    moto: { autoroute: 'autoroute', nationale: 'nationale', departementale: 'departementale', locale: 'petites' },
    velo: { cyclable: 'calme', locale: 'calme', chemin: 'vtt', departementale: 'route', nationale: 'route' },
    run: { chemin: 'trail', pieton: 'urbain' }
  };
  function roadOf(L, mode) {
    if (L.kind === 'line') return T.config.kinds.line;
    if (L.kind === 'track') return T.config.kinds.track;
    const m = T.config.modes[mode];
    if (L.road === 'auto') {
      const comp = L.an && L.an.comp;
      if (!comp) return { ...T.config.kinds.auto, auto: true };
      let main = null, v = 0;
      for (const k in comp) if (k !== 'inconnu' && comp[k] > v) { v = comp[k]; main = k; }
      const id = (AUTO_MAP[mode] || {})[main] || m.roads[0].id;
      return { ...(m.roads.find(r => r.id === id) || m.roads[0]), auto: true };
    }
    return m.roads.find(r => r.id === L.road) || m.roads[0];
  }

  function summary(sum, state) {
    const n = state.waypoints.length;
    if (!n) return '';
    const busy = sum.pending > 0;
    const big = (v, u, l) => `<div class="fig"><span class="v">${v}<small>${u}</small></span><span class="l">${l}</span></div>`;
    const km = sum.distance >= 100000 ? U.nf(sum.distance / 1000) : U.nf(sum.distance / 1000, 1);
    const lvl = sum.level ? `<span class="level lvl-${sum.level[1]}">${sum.level[0]}</span>` : '';
    const meta = [];
    if (sum.maxE != null) meta.push(`Alt. max <b>${U.nf(sum.maxE)} m</b>`);
    if (sum.maxS || sum.minS) meta.push(`Pente max <b>${U.nf(Math.max(sum.maxS, -sum.minS), 0)} %</b>`);
    const sc = state.mode === 'moto' && T.score ? T.score.total(sum) : null;
    if (sc) meta.unshift(`<span class="score" style="--p:${sc.v * 10}%" title="Virages, petites routes et relief">Plaisir moto <b>${U.nf(sc.v, 1)}/10</b> · ${sc.label}</span>`);
    else if (state.mode === 'moto' && sum.distance > 2000) meta.push(`Route <b>${A.sinuLabel(sum.sinu)}</b>`);
    if (state.mode === 'run' && sum.distance > 0) {
      const pace = T.settings.get().runPace;
      meta.push(`Allure <b>${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, '0')} /km</b>`);
    }
    return `<div class="figs${busy ? ' busy' : ''}">
        ${big(km, 'km', 'Distance')}
        ${big(U.fmtDur(sum.duration).replace(/ (h|min)/g, '<small>$1</small>'), '', 'Durée estimée')}
        ${big('+' + U.nf(sum.up), 'm', 'Dénivelé +')}
        ${big('−' + U.nf(sum.down), 'm', 'Dénivelé −')}
      </div>
      <div class="meta">${lvl}${meta.map(x => `<span>${x}</span>`).join('')}
        ${busy ? `<span class="calc"><i class="spin"></i>Calcul de ${sum.pending} tronçon${sum.pending > 1 ? 's' : ''}…</span>` : ''}</div>`;
  }

  function composition(sum) {
    if (!sum.distance) return '';
    const parts = A.GROUPS.map(g => ({ ...g, v: sum.comp[g.id] || 0 })).filter(g => g.v > sum.distance * 0.004);
    if (!parts.length) return '';
    const tot = parts.reduce((s, p) => s + p.v, 0);
    return `<h3>Types de voies</h3>
      <div class="bar">${parts.map(p => `<span style="width:${(p.v / tot * 100).toFixed(2)}%;background:${p.color}" title="${U.esc(p.label)}"></span>`).join('')}</div>
      <ul class="legend">${parts.map(p => `<li><i style="background:${p.color}"></i>${U.esc(p.label)}<b>${U.nf(p.v / tot * 100)} %</b><span>${U.fmtKm(p.v)}</span></li>`).join('')}</ul>`;
  }

  let alertsOpen = false;
  function alerts(sum) {
    const n = sum.alerts.length;
    if (!n) return '';
    const shown = alertsOpen ? sum.alerts : sum.alerts.slice(0, 3);
    return `<h3>Points d’attention <span class="cnt">${n}</span></h3><ul class="alerts">${shown.map(a =>
      `<li><button class="alert alert-${a.lvl}" data-act="goto" data-d="${Math.round(a.d)}">${I(a.lvl === 'warn' ? 'warn' : 'info')}<span>${U.esc(a.text)}</span></button></li>`).join('')}</ul>
      ${n > 3 ? `<button class="more-btn${alertsOpen ? ' open' : ''}" data-act="alertsToggle" aria-expanded="${alertsOpen}">${alertsOpen ? 'Réduire' : `Voir les ${n - 3} autres`}${I('chev', 'sm')}</button>` : ''}`;
  }
  T.hooks.act.alertsToggle = () => { alertsOpen = !alertsOpen; T.app.render(); };

  function legs(state) {
    if (!state.legs.length) return '';
    const name = i => {
      const w = state.waypoints[i];
      return U.esc(w && w.name ? w.name : i === 0 ? 'Départ' : i === state.waypoints.length - 1 ? 'Arrivée' : 'Étape ' + i);
    };
    const node = i => i === 0 ? 'D' : i === state.waypoints.length - 1 ? 'A' : i;
    return `<h3>Tronçons</h3><ol class="legs">${state.legs.map((L, i) => {
      const r = roadOf(L, state.mode), a = L.an || {};
      let st = '';
      if (L.status === 'pending') st = '<span class="calc"><i class="spin"></i>calcul…</span>';
      else if (L.status === 'error') st = `<span class="err">${U.esc(L.error)}</span><button class="mini" data-act="retry" data-i="${i}">${I('retry')}Réessayer</button>`;
      else st = (() => { const mm = A.mismatch(L, a, state.mode); return mm ? `<span class="mm">${I('info', 'sm')}${mm.absent ? 'absent' : 'minoritaire (' + U.nf(mm.share * 100) + ' %)'} · surtout ${U.esc(A.gLabel(mm.main))}</span>` : ''; })() + `<span>${U.fmtKm(L.distance)}</span>${a.hasElev ? `<span>+${U.nf(a.up)} m</span>` : ''}${state.mode === 'moto' && T.score && T.score.leg(L) ? `<span class="lsc" title="Plaisir moto">${U.nf(T.score.leg(L).v, 1)}/10</span>` : ''}${(a.hairpins || []).length && state.mode !== 'run' ? `<span>${a.hairpins.length} épingle${a.hairpins.length > 1 ? 's' : ''}</span>` : ''}`;
      const chip = L.kind === 'track'
        ? `<span class="chip" style="--c:${r.color};--ci:${r.ink}" title="${U.esc(L.name || '')}"><span class="cart">${r.short}</span>${U.esc(L.name || r.label)}</span>`
        : `<button class="chip" data-act="road" data-i="${i}" style="--c:${r.color};--ci:${r.ink}" title="Changer le type de route préféré"><span class="pref">Préférer</span><span class="cart">${U.esc(r.short)}</span>${U.esc(r.label)}${r.auto ? '<span class="pref">proposé</span>' : ''}${I('chev', 'sm')}</button>`;
      return `<li class="leg leg-${L.status}">
        <button class="leg-names" data-act="focus" data-i="${i}"><span class="node">${node(i)}</span>${name(i)}<i>→</i><span class="node">${node(i + 1)}</span>${name(i + 1)}</button>
        <div class="leg-meta">${chip}${st}</div></li>`;
    }).join('')}</ol>`;
  }

  function empty(mode) {
    return `<div class="empty">
      <svg viewBox="0 0 220 120" class="empty-art" aria-hidden="true">
        <path d="M18 98 C 60 98, 50 30, 98 34 S 150 92, 200 24" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="1 14"/>
        <circle cx="18" cy="98" r="11" fill="var(--accent)"/><text x="18" y="102.5" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">D</text>
        <circle cx="98" cy="34" r="9" fill="var(--panel)" stroke="var(--ink)" stroke-width="3"/>
        <circle cx="200" cy="24" r="11" fill="var(--ink)"/><text x="200" y="28.5" text-anchor="middle" font-size="12" font-weight="700" fill="var(--panel)">A</text>
      </svg>
      <p class="lead">Touchez la carte pour poser le <b>départ</b>, puis vos étapes.</p>
      <p>Le tracé, le dénivelé et les difficultés s’affichent aussitôt. Pour chaque tronçon, vous pouvez ensuite indiquer le type de route à préférer${mode === 'moto' ? ' (autoroute, nationale, départementale ou petites routes)' : ''}.</p>
      <div class="empty-actions">
        <button class="btn" data-act="import">${I('upload')}Importer un GPX / KML</button>
        <button class="btn" data-act="gmaps">${I('gmaps')}Lien Google Maps</button>
        <button class="btn" data-act="loop">${I('route')}Créer une boucle</button>
      </div></div>`;
  }

  return { summary, composition, alerts, legs, empty, roadOf };
})();
