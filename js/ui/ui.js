/* Composants d'interface génériques : fenêtres, notifications, choix du type de route. */
window.T = window.T || {};

T.ui = (() => {
  const I = T.icons, U = T.util;
  const $ = (s, r = document) => r.querySelector(s);

  function toast(msg, type = 'info', ms = 3800) {
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.innerHTML = I(type === 'error' ? 'warn' : 'info') + `<span>${U.esc(msg)}</span>`;
    $('#toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms);
  }

  let openDlg = null;
  function modal({ title, body, actions = [], wide = false, onClose }) {
    close();
    const root = document.createElement('div');
    root.className = 'dlg-wrap';
    root.innerHTML = `<div class="dlg${wide ? ' dlg-wide' : ''}" role="dialog" aria-modal="true" aria-label="${U.esc(title)}">
      <header><h2>${U.esc(title)}</h2><button class="icon-btn" data-x aria-label="Fermer">${I('close')}</button></header>
      <div class="dlg-body"></div>
      <footer></footer></div>`;
    const bodyEl = $('.dlg-body', root);
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const foot = $('footer', root);
    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn' + (a.primary ? ' btn-primary' : '') + (a.danger ? ' btn-danger' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => { if (a.onClick && a.onClick(root) === false) return; close(); });
      foot.appendChild(b);
    });
    if (!actions.length) foot.remove();
    root.addEventListener('mousedown', e => { if (e.target === root) close(); });
    $('[data-x]', root).addEventListener('click', close);
    document.body.appendChild(root);
    openDlg = { root, onClose };
    requestAnimationFrame(() => {
      root.classList.add('in');
      const f = $('input,textarea,select', bodyEl);
      if (f) f.focus();
    });
    return root;
  }
  function close() {
    if (!openDlg) return false;
    const { root, onClose } = openDlg;
    openDlg = null;
    root.classList.remove('in');
    setTimeout(() => root.remove(), 200);
    if (onClose) onClose();
    return true;
  }

  // Carte flottante « quel type de route ? »
  let chooser = null;
  function roadChooser({ title, mode, current, kind, onPick, autoShown }) {
    closeChooser();
    const m = T.config.modes[mode];
    const opts = [T.config.kinds.auto, ...m.roads, T.config.kinds.line];
    const el = document.createElement('div');
    el.className = 'chooser';
    el.innerHTML = `<div class="chooser-head"><b>${U.esc(title)}</b><button class="icon-btn" data-x aria-label="Fermer">${I('close')}</button></div>
      <div class="chooser-grid">${opts.map(r => {
        const on = (kind === 'line' && r.id === 'line') || (kind !== 'line' && r.id === current);
        const shown = kind !== 'line' && autoShown && r.id === autoShown;
        return `<button class="road-opt${on ? ' on' : ''}${shown ? ' shown' : ''}" data-road="${r.id}">
          <span class="cart" style="--c:${r.color};--ci:${r.ink}">${U.esc(r.short)}</span>
          <span class="ro-txt"><b>${U.esc(r.label)}</b><small>${U.esc(r.desc || '')}</small></span></button>`;
      }).join('')}</div>
      <p class="chooser-note">L’itinéraire s’adapte à votre choix quand la route le permet ; sinon, l’app vous le signale.</p>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-road]');
      if (b) { onPick(b.dataset.road); closeChooser(); return; }
      if (e.target.closest('[data-x]')) closeChooser();
    });
    document.getElementById('app').appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    chooser = el;
  }
  function closeChooser() {
    if (!chooser) return false;
    const el = chooser; chooser = null;
    el.classList.remove('in');
    setTimeout(() => el.remove(), 180);
    return true;
  }

  return { toast, modal, close, roadChooser, closeChooser, $ };
})();
