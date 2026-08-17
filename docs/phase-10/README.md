# Phase 10 — Panic Wipe

## Résultat

Le Panic Wipe est actif sur tous les écrans critiques de la PWA publique. Un appui ne demande aucune confirmation : l’interface HELP CONNECT est remplacée synchroniquement par un écran neutre, puis la purge best effort s’exécute avant un `location.replace("about:blank")`.

La fonction ne prétend pas effacer physiquement le téléphone. Elle efface uniquement les données auxquelles l’origin publique peut accéder et tente de supprimer ses mécanismes persistants.

## Ordre de sécurité

1. verrou global contre un second déclenchement ou une nouvelle interaction ;
2. remplacement immédiat du DOM, du titre, du thème et de l’état de navigation courant ;
3. purge des références applicatives en mémoire et annulation des requêtes `fetch` en vol ;
4. vidage synchrone de `sessionStorage` et `localStorage` ;
5. signal best effort aux autres onglets de la même origin via `BroadcastChannel` ;
6. message `HC_PANIC_WIPE` aux workers, qui interdit toute nouvelle écriture ;
7. suppression de tous les caches de l’origin ;
8. suppression des bases IndexedDB énumérables et des noms applicatifs connus ;
9. désinscription de toutes les registrations Service Worker de l’origin ;
10. second passage Web Storage/CacheStorage pour fermer les courses avec des opérations en vol ;
11. remplacement de la page par `about:blank` afin d’abandonner le contexte JavaScript.

Le verrou a aussi été ajouté aux écritures sensibles de la page et du Service Worker. Une installation de région, de fiches ou une mise à jour déjà commencée ne peut donc pas réactiver normalement un cache après le déclenchement.

## Stockages couverts

| Surface | Traitement |
| --- | --- |
| Recherche récente et requête active | références RAM vidées |
| Données/cartes/fiches chargées | maps, bundles et promesses applicatives relâchés |
| Préférences de session | `sessionStorage.clear()` |
| Stockage clé/valeur persistant éventuel | `localStorage.clear()` |
| Données signées et app shell | tous les noms CacheStorage supprimés |
| IndexedDB actuel ou futur | bases énumérées supprimées, plus `hc-public-v1` explicitement |
| Service Worker | workers avertis, écritures verrouillées, registrations désinscrites |
| Autres onglets HELP CONNECT | signal de purge diffusé quand `BroadcastChannel` est disponible |
| Navigation courante | état remplacé, puis navigation `about:blank` |

La suppression de tous les caches et bases de l’origin suppose l’origin publique dédiée prévue par l’architecture. HELP CONNECT ne doit pas être cohébergé sur la même origin qu’une autre application.

## Limites explicites

Le Panic Wipe ne peut pas garantir la suppression :

- des fichiers HTML de premiers secours déjà exportés dans Téléchargements ;
- d’anciennes entrées dans l’historique global du navigateur ;
- des copies, captures d’écran, sauvegardes, caches système ou données d’un autre profil/origin ;
- de traces récupérables par analyse forensique du téléphone ;
- d’une base IndexedDB maintenue ouverte par un contexte qui ne répond pas, auquel cas `deleteDatabase` peut être bloqué ;
- des journaux réseau hors de l’appareil.

La purge Web est donc une réduction immédiate de l’exposition, pas une promesse d’effacement physique. Les comportements de stockage par origin sont définis par le [Storage Standard](https://storage.spec.whatwg.org/). La désinscription suit le modèle de cycle de vie de la spécification [Service Workers](https://www.w3.org/TR/service-workers/) et la suppression de bases suit [Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB-3/).

## Fichiers modifiés

- `shared/panic-wipe.js` et `shared/panic-wipe.d.ts` : orchestration tolérante aux erreurs et testable ;
- `src/app.ts` : neutralisation, purge mémoire, annulation réseau, coordination multi-onglets et navigation finale ;
- `src/sw.ts` : protocole de purge et verrou anti-réécriture ;
- `src/index.html`, `src/styles.css`, `public/i18n/*.json` : contrôles actifs et avertissements exacts en français, anglais et ourdou ;
- `test/panic-wipe.test.mjs` : ordre synchrone, stores, erreurs partielles et diffusion ;
- `scripts/offline-smoke.mjs` : preuve Chrome hors ligne de suppression réelle des stockages et de la registration ;
- `scripts/lint.mjs` : exception minimale et limitée au module de purge pour l’accès défensif à LocalStorage/IndexedDB.

## Validation

- 61/61 tests Node réussis, dont 3 nouveaux tests Panic Wipe ;
- lint de politique réussi ;
- trois typechecks TypeScript stricts réussis ;
- builds public et opérateur réussis ;
- inventaires de distribution et vérification des 13 artefacts signés réussis ;
- smoke test Chrome en ligne/hors ligne réussi ;
- test navigateur Panic Wipe réussi avec Web Storage prérempli, base IndexedDB temporaire, caches installés et Service Worker actif ;
- arrivée sur `about:blank`, zéro cache, zéro base IndexedDB, zéro entrée LocalStorage/SessionStorage et registration supprimée.

## Poids

| Budget | Mesure Brotli | Limite |
| --- | ---: | ---: |
| Transfert initial | 23 875 octets | 200 Ko |
| Core offline | 23 875 octets | 300 Ko |
| Distribution complète | 52 065 octets | 500 Ko |
| JavaScript total | 13 025 octets | 80 Ko |
| CSS total | 3 385 octets | 30 Ko |

## Arrêt de phase

La Phase 10 est terminée. Aucun travail propre à la Phase 11 — durcissement des en-têtes de production et revue CSP/TLS — n’a été commencé dans cette phase.
