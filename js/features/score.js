/* V2 — Score « plaisir moto » sur 10 : virages, petites routes, relief ; pénalise autoroutes et grands axes. */
(() => {
  const clamp = T.util.clamp;
  function compute({ sinu, comp, up, distance }) {
    if (!distance || distance < 2000) return null;
    const known = comp ? Object.entries(comp).filter(([k]) => k !== 'inconnu').reduce((s, [, v]) => s + v, 0) : 0;
    const share = id => (known ? (comp[id] || 0) / known : 0);
    let v = 1.5 + clamp((sinu || 0) / 160, 0, 1) * 4.5
      + (known ? (share('departementale') + share('locale')) * 2.5 : 1)
      + clamp((up || 0) / (distance / 1000) / 20, 0, 1) * 1.5
      - share('autoroute') * 3 - share('nationale') * 0.8 - share('chemin') * 1;
    v = Math.round(clamp(v, 0, 10) * 10) / 10;
    const label = v < 4 ? 'Pour avancer' : v < 6 ? 'Sympa' : v < 8 ? 'Belle balade' : 'Pur plaisir';
    return { v, label };
  }
  T.score = {
    total: sum => compute({ sinu: sum.sinu, comp: sum.compKnown ? sum.comp : null, up: sum.up, distance: sum.distance }),
    leg: L => (L.status === 'ok' && L.an ? compute({ sinu: L.an.sinu, comp: L.an.comp, up: L.an.up, distance: L.distance }) : null)
  };
})();
