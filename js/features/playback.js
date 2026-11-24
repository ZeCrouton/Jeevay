/* Jeevay — lecture du parcours : un point se déplace sur le tracé, du début à la fin (pause, reprise, recommencer). */
(() => {
  const U = T.util, A = T.analysis, I = T.icons;
  const SPEEDS = [1, 2, 4, 8], BASE = 45;   // x1 : le parcours entier en 45 s
  let bar = null, d = 0, playing = false, raf = 0, t0 = 0, sp = 0, comb = null, zoomed = false;

  const pos = c => {
    const i = Math.min(U.search(c.cum, d), c.coords.length - 2);
    if (i < 0) return c.coords[0];
    const span = c.cum[i + 1] - c.cum[i] || 1, f = U.clamp((d - c.cum[i]) / span, 0, 1);
    return [c.coords[i][0] + (c.coords[i + 1][0] - c.coords[i][0]) * f, c.coords[i][1] + (c.coords[i + 1][1] - c.coords[i][1]) * f];
  };
  const current = () => { const c = A.combine(T.app.st()); return c.coords.length > 1 && c.total > 0 ? c : null; };

  function show() {
    const p = pos(comb);
    T.map.setHover(p, T.app.accent());
    T.map.raw.jumpTo({ center: p });
    const e = A.eleAt(comb, d);
    bar.querySelector('input').value = String(Math.round(d / comb.total * 1000));
    bar.querySelector('.pl-info').textContent = `km ${U.nf(d / 1000, 1)} / ${U.nf(comb.total / 1000, 1)}${e != null ? ' · ' + U.nf(e) + ' m' : ''}`;
  }
  function btn() { bar.querySelector('[data-p=play]').innerHTML = I(playing ? 'pause' : 'play'); bar.querySelector('[data-p=play]').setAttribute('aria-label', playing ? 'Pause' : d > 0 && d < comb.total ? 'Reprendre' : 'Lancer'); }
  function frame(t) {
    if (!playing) return;
    d = Math.min(comb.total, d + (t - t0) / 1000 * comb.total / BASE * SPEEDS[sp]); t0 = t;
    show();
    if (d >= comb.total) { playing = false; btn(); return; }
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (!comb) return;
    if (d >= comb.total) d = 0;
    if (!zoomed) { zoomed = true; if (T.map.raw.getZoom() < 12) T.map.raw.setZoom(12); }
    playing = true; t0 = performance.now(); btn(); raf = requestAnimationFrame(frame);
  }
  function pause() { playing = false; cancelAnimationFrame(raf); btn(); }
  function restart() { pause(); d = 0; show(); play(); }
  function close() { pause(); d = 0; zoomed = false; T.map.setHover(null); if (bar) { bar.remove(); bar = null; } document.getElementById('tool-play').setAttribute('aria-pressed', 'false'); }

  function open() {
    comb = current();
    if (!comb) { T.ui.toast('Tracez d’abord un parcours pour le parcourir', 'info', 2500); return; }
    if (bar) { close(); return; }
    d = 0; zoomed = false;
    bar = document.createElement('div');
    bar.className = 'player';
    bar.innerHTML = `<div class="pl-row">
        <button class="icon-btn" data-p="restart" aria-label="Recommencer du début" title="Recommencer du début">${I('restart')}</button>
        <button class="icon-btn pl-main" data-p="play"></button>
        <button class="icon-btn pl-speed" data-p="speed" aria-label="Vitesse" title="Vitesse">x1</button>
        <span class="pl-info"></span>
        <button class="icon-btn" data-p="stop" aria-label="Arrêter et fermer" title="Arrêter et fermer">${I('close')}</button>
      </div>
      <input type="range" min="0" max="1000" value="0" aria-label="Position sur le parcours">`;
    document.getElementById('app').appendChild(bar);
    document.getElementById('tool-play').setAttribute('aria-pressed', 'true');
    T.app.collapseSheet();
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      const a = b.dataset.p;
      if (a === 'play') (playing ? pause() : play());
      else if (a === 'restart') restart();
      else if (a === 'stop') close();
      else if (a === 'speed') { sp = (sp + 1) % SPEEDS.length; b.textContent = 'x' + SPEEDS[sp]; }
    });
    bar.querySelector('input').addEventListener('input', e => { d = +e.target.value / 1000 * comb.total; show(); });
    btn(); show(); play();
  }

  // Le tracé a changé : on arrête la lecture (position devenue fausse)
  T.hooks.render.push((s, sum, c) => { if (bar && (!current() || Math.abs(current().total - comb.total) > 1)) close(); });
  T.hooks.act.play = open;
})();
