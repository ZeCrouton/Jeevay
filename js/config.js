/* Jeevay — configuration centrale.
   Tous les services externes sont déclarés ici : pour passer plus tard sur
   un serveur à soi (Valhalla auto-hébergé, etc.), il suffit de changer les URL. */
window.T = window.T || {};

T.config = {
  appName: 'Jeevay',
  version: '1.6.1',
  storagePrefix: 'trajecto.',

  map: {
    styles: [
      { id: 'liberty', label: 'Couleurs', url: 'https://tiles.openfreemap.org/styles/liberty' },
      { id: 'bright', label: 'Routier', url: 'https://tiles.openfreemap.org/styles/bright' },
      { id: 'positron', label: 'Épuré', url: 'https://tiles.openfreemap.org/styles/positron' }
    ],
    center: [5.93, 43.13],
    zoom: 9
  },

  // Calcul d'itinéraire (serveur public FOSSGIS, gratuit, usage raisonnable)
  routing: { url: 'https://valhalla1.openstreetmap.de', concurrency: 2, maxMatchKm: 200 },
  // Altitudes (Open-Meteo, gratuit, sans clé)
  // Altitudes : tuiles de relief ouvertes (AWS Terrain Tiles), sans clé ni quota
  elevation: { url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', zoom: 12 },
  // Recherche de lieux (Photon / Komoot, gratuit, sans clé)
  geocode: { url: 'https://photon.komoot.io', fallback: 'https://nominatim.openstreetmap.org' },

  // Points d'intérêt : base OpenStreetMap préparée chaque mois (branche poi-data), miroir CDN en secours
  // Synchronisation par code : Cloudflare Worker gratuit (dossier worker/)
  sync: { url: 'https://jeevay-sync.nvz-photos.workers.dev' },

  poi: { bases: ['https://raw.githubusercontent.com/ZeCrouton/Trajecto/poi-data/poi/', 'https://cdn.jsdelivr.net/gh/ZeCrouton/Trajecto@poi-data/poi/'] },
  // Prévisions météo (Open-Meteo, gratuit, 16 jours)
  weather: { url: 'https://api.open-meteo.com/v1/forecast', days: 16 },

  // Couleurs proposées pour l'appli (toutes lisibles avec du texte blanc)
  palette: [['#ff4d00', 'Orange'], ['#e03131', 'Rouge'], ['#e3007d', 'Magenta'], ['#7048e8', 'Violet'], ['#1c6fe0', 'Bleu'], ['#0b7285', 'Turquoise'], ['#2b8a3e', 'Vert'], ['#14161b', 'Noir']],

  // Vitesses moyennes utilisées pour les tracés importés et les lignes droites (km/h)
  avgSpeed: { moto: 55 },

  modes: {
    moto: {
      label: 'Moto', costing: 'motorcycle', accent: '#ff4d00', defaultRoad: 'auto',
      roads: [
        { id: 'autoroute', label: 'Autoroute', short: 'A', color: '#1f5fbf', ink: '#fff',
          desc: 'Le plus rapide. Péages possibles.', opts: { use_highways: 1, use_tolls: 1, use_primary: 1 } },
        { id: 'nationale', label: 'Nationale', short: 'N', color: '#d7261e', ink: '#fff',
          desc: 'Grands axes, sans autoroute ni péage.', opts: { use_highways: 0, use_tolls: 0, use_primary: 1 } },
        { id: 'departementale', label: 'Départementale', short: 'D', color: '#f5c400', ink: '#1a1a1a',
          desc: 'Routes secondaires, plus de paysages.', opts: { use_highways: 0, use_tolls: 0, use_primary: 0.3, top_speed: 90 } },
        { id: 'petites', label: 'Petites routes', short: 'C', color: '#2f9e44', ink: '#fff',
          desc: 'Le plus sinueux, évite les grands axes.', opts: { use_highways: 0, use_tolls: 0, use_primary: 0, top_speed: 70 } }
      ]
    },
    velo: {
      label: 'Vélo', costing: 'bicycle', accent: '#00a37a', defaultRoad: 'auto',
      roads: [
        { id: 'route', label: 'Vélo de route', short: 'R', color: '#d7261e', ink: '#fff',
          desc: 'Bitume, routes roulantes.', opts: { bicycle_type: 'Road', use_roads: 0.6, use_hills: 0.5, avoid_bad_surfaces: 0.9 } },
        { id: 'calme', label: 'Routes calmes', short: 'V', color: '#2f9e44', ink: '#fff',
          desc: 'Pistes cyclables et petites routes.', opts: { bicycle_type: 'Hybrid', use_roads: 0.15, use_hills: 0.4, avoid_bad_surfaces: 0.5 } },
        { id: 'plat', label: 'Le plus plat', short: 'P', color: '#1f5fbf', ink: '#fff',
          desc: 'Évite les côtes autant que possible.', opts: { bicycle_type: 'Hybrid', use_roads: 0.4, use_hills: 0, avoid_bad_surfaces: 0.5 } },
        { id: 'vtt', label: 'VTT / Gravel', short: 'T', color: '#8a5a2b', ink: '#fff',
          desc: 'Chemins et pistes acceptés.', opts: { bicycle_type: 'Mountain', use_roads: 0.1, use_hills: 0.7, avoid_bad_surfaces: 0 } }
      ]
    },
    run: {
      label: 'Running', costing: 'pedestrian', accent: '#e3007d', defaultRoad: 'auto',
      roads: [
        { id: 'route', label: 'Mixte', short: 'M', color: '#e3007d', ink: '#fff',
          desc: 'Le plus direct à pied.', opts: { use_hills: 0.5 } },
        { id: 'plat', label: 'Le plus plat', short: 'P', color: '#1f5fbf', ink: '#fff',
          desc: 'Évite les côtes.', opts: { use_hills: 0 } },
        { id: 'trail', label: 'Trail', short: 'T', color: '#8a5a2b', ink: '#fff',
          desc: 'Sentiers et chemins privilégiés.', opts: { use_hills: 1, max_hiking_difficulty: 3, walkway_factor: 0.6 } },
        { id: 'urbain', label: 'Trottoirs', short: 'U', color: '#495057', ink: '#fff',
          desc: 'Trottoirs et rues aménagées.', opts: { use_hills: 0.5, sidewalk_factor: 0.6, walkway_factor: 1.2 } }
      ]
    }
  },

  kinds: {
    auto: { id: 'auto', label: 'Proposé par l’app', short: 'P', color: '#495057', ink: '#fff', desc: 'Le trajet calculé sans préférence.' },
    line: { id: 'line', label: 'Ligne droite', short: '—', color: '#868e96', ink: '#fff', desc: 'À vol d’oiseau, sans suivre la route.' },
    track: { id: 'track', label: 'Tracé importé', short: 'GPX', color: '#0b7285', ink: '#fff' }
  },

  slopeColors: ['#2f9e44', '#f5c400', '#ff8a00', '#e03131', '#7a0b0b'],
  slopeLabels: ['< 3 %', '3–6 %', '6–9 %', '9–12 %', '> 12 %']
};
