/* Profil altimétrique interactif (canvas). */
window.T = window.T || {};

T.profile = (() => {
  let wrap, cv, tip, data = null, onHover = () => {}, hoverX = null;
  const PAD = { l: 44, r: 12, t: 14, b: 22 };

  function init(el, hover) {
    wrap = el; onHover = hover;
    cv = el.querySelector('canvas');
    tip = el.querySelector('.profile-tip');
    new ResizeObserver(() => draw()).observe(el);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerdown', move);
    cv.addEventListener('pointerleave', () => { hoverX = null; tip.hidden = true; draw(); onHover(null); });
  }

  function set(d) { data = d; draw(); }

  // Résout une variable CSS (y compris light-dark()) en couleur utilisable par le canvas
  let probe = null;
  const css = n => {
    if (!probe) { probe = document.createElement('i'); probe.style.display = 'none'; document.body.appendChild(probe); }
    probe.style.color = `var(${n})`;
    return getComputedStyle(probe).color;
  };

  function geom(W = cv.clientWidth, H = cv.clientHeight) {
    const S = data.samples;
    let lo = Infinity, hi = -Infinity;
    S.forEach(p => { if (p.e < lo) lo = p.e; if (p.e > hi) hi = p.e; });
    const span = Math.max(40, hi - lo);
    lo = Math.max(0, lo - span * 0.12); hi = hi + span * 0.12;
    const x = d => PAD.l + (d / data.total) * (W - PAD.l - PAD.r);
    const y = e => PAD.t + (1 - (e - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    return { W, H, lo, hi, x, y };
  }

  // out (facultatif) : dessin sur un autre canevas, pour l'impression : { cv, W, H, scale }
  function draw(out) {
    const print = !!(out && out.cv), target = print ? out.cv : cv;
    if (!target) return;
    const dpr = print ? out.scale : window.devicePixelRatio || 1;
    const W = print ? out.W : target.clientWidth, H = print ? out.H : target.clientHeight;
    target.width = Math.round(W * dpr); target.height = Math.round(H * dpr);
    const g = target.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const has = data && data.samples.length > 1 && data.total > 0;
    if (!print) wrap.classList.toggle('is-empty', !has);
    if (!has) return;
    // Impression : couleurs claires fixes, quel que soit le thème de l'écran
    const G = geom(W, H), S = data.samples, ink = print ? '#14161b' : css('--ink') || '#111', muted = print ? '#5f6672' : css('--muted') || '#888', line = print ? '#e3e6ea' : css('--line') || '#ddd';
    g.font = '12px "Barlow Semi Condensed", system-ui, sans-serif';
    // Grille horizontale
    const step = niceStep((G.hi - G.lo) / 3);
    g.strokeStyle = line; g.fillStyle = muted; g.lineWidth = 1; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let e = Math.ceil(G.lo / step) * step; e <= G.hi; e += step) {
      const yy = Math.round(G.y(e)) + 0.5;
      g.beginPath(); g.moveTo(PAD.l, yy); g.lineTo(G.W - PAD.r, yy); g.stroke();
      g.fillText(T.util.nf(e) + ' m', PAD.l - 6, yy);
    }
    // Graduation km
    g.textAlign = 'center'; g.textBaseline = 'top';
    const kmStep = niceStep(data.total / 1000 / Math.max(2, Math.floor((W - 80) / 90)));
    for (let k = kmStep; k * 1000 < data.total; k += kmStep) g.fillText(T.util.nf(k, kmStep < 1 ? 1 : 0) + ' km', G.x(k * 1000), G.H - PAD.b + 5);
    // Aire
    const grad = g.createLinearGradient(0, PAD.t, 0, G.H - PAD.b);
    grad.addColorStop(0, hexA(data.accent, 0.35)); grad.addColorStop(1, hexA(data.accent, 0.04));
    g.beginPath(); g.moveTo(G.x(S[0].d), G.H - PAD.b);
    S.forEach(p => g.lineTo(G.x(p.d), G.y(p.e)));
    g.lineTo(G.x(S[S.length - 1].d), G.H - PAD.b); g.closePath();
    g.fillStyle = grad; g.fill();
    // Ligne colorée selon la pente
    g.lineWidth = 2.5; g.lineJoin = 'round';
    const cols = T.config.slopeColors;
    for (let i = 1; i < S.length; i++) {
      g.strokeStyle = cols[T.analysis.slopeClass(S[i].s)];
      g.beginPath(); g.moveTo(G.x(S[i - 1].d), G.y(S[i - 1].e)); g.lineTo(G.x(S[i].d), G.y(S[i].e)); g.stroke();
    }
    // Étapes
    g.setLineDash([3, 3]); g.strokeStyle = muted; g.lineWidth = 1;
    data.marks.slice(1, -1).forEach(d => { const xx = Math.round(G.x(d)) + 0.5; g.beginPath(); g.moveTo(xx, PAD.t); g.lineTo(xx, G.H - PAD.b); g.stroke(); });
    g.setLineDash([]);
    // Survol
    if (!print && hoverX != null) {
      const d = xToD(hoverX, G), e = T.analysis.eleAt(data.comb, d), xx = G.x(d), yy = G.y(e);
      g.strokeStyle = ink; g.lineWidth = 1;
      g.beginPath(); g.moveTo(xx + 0.5, PAD.t); g.lineTo(xx + 0.5, G.H - PAD.b); g.stroke();
      g.fillStyle = '#fff'; g.strokeStyle = data.accent; g.lineWidth = 3;
      g.beginPath(); g.arc(xx, yy, 5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }

  // Image haute définition du profil (pleine largeur d'une page A4), indépendante de la taille à l'écran
  function image() {
    if (!data || data.samples.length < 2 || !(data.total > 0)) return null;
    const c = document.createElement('canvas');
    draw({ cv: c, W: 720, H: 200, scale: 4 });
    return c.toDataURL('image/png');
  }

  function xToD(px, G) { return T.util.clamp((px - PAD.l) / (G.W - PAD.l - PAD.r), 0, 1) * data.total; }

  function move(ev) {
    if (!data || data.samples.length < 2) return;
    const r = cv.getBoundingClientRect();
    hoverX = ev.clientX - r.left;
    const G = geom(), d = xToD(hoverX, G);
    const e = T.analysis.eleAt(data.comb, d), s = T.analysis.slopeAt(data.comb, d);
    tip.hidden = false;
    tip.innerHTML = `<b>km ${T.util.nf(d / 1000, 1)}</b> · ${T.util.nf(e)} m · <span style="color:${T.config.slopeColors[T.analysis.slopeClass(s)]}">${s > 0 ? '+' : ''}${T.util.nf(s, 0)} %</span>`;
    const tw = tip.offsetWidth;
    tip.style.left = T.util.clamp(hoverX - tw / 2, 4, r.width - tw - 4) + 'px';
    draw();
    onHover(d);
  }

  function showAt(d) { // survol depuis la carte (non utilisé pour l'instant, prévu)
    if (!data) return;
    const G = geom(); hoverX = d == null ? null : G.x(d); draw();
  }

  function niceStep(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
  }
  function hexA(hex, a) {
    const m = hex.replace('#', ''), v = parseInt(m.length === 3 ? m.split('').map(x => x + x).join('') : m, 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  }

  return { init, set, showAt, image };
})();
