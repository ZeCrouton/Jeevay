# Service de synchronisation (gratuit)

À déployer une seule fois, depuis ce dossier (PowerShell) :

```
npx wrangler login
npx wrangler kv namespace create KV     # copier l'id affiché dans wrangler.toml
npx wrangler deploy
```

L'adresse obtenue doit être `https://jeevay-sync.nvz-photos.workers.dev` (sinon, modifier `sync.url` dans `js/config.js`).
Offre gratuite Cloudflare : largement suffisante (1 000 écritures/jour, 100 000 lectures/jour).
