# HELP CONNECT — Sortie de Phase 7

Date : 17 août 2026  
Statut : terminée ; arrêt avant la Phase 8.

## Résultat

La Phase 7 introduit un cycle éditorial testable et un portail humanitaire strictement séparé de la PWA publique. Toutes les données restent fictives et le statut global `DEMO_NOT_OPERATIONAL` demeure visible.

```text
DRAFT → IN_REVIEW → VALIDATED → PUBLISHED
   ↑                                  │
   └──────────── REVALIDATE ──────────┘
```

La création, la soumission, la validation, la publication et la revalidation sont implémentées comme transitions explicites. Le créateur ne peut pas valider sa propre fiche. Cette règle métier est testée, mais elle ne prétend pas remplacer l’authentification et l’autorisation serveur de la Phase 8.

## Publication à sens unique

Les fiches opérateur fictives peuvent contenir identité interne, contact humanitaire et notes. Le pipeline ne copie jamais ces objets : il construit une nouvelle projection à partir d’une liste blanche fermée.

Chaque point public contient exactement :

```text
id
category
region
coarse_location
status
verified_at
expires_at
revision
```

Tout champ inconnu est rejeté par le schéma public. Les tests recherchent aussi les noms de champs privés et des valeurs sentinelles dans la sérialisation publique. Le fichier publié ne contient ni nom de contact, ni téléphone, ni identité de créateur/validateur/publicateur, ni note interne, ni coordonnées géographiques.

Le jeu interne de démonstration est dans `operator-portal/data/`. `npm run publish:demo` génère `public/directory.json`. Le build public ne lit pas le jeu interne : il consomme uniquement l’artefact déjà publié, ce qui conserve la frontière à sens unique.

## Statuts et expiration

Les statuts publics acceptés sont `VERIFIED`, `STALE`, `UNAVAILABLE` et `CLOSED`. Un point `VERIFIED` dont `expires_at` est atteint devient automatiquement `STALE` :

- lors de la projection de publication ;
- à chaque affichage dans la PWA, y compris depuis un cache hors ligne plus ancien.

Le répertoire affiche le statut effectif, la dernière vérification, l’expiration et la révision. Une entrée expirée ne reste donc jamais présentée comme vérifiée. Dans ce prototype, ces états illustrent uniquement le workflow et ne constituent aucune information terrain.

## Séparation du portail

Le portail réside dans un package top-level distinct : `operator-portal/`. Son build produit uniquement `operator-portal/dist/index.html`, `styles.css` et `app.js`. Aucun de ces fichiers n’entre dans `dist/`, dans le Service Worker public ou dans ses caches.

Le portail est un simulateur en mémoire :

- aucune donnée réelle ;
- aucune persistance ;
- aucun compte, cookie, jeton ou secret ;
- aucune API d’administration ;
- bannière `PROTOTYPE LOCAL — NE PAS DÉPLOYER` et directive `noindex`.

Son origine, son déploiement, ses cookies, ses jetons, son Service Worker, ses caches et ses API devront rester distincts en production.

## Vérifications

- `npm run lint` : PASS ;
- `npm run typecheck` : trois cibles strictes PASS ;
- `npm test` : 38/38 PASS ;
- projection privée → publique déterministe : PASS ;
- rejet des champs publics inconnus ou sensibles : PASS ;
- séparation créateur/validateur : PASS ;
- conversion automatique `VERIFIED` expiré → `STALE` : PASS ;
- `npm run build` : builds public et opérateur séparés PASS ;
- inventaire public fermé et références locales : PASS ;
- douze budgets Brotli : PASS.

Mesures Phase 7 : transfert initial et core offline 18 335 octets Brotli, total public 43 289 octets, JavaScript 8 758 octets, CSS 3 425 octets et répertoire 478 octets.

## Suite volontairement non commencée

La Phase 8 devra ajouter les comptes opérateur, MFA, sessions, rôles, permissions serveur, protection CSRF, limitation de débit et journal d’audit. Aucun de ces mécanismes n’est simulé comme une protection réelle dans cette phase.
