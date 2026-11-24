/* Jeevay — lecture du parcours : un point se déplace sur le tracé du début à la fin.
   Conception : le point est un marqueur DOM (aucune mise à jour des données de la carte), la caméra est recentrée à chaque image
   sur la zone réellement visible (marges), et la lecture est pilotée par une seule boucle requestAnimationFrame. */
(() => {
  const U = T.util, A = T.analysis, I = T.icons;
  const SPEEDS = [0.5, 1, 2, 4];                       // x1 : lent, pour bien voir le cheminement
  let bar = null, dot = null, comb = null;
  let d = 0, playing = false, follow = true, sp = 1, raf = 0, tPrev = 0;

  const base = () => U.clamp(comb.total / 12, 90, 420);  // secondes pour parcourir tout le tracé à x1
  const current = () => { const c = A.combine(T.app.st()); return c.coords.length > 1 && c.total > 0 ? c : null; };
  const $ = s => bar.querySelector(s);

  // Position sur le tracé à la distance d (interpolation linéaire entre deux points)
  function pos() {
    const c = comb, last = c.coords.length - 1;
    if (d <= 0) return c.coords[0];
    if (d >= c.total) return c.coords[last];
    const i = Math.min(Math.max(U.search(c.cum, d), 0), last - 1);
    const span = c.cum[i + 1] - c.cum[i] || 1, f = U.clamp((d - c.cum[i]) / span, 0, 1), a = c.coords[i], b = c.coords[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  // Marges de la carte : on retire ce qui la recouvre (barre du haut, outils, panneau, lecteur) pour centrer sur la zone libre
  function padding() {
    const W = window.innerWidth, H = window.innerHeight, r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const top = r('.topbar'), tools = r('.tools'), panel = r('#panel'), b = bar.getBoundingClientRect();
    const mobile = W <= 760;
    const p = { top: top ? top.bottom + 8 : 8, bottom: H - b.top + 8, left: 8, right: 8 };
    if (tools) { if (tools.left < W / 2) p.left = tools.right + 8; else p.right = W - tools.left + 8; }
    if (panel) { if (mobile) p.bottom = Math.max(p.bottom, H - panel.top + 8); else p.right = Math.max(p.right, W - panel.left + 8); }
    return p;
  }
  const applyPadding = () => { if (bar) T.map.raw.setPadding(padding()); };

  function render() {
    const p = pos(), e = A.eleAt(comb, d);
    dot.setLngLat(p);
    if (follow) T.map.raw.jumpTo({ center: p });
    $('input').value = String(Math.round(d / comb.total * 1000));
    $('.pl-info').textContent = `km ${U.nf(d / 1000, 1)} / ${U.nf(comb.total / 1000, 1)}${e != null ? ' · ' + U.nf(e) + ' m' : ''}`;
  }

  function labels() {
    const atEnd = d >= comb.total, b = $('[data-p=play]');
    b.innerHTML = I(playing ? 'pause' : 'play');
    const l = playing ? 'Pause' : atEnd ? 'Revoir depuis le début' : d > 0 ? 'Reprendre' : 'Lancer';
    b.setAttribute('aria-label', l); b.title = l;
    $('[data-p=follow]').hidden = follow;
  }

  function frame(t) {
    if (!playing) return;
    const dt = Math.min(0.1, (t - tPrev) / 1000);          // plafonné : pas de saut après un onglet en veille
    tPrev = t;
    d = Math.min(comb.total, d + dt * comb.total / base() * SPEEDS[sp]);
    render();
    if (d >= comb.total) { playing = false; labels(); return; }
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (playing) return;
    if (d >= comb.total) d = 0;
    playing = true; tPrev = performance.now(); labels();
    raf = requestAnimationFrame(frame);
  }
  function pause() { playing = false; cancelAnimationFrame(raf); raf = 0; labels(); }
  function restart() { pause(); d = 0; follow = true; applyPadding(); render(); play(); }
  function recenter() { follow = true; applyPadding(); render(); labels(); }

  function close() {
    if (!bar) return;
    pause();
    T.map.raw.off('dragstart', onDrag);
    window.removeEventListener('resize', applyPadding);
    T.map.raw.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    dot.remove(); dot = null; bar.remove(); bar = null; comb = null;
    document.getElementById('tool-play').setAttribute('aria-pressed', 'false');
  }
  // L'utilisateur déplace la carte à la main : on arrête de la recentrer (bouton « Recentrer » pour reprendre)
  function onDrag(e) { if (e.originalEvent && follow) { follow = false; labels(); } }

  function open() {
    if (bar) { close(); return; }
    comb = current();
    if (!comb) { T.ui.toast('Tracez d’abord un parcours pour le parcourir', 'info', 2500); return; }
    d = 0; follow = true; playing = false;
    bar = document.createElement('div');
    bar.className = 'player';
    bar.innerHTML = `<div class="pl-row">
        <button class="icon-btn" data-p="restart" aria-label="Recommencer du début" title="Recommencer du début">${I('restart')}</button>
        <button class="icon-btn pl-main" data-p="play"></button>
        <button class="icon-btn pl-speed" data-p="speed" aria-label="Vitesse" title="Vitesse">x${SPEEDS[sp]}</button>
        <span class="pl-info"></span>
        <button class="icon-btn pl-follow" data-p="follow" aria-label="Recentrer sur le point" title="Recentrer sur le point" hidden>${I('locate')}</button>
        <button class="icon-btn" data-p="stop" aria-label="Fermer" title="Fermer">${I('close')}</button>
      </div>
      <input type="range" min="0" max="1000" value="0" aria-label="Position sur le parcours">`;
    document.getElementById('app').appendChild(bar);
    document.getElementById('tool-play').setAttribute('aria-pressed', 'true');
    T.app.collapseSheet();
    const el = document.createElement('div'); el.className = 'pl-dot';
    dot = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(comb.coords[0]).addTo(T.map.raw);

    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      const a = b.dataset.p;
      if (a === 'play') (playing ? pause() : play());
      else if (a === 'restart') restart();
      else if (a === 'stop') close();
      else if (a === 'follow') recenter();
      else if (a === 'speed') { sp = (sp + 1) % SPEEDS.length; b.textContent = 'x' + SPEEDS[sp]; }
    });
    // Curseur : on met en pause pendant qu'on le tient, puis on reprend si la lecture était en cours
    const rng = $('input'); let was = false;
    rng.addEventListener('pointerdown', () => { was = playing; pause(); });
    rng.addEventListener('input', () => { d = +rng.value / 1000 * comb.total; follow = true; render(); labels(); });
    const up = () => { if (was) { was = false; play(); } };
    rng.addEventListener('pointerup', up); rng.addEventListener('pointercancel', up);

    T.map.raw.on('dragstart', onDrag);
    window.addEventListener('resize', applyPadding);
    // Zoom adapté à la longueur (≈ 10 pour 120 km, 12 pour 10 km, 14 pour 2 km), puis recentrage sur la zone libre
    T.map.raw.jumpTo({ zoom: U.clamp(15 - 0.75 * Math.log2(comb.total / 1000 + 1), 8.5, 15), center: comb.coords[0] });
    applyPadding(); render(); labels();
    setTimeout(() => { if (bar && !playing && d === 0) play(); }, 350);   // laisse la carte se placer avant de démarrer
  }

  // Le tracé a été modifié : la position n'a plus de sens, on ferme proprement
  T.hooks.render.push(() => { if (bar) { const c = current(); if (!c || Math.abs(c.total - comb.total) > 1) close(); } });
  T.hooks.act.play = open;
})();
