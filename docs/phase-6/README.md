# HELP CONNECT — Sortie de Phase 6

Date : 17 août 2026  
Statut : terminée ; arrêt avant la Phase 7.

## Résultat

Le bouton « Mise à jour » applique maintenant des versions de datasets au lieu de télécharger arbitrairement les changements des dernières 24 heures. Chaque région installée contient `datasetVersion`, et `/updates/index.json` annonce :

- la version courante de chaque région ;
- les transitions unitaires disponibles ;
- le snapshot régional courant à utiliser si la chaîne est incomplète.

Le scénario de démonstration Nord suit :

```text
version locale 1
  → delta 1–2 : 163 o Brotli
  → delta 2–3 : 179 o Brotli
version locale 3
```

Le scénario Sud part de la version 1 alors que seule la transition 3–4 est disponible. Le client détecte l'absence de chaîne 1→4 et télécharge directement le snapshot régional version 4.

## Mise à jour atomique

Le client ne modifie jamais progressivement le cache utilisé hors ligne :

1. récupération du manifest avec `cache: no-store` ;
2. validation de l'identité régionale, des versions et des chemins fermés ;
3. calcul d'une chaîne continue `n → n+1` ;
4. récupération et validation de chaque delta ;
5. application sur une copie en RAM ;
6. validation complète du résultat final ;
7. écriture unique de la nouvelle région dans CacheStorage.

Si un delta échoue, le client tente le snapshot. Si le snapshot échoue aussi, aucune écriture n'a lieu et l'ancienne région reste intacte. Le bouton est désactivé pendant l'opération afin d'empêcher deux mises à jour concurrentes.

Les opérations autorisées dans cette version du protocole sont volontairement petites : déplacement d'un point schématique et remplacement d'une polyligne déjà simplifiée. Elles ne peuvent ajouter ni coordonnées géographiques, ni contacts, ni statut opérationnel.

## Réseau intermittent et confidentialité

Le manifest, les deltas et les snapshots sont récupérés uniquement après activation manuelle du bouton. Ils ne sont ni précachés ni conservés sous leur URL réseau. Seule la région finale validée remplace le chemin offline déjà consenti.

Une demande révèle nécessairement au serveur le chemin fixe de la région choisie, comme l'installation régionale de Phase 5. Elle n'inclut aucun terme recherché, identifiant utilisateur, position, cookie ou paramètre dynamique.

Une tentative de mise à jour totalement offline affiche une erreur explicite et conserve la version locale. La carte, le mode texte, la recherche et les fiches de premiers secours continuent à fonctionner.

## Séparation des caches

Le Service Worker distingue désormais :

```text
hc-shell-<hash>   HTML, CSS, JS, manifest, bootstrap, répertoire et langues
hc-data-v1        régions consenties et paquets de premiers secours
```

Lors d'un nouveau déploiement, seul l'ancien cache du shell est remplacé. Une migration ciblée copie d'abord les régions et fiches autorisées trouvées dans un ancien cache Phase 5 vers `hc-data-v1`, puis supprime l'ancien shell. Les autres requêtes ne sont jamais migrées.

Cette séparation préserve les données offline choisies pendant une mise à niveau de l'application et prépare leur suppression contrôlée par le futur Panic Wipe, sans prétendre que celui-ci fonctionne déjà.

## Statut des données

Les versions 1, 2, 3 et 4 décrivent uniquement l'évolution technique des données de démonstration. Elles ne signifient pas « vérifié », « récent » ou « sûr ». Toutes les régions, snapshots et deltas restent :

```text
DEMO_NOT_OPERATIONAL
SCHEMATIC_NOT_GEOGRAPHIC
```

Le cycle de création, validation, publication, expiration et revalidation de vraies données reste la responsabilité de la Phase 7.

## Poids

Mesure : Brotli qualité 11, Gzip niveau 9, `1 Ko = 1024 octets`.

| Ensemble | Phase 5 | Phase 6 | Limite | Résultat |
| --- | ---: | ---: | ---: | --- |
| Transfert initial Brotli | 16 832 o | 18 244 o | 204 800 o | PASS |
| Core offline Brotli | 16 832 o | 18 244 o | 307 200 o | PASS |
| Tous assets Brotli | 39 479 o | 42 894 o | 512 000 o | PASS |
| JavaScript Brotli | 7 149 o | 8 366 o | 81 920 o | PASS |
| CSS Brotli | 3 353 o | 3 370 o | 30 720 o | PASS |
| Répertoire texte | 937 o | 937 o | 20 480 o | PASS |
| Régions et snapshots | 854 o | 1 729 o | 40 960 o | PASS |
| Plus gros asset régional | 436 o | 435 o | 20 480 o | PASS |
| Protocole de mise à jour | — | 1 594 o | 40 960 o | PASS |
| Plus gros micro-delta | — | 179 o | 5 120 o | PASS |
| Fiches optionnelles | 16 404 o | 16 404 o | 153 600 o | PASS |
| Plus gros paquet médical | 3 226 o | 3 226 o | 51 200 o | PASS |

## Vérifications exécutées

- `npm run lint` : PASS ;
- `npm run typecheck` : PASS ;
- `npm test` : 35/35 PASS ;
- chaîne Nord 1→2→3 identique au snapshot version 3 : PASS ;
- détection de la chaîne Sud incomplète et sélection du snapshot version 4 : PASS ;
- rejet d'une coordonnée hors limites sans mutation de la région originale : PASS ;
- `npm run build` : PASS avec douze budgets bloquants ;
- deux builds consécutifs : 26/26 fichiers `dist` avec hashes SHA-256 identiques ;
- `npm audit --audit-level=moderate` : 0 vulnérabilité ;
- liens locaux des treize fichiers Markdown : aucun lien cassé ;
- `npm run test:offline` : PASS dans Chrome ;
- cache `hc-data-v1` séparé d'un unique cache de shell : PASS ;
- deux deltas Nord demandés dans l'ordre, aucun snapshot Nord : PASS ;
- version cache et interface passées atomiquement de 1 à 3 : PASS ;
- marqueur déplacé selon le delta puis rerendu : PASS ;
- tentative offline : version 3 conservée : PASS ;
- carte, recherche urdu, mode texte et fiches médicales : non-régression PASS.

La capture `reports/ui-map.png` montre la carte Nord en version 3 et le message d'application des micro-deltas.

## Fichiers principaux

- `public/updates/index.json` : versions courantes, deltas et snapshots ;
- `public/updates/*.delta.json` : changements unitaires ;
- `public/regions/*.v*.min.json` : snapshots de rattrapage ;
- `scripts/update-schema.mjs` : manifest, chaîne, delta et application pure ;
- `test/update.test.mjs` : chaîne complète, fallback et atomicité ;
- `src/app.ts` : orchestration réseau, validation et commit final ;
- `src/sw.ts` : cache de données stable et migration ciblée ;
- `scripts/offline-smoke.mjs` : mise à jour réelle puis échec réseau contrôlé.

## Suite volontairement non commencée

La Phase 7 devra introduire le modèle de données publiables, les rôles opérateurs, le workflow de validation, les dates de vérification/expiration et les règles de revalidation. Aucun compte, portail, API d'administration ou statut `VERIFIED` n'a été créé pendant cette phase.
