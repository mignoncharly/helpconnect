# HELP CONNECT — Sortie de Phase 1

Date : 17 août 2026  
Statut : terminée ; aucun travail de Phase 2 inclus.

## État trouvé

La Phase 0 avait confirmé un workspace greenfield : aucune source applicative, dépendance, PWA, stratégie offline, chaîne de build, test ou CI. Il n'existait donc aucune fonctionnalité utile à préserver et aucun poids produit mesurable.

## Fichiers introduits

| Zone | Rôle |
| --- | --- |
| `src/index.html`, `src/styles.css`, `src/app.ts` | page minimale accessible et enregistrement du Service Worker |
| `src/sw.ts` | app shell offline allow-listé, cache versionné par hash et nettoyage des anciennes versions HELP CONNECT |
| `public/manifest.webmanifest`, `public/icons.svg` | métadonnées installables et icône SVG locale |
| `scripts/build.mjs` | build statique minifié, sans source maps publiques |
| `scripts/build-config.mjs` | inventaire unique des assets, precache et limites |
| `scripts/check-budget.mjs`, `scripts/budget-lib.mjs` | mesure brute/Gzip/Brotli, rapport JSON et échec sur dépassement |
| `scripts/lint.mjs`, `scripts/validate-dist.mjs` | règles de source security-first et inventaire de livraison fermé |
| `scripts/offline-smoke.mjs` | test Chromium réel après coupure serveur/réseau |
| `test/budget.test.mjs` | tests des mesures, déduplication, artefact absent et chaque seuil +1 octet |
| `package.json`, `package-lock.json`, `tsconfig*.json` | commandes reproductibles et TypeScript strict DOM/WebWorker séparé |

Deux dépendances de développement sont épinglées : TypeScript 7.0.2 et esbuild 0.28.2. Il n'existe aucune dépendance runtime.

## Implémentation

- HTML/CSS/TypeScript compilé, SVG et APIs navigateur natives seulement ;
- manifest same-origin sans image bitmap ni police externe ;
- Service Worker sans import tiers, precache limité à cinq assets et aucun cache générique des requêtes ;
- navigation offline servie depuis le cache HELP CONNECT actif ;
- nom de cache dérivé par SHA-256 du contenu réel du shell, donc invalidation reproductible sans numéro manuel ;
- nettoyage limité aux caches préfixés `hc-` sur l'origin public dédié ;
- build minifié et déterministe, avec inventaire exact de six fichiers dans `dist/` ;
- rapport automatique `reports/weight-report.json` et code d'échec non nul pour chaque budget.

La page visible est volontairement un état technique minimal. Les écrans Accueil, Carte, Fiches, Recherche, Paramètres, la navigation basse et PW appartiennent aux phases suivantes.

## Résultat de poids

Mesure : Brotli qualité 11, Gzip niveau 9, `1 Ko = 1024 octets`.

| Asset | Brut | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| `app.js` | 482 o | 325 o | 256 o |
| `icons.svg` | 327 o | 248 o | 199 o |
| `index.html` | 1 164 o | 598 o | 436 o |
| `manifest.webmanifest` | 452 o | 279 o | 233 o |
| `service-worker.js` | 912 o | 487 o | 404 o |
| `styles.css` | 664 o | 364 o | 283 o |
| **Total** | **4 001 o** | **2 301 o** | **1 811 o** |

| Budget | Actuel Brotli | Limite | Résultat |
| --- | ---: | ---: | --- |
| Transfert initial | 1 811 o | 204 800 o | PASS |
| Core offline | 1 811 o | 307 200 o | PASS |
| Plafond absolu | 1 811 o | 512 000 o | PASS |
| JavaScript | 660 o | 81 920 o | PASS |
| CSS | 283 o | 30 720 o | PASS |

Le Service Worker est compté dans le transfert initial bien que son enregistrement ait lieu après le chargement, ce qui rend la mesure conservative. `flow.png` et toute la documentation sont absents de `dist/`.

## Vérifications effectuées

- `npm run lint` : PASS ;
- `npm run typecheck` : PASS pour DOM et WebWorker en configurations séparées ;
- `npm test` : 9/9 PASS, y compris un échec simulé à un octet au-dessus de chacun des cinq seuils ;
- `npm run build` : PASS, inventaire et cinq budgets validés ;
- deux builds consécutifs : hashes SHA-256 de tous les fichiers `dist/` identiques ;
- `npm audit --audit-level=moderate` : 0 vulnérabilité ;
- `npm run test:offline` : PASS dans Chrome, cinq assets précachés, rechargement réussi après arrêt du serveur et émulation offline ;
- scan de livraison : aucune URL réseau externe, source map ou asset inattendu.

## Vérification sécurité et vie privée

Le socle n'utilise ni cookie, ni `localStorage`, ni IndexedDB, ni géolocalisation, ni formulaire/recherche, ni analytics ou télémétrie. Toutes les ressources runtime sont same-origin. La page inclut une CSP restrictive en défense locale ; les headers HTTPS/HSTS/CSP définitifs devront aussi être configurés et testés sur l'hébergement réel.

Le Service Worker ne répond qu'aux requêtes `GET` same-origin et uniquement aux navigations ou assets explicitement précachés. Aucune API de mutation, authentification ou donnée opérateur n'a été introduite.

## Ce qui reste pour la Phase 2

- remplacer la page technique par le shell fidèle au wireframe ;
- créer la navigation Accueil, Carte, Fiches et Recherche ;
- poser les écrans Accueil et Paramètres sans persistance sensible ;
- préparer l'i18n légère et les sens LTR/RTL ;
- conserver des emplacements accessibles pour Mode texte et PW sans implémenter prématurément leurs logiques de phases ultérieures ;
- ajouter tests clavier, lecteur d'écran, petit viewport et flux de navigation ;
- mesurer à nouveau tous les budgets après chaque composant.

La Phase 2 ne doit commencer qu'après instruction explicite.
