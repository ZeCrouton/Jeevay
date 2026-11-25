/* V3 — Partage par lien, sans serveur : le parcours est compressé dans l'adresse (#r=…).
   Le destinataire recalcule les tronçons ; les tracés importés sont simplifiés (~5 m). */
(() => {
  const U = T.util, I = T.icons;
  const PREFIX = '#r=';

  const b64u = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64u = str => {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  };
  async function pipe(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
  }
  const canZip = typeof CompressionStream !== 'undefined';

  function pack(s) {
    return {
      v: 1, n: s.name, m: s.mode,
      w: U.encode(s.waypoints.map(w => w.c), 5),
      k: s.waypoints.map(w => (w.locked ? 1 : 0) + (w.gap ? 2 : 0) + (w.night ? 4 : 0)).join(''),
      l: s.legs.map(L => L.kind === 'track'
        ? ['t', U.encode(U.simplify(L.coords, 5), 5), L.name || '']
        : L.kind === 'line' ? ['l'] : ['r', L.road])
    };
  }

  function unpack(o) {
    const mode = T.config.modes[o.m] ? o.m : 'moto';
    const cs = U.decode(o.w, 5), lk = String(o.k || '');
    const waypoints = cs.map((c, i) => { const f = +lk[i] || 0; return { id: U.uid(), c, locked: !!(f & 1), name: null, ...(f & 2 ? { gap: true } : {}), ...(f & 4 ? { night: true } : {}) }; });
    const legs = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i], b = waypoints[i + 1], d = (o.l || [])[i] || ['r'];
      const base = { id: U.uid(), rev: 1, from: a.id, to: b.id, fromC: a.c, toC: b.c, mode, status: 'pending', coords: null };
      if (d[0] === 't') {
        const c = U.decode(d[1], 5);
        c[0] = a.c; c[c.length - 1] = b.c;
        legs.push({ ...base, kind: 'track', road: null, name: d[2] || null, coords: c });
      } else if (d[0] === 'l') legs.push({ ...base, kind: 'line', road: null });
      else legs.push({ ...base, kind: 'route', road: d[1] || T.engine.defaultRoad(mode) });
    }
    return { name: String(o.n || 'Parcours partagé').slice(0, 60), mode, waypoints, legs };
  }

  async function encode(s) {
    const json = new TextEncoder().encode(JSON.stringify(pack(s)));
    return canZip ? 'z' + b64u(await pipe(json, new CompressionStream('deflate-raw'))) : 'j' + b64u(json);
  }
  async function decode(str) {
    const kind = str[0], bytes = unb64u(str.slice(1));
    const raw = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
    return unpack(JSON.parse(new TextDecoder().decode(raw)));
  }

  async function shareDialog() {
    const s = T.app.st();
    if (s.waypoints.length < 2) { T.ui.toast('Tracez d’abord un parcours', 'error'); return; }
    let url;
    try { url = location.href.split('#')[0] + PREFIX + await encode(s); }
    catch (e) { T.ui.toast('Impossible de créer le lien', 'error'); return; }
    const long = url.length > 8000;
    const local = location.protocol === 'file:';
    const root = T.ui.modal({
      title: 'Partager le parcours',
      body: `<p class="muted">Ce lien contient tout le parcours : aucun compte ni serveur. La personne qui l’ouvre le retrouve tel quel et peut le modifier de son côté.</p>
        <textarea id="sh-url" rows="3" readonly>${U.esc(url)}</textarea>
        ${long ? `<p class="muted small">Lien long (${U.nf(url.length)} caractères) à cause des tracés importés : certaines messageries peuvent le couper. L’e-mail fonctionne toujours.</p>` : ''}
        ${local ? '<p class="err">Le site est ouvert depuis un fichier de votre PC : le lien ne fonctionnera qu’une fois le site en ligne.</p>' : ''}
        <div class="sh-a"><button class="btn btn-primary" data-copy>${I('link')}Copier le lien</button>
        ${navigator.share ? `<button class="btn" data-share>${I('upload')}Envoyer…</button>` : ''}</div>`
    });
    root.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); T.ui.toast('Lien copié'); }
      catch (e) { const t = root.querySelector('#sh-url'); t.select(); document.execCommand('copy'); T.ui.toast('Lien copié'); }
    });
    const sh = root.querySelector('[data-share]');
    if (sh) sh.addEventListener('click', () => navigator.share({ title: s.name, text: `Parcours « ${s.name} »`, url }).catch(() => {}));
  }

  async function openFromHash() {
    if (!location.hash.startsWith(PREFIX)) return;
    let data;
    try { data = await decode(location.hash.slice(PREFIX.length)); }
    catch (e) { T.ui.toast('Ce lien de partage est incomplet ou abîmé', 'error', 6000); }
    history.replaceState(null, '', location.href.split('#')[0]);
    if (!data) return;
    const go = () => { T.app.S.replace(data); data.waypoints.forEach(w => T.app.nameLater(w.id)); setTimeout(T.app.fitAll, 300); };
    if (!T.app.st().waypoints.length) { go(); T.ui.toast(`Parcours partagé « ${data.name} » ouvert`); return; }
    T.ui.modal({
      title: 'Parcours partagé',
      body: `<p>Ouvrir <b>${U.esc(data.name)}</b> (${data.waypoints.length} points, ${T.config.modes[data.mode].label}) ?</p>
        <p class="muted small">Il remplace le parcours affiché. Ctrl+Z pour revenir en arrière, ou enregistrez d’abord le vôtre dans « Mes parcours ».</p>`,
      actions: [{ label: 'Plus tard' }, { label: 'Ouvrir', primary: true, onClick: go }]
    });
  }

  T.hooks.act.share = shareDialog;
  T.hooks.init.push(() => {
    window.addEventListener('hashchange', openFromHash);
    setTimeout(openFromHash, 200);
  });
  T.share = { encode, decode, pack, unpack };
})();
