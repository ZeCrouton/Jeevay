# Trajecto — itinéraires moto, vélo, running

Site statique (HTML/CSS/JS, sans compilation). 100 % gratuit, sans clé ni compte.

## Lancer
- **En local** : double-cliquer sur `index.html` (Chrome ou Edge récents).
- **En ligne** : GitHub Pages (Settings → Pages → branche main, dossier racine) ou Cloudflare Pages, aucune commande de build.
- Le partage par lien et l'installation sur téléphone ne fonctionnent qu'en ligne (https).

## Fonctions (V1)
- Points sur la carte, déplaçables, insérables sur le tracé, suppression, annuler / rétablir (Ctrl+Z / Ctrl+Y).
- Type de route demandé à chaque tronçon : moto (Autoroute / Nationale / Départementale / Petites routes), vélo, running, ou ligne droite.
- Distance, durée, D+ / D−, profil altimétrique interactif, coloration par pente.
- Difficultés : pentes raides, épingles, portions non goudronnées, péages, bacs, cols en altitude, niveau global.
- Types de voies réellement empruntés (barre de composition).
- Import GPX / KML / GeoJSON (plusieurs fichiers, ordre, sens, raccord par la route), liens Google Maps.
- Street View (lien vers Google, gratuit), export GPX (trace, itinéraire ou les deux), ouverture dans Google Maps.
- Parcours sauvegardés dans le navigateur.

## V2
- Points d'intérêt le long du tracé (OpenStreetMap / Overpass) : stations-service, cols, panoramas, points d'eau, cafés, réparation vélo, toilettes ; ajout comme étape.
- Alerte d'autonomie carburant (moto, autonomie réglable).
- Météo à l'heure de passage (Open-Meteo, 16 jours) : pluie, rafales, verglas, chaleur, arrivée après le coucher du soleil.
- Score « plaisir moto » sur 10 (parcours et tronçons).

## V3
- Partage par lien sans serveur (parcours compressé dans l'adresse).
- Boucle automatique (distance, départ, direction, type de route).
- Road-book imprimable / PDF (carte, profil, étapes avec heures, alertes, météo, lieux).
- Application installable (PWA) avec ouverture hors connexion.

## Architecture (pensée pour évoluer)
```
js/config.js                 URL des services, profils de route, couleurs  ← tout se règle ici
js/core/   util · analysis · store (état, historique, stockage) · engine (calcul des tronçons)
js/providers/                un fichier par service externe (interface simple, remplaçable)
  routing-valhalla.js        route() + matchTrack()
  elevation-openmeteo.js     get(points)
  geocode-photon.js          search() + reverse()
js/io/      import.js · export.js
js/ui/      map · profile · panel · ui (fenêtres) · icons
js/app.js   actions utilisateur et rendu
```
- **Passer à son propre serveur** : changer `routing.url` dans `config.js` (Valhalla auto-hébergé, même API).
- **Partage par lien / comptes** (plus tard) : ajouter un fournisseur de stockage distant à côté de `T.storage` (ex. Cloudflare Worker + D1).

## Services utilisés
Carte OpenFreeMap (© OpenMapTiles, © contributeurs OpenStreetMap) · Itinéraires Valhalla (serveur public FOSSGIS) ·
Altitudes Open-Meteo · Recherche Photon (Komoot). Serveurs publics : usage raisonnable, adapté à un usage privé.
