# HELP CONNECT — Sortie de Phase 4

Date : 17 août 2026  
Statut : terminée ; arrêt avant la Phase 5.

## Résultat

La PWA dispose maintenant d'un index local miniature et d'un mode texte utilisable comme vue principale. La recherche couvre, dans la langue active :

- le quartier ou la zone ;
- la catégorie ;
- le nom du point ;
- le type de secours ;
- quelques termes locaux associés.

La requête est normalisée en RAM, découpée en termes puis comparée à l'index déjà chargé. Aucun appel réseau n'est émis à chaque caractère : la recherche démarre uniquement lors de la soumission du formulaire ou du choix d'un filtre.

Les boutons de catégorie filtrent immédiatement le répertoire. Les résultats sont construits avec `createElement` et `textContent`, sans injection HTML.

## Trois modes réseau

L'écran Carte expose explicitement :

| Mode | Comportement Phase 4 |
| --- | --- |
| A — Normal | emplacement de la future carte, légende et répertoire texte |
| B — Données réduites | vue allégée et répertoire ; la couche cartographique simplifiée reste réservée à la Phase 5 |
| C — Texte seul | aucune carte affichée, aucun chargement cartographique, liste uniquement |

Le bouton « Mode texte » du wireframe active directement le mode C. Un sélecteur accessible permet de revenir aux modes A ou B. Le mode choisi reste volontairement en RAM et revient à Normal après rechargement.

Le mode texte ne demande aucun asset optionnel. Son répertoire de 821 octets Brotli fait partie du core offline précaché, avec le shell de l'application.

## Données de démonstration et intégrité

Aucune source de points de terrain validés n'existe encore dans le projet. Publier de faux hôpitaux, points d'eau ou heures de vérification serait dangereux. Le répertoire Phase 4 contient donc cinq entrées synthétiques strictement marquées :

```text
DEMO_NOT_OPERATIONAL
verifiedAt: null
expiresAt: null
```

Un avertissement visible dans les vues Carte et Recherche indique que les points sont fictifs et ne doivent pas être utilisés pour chercher une aide réelle.

Le validateur de schéma bloque :

- tout statut prétendument opérationnel ou vérifié ;
- toute date de vérification ou d'expiration inventée ;
- coordonnées, latitude, longitude ou contact ;
- identifiants dupliqués, catégories inconnues et traductions incomplètes.

La Phase 5 pourra ajouter la géométrie légère. Le cycle publication, validation, expiration et revalidation des vrais points reste la responsabilité de la Phase 7 et exigera une nouvelle version de schéma.

## Confidentialité de la recherche

Les termes saisis et l'historique récent restent uniquement dans le DOM et la mémoire JavaScript :

- aucun paramètre d'URL ou fragment ;
- aucun cookie, `localStorage`, IndexedDB ou CacheStorage ;
- aucune clé de `sessionStorage` supplémentaire ;
- disparition de l'historique au rechargement ;
- limite de quatre termes récents ;
- champs sans attribut `name`, autocomplétion désactivée.

Seuls `hc:locale` et `hc:theme` restent conservés pour l'onglet. Le répertoire public est précaché sous son chemin fixe `/directory.json` ; aucune requête contenant le terme recherché n'est construite.

## Poids

Mesure : Brotli qualité 11, Gzip niveau 9, `1 Ko = 1024 octets`.

| Ensemble | Phase 3 | Phase 4 | Limite | Résultat |
| --- | ---: | ---: | ---: | --- |
| Transfert initial Brotli | 11 277 o | 14 157 o | 204 800 o | PASS |
| Core offline Brotli | 11 277 o | 14 157 o | 307 200 o | PASS |
| Tous assets Brotli | 31 888 o | 35 511 o | 512 000 o | PASS |
| JavaScript Brotli | 4 224 o | 5 489 o | 81 920 o | PASS |
| CSS Brotli | 2 714 o | 3 022 o | 30 720 o | PASS |
| Répertoire texte | — | 821 o | 20 480 o | PASS |
| Fiches optionnelles | 16 404 o | 16 404 o | 153 600 o | PASS |
| Plus gros paquet médical | 3 226 o | 3 226 o | 51 200 o | PASS |

## Vérifications exécutées

- `npm run lint` : PASS ;
- `npm run typecheck` : PASS ;
- `npm test` : 24/24 PASS ;
- schéma du répertoire, trois langues et rejet des fausses validations/coordonnées/contacts : PASS ;
- `npm run build` : PASS avec huit budgets bloquants ;
- deux builds consécutifs : 17/17 fichiers `dist` avec hashes SHA-256 identiques ;
- `npm audit --audit-level=moderate` : 0 vulnérabilité ;
- liens locaux des onze fichiers Markdown : aucun lien cassé ;
- `npm run test:offline` : PASS dans Chrome ;
- recherche locale en urdu, filtre Eau et mode texte RTL : PASS ;
- une seule récupération de `/directory.json`, aucune requête par caractère : PASS ;
- requête absente des stockages, caches et URL : PASS ;
- rechargement après arrêt du serveur, recherche urdu et mode texte : PASS ;
- fiches de premiers secours offline de Phase 3 : non-régression PASS.

Une capture du contrôle visuel est disponible dans `reports/ui-text-mode.png` et reste hors de `dist/`.

## Fichiers principaux

- `public/directory.json` : cinq points synthétiques multilingues ;
- `scripts/directory-schema.mjs` : contrat strict du répertoire ;
- `test/directory.test.mjs` : garde-fous d'intégrité et de confidentialité ;
- `src/app.ts` : chargement, index RAM, recherche, filtres et modes réseau ;
- `src/index.html`, `src/styles.css` : vues texte, avertissements et sélecteur accessible ;
- `scripts/build-config.mjs`, `scripts/check-budget.mjs` : précache et budget dédié ;
- `scripts/offline-smoke.mjs` : scénario online/offline multilingue.

## Suite volontairement non commencée

La Phase 5 devra construire la carte légère SVG/Canvas, découper les régions et définir les formats de géométrie. Aucun moteur cartographique, GeoJSON, tuile, coordonnée ou dépendance cartographique n'a été ajouté pendant cette phase.
