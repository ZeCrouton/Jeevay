/* Points d'extension : les modules (points d'intérêt, météo, partage…) s'y branchent sans toucher au cœur. */
window.T = window.T || {};
T.hooks = {
  render: [],   // f(state, summary, comb) : après chaque rendu
  alerts: [],   // f(state, summary, comb) : ajoute des alertes à summary.alerts
  act: {},      // nom d'action -> f(element)
  init: []      // f() : au démarrage, une fois la carte créée
};
