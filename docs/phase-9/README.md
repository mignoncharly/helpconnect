# HELP CONNECT — Sortie de Phase 9

Statut : terminée ; arrêt avant la Phase 10.

## Résultat

Les 13 artefacts publics structurés sont signés côté publication avec ECDSA P-256/SHA-256. La PWA vérifie leurs octets exacts avec Web Crypto avant tout décodage métier, affichage ou remplacement d’une donnée locale. Une erreur de taille, JSON, schéma, région, version, transition, empreinte, signature, période de validité, révocation ou séquence conserve la dernière donnée locale valide ou rend la ressource indisponible.

La PWA n’embarque que la clé publique racine. Aucune clé privée, dépendance cryptographique tierce ou secret opérateur n’entre dans `src/`, `public/` ou `dist/`.

## Protocole signé

Chaque artefact `path.json` possède une enveloppe détachée `path.json.sig.json`. L’enveloppe lie explicitement : algorithme, identifiant de clé, chemin, séquence monotone, émission, expiration et SHA-256 des octets exacts. La signature porte sur un statement textuel fixe `HELP_CONNECT_ARTIFACT_V1`; le client ne repose donc pas sur une resérialisation JSON ambiguë.

La hiérarchie de confiance est :

```text
clé racine publique intégrée à app.js
  └─ signe trust/keyring.json
       ├─ clés ACTIVE ou RETIRED
       ├─ périodes de validité
       └─ identifiants révoqués
            └─ signent datasets, snapshots et deltas
```

Les artefacts couverts sont le répertoire, le bootstrap cartographique, les quatre chunks/snapshots régionaux, le manifeste de mise à jour, les trois micro-deltas et les trois bundles de premiers secours.

## Activation locale et rejeu

- Le répertoire, le bootstrap et la keyring sont dans l’app shell avec leurs signatures.
- Un chunk optionnel n’est envoyé au Service Worker qu’après vérification cryptographique et validation métier.
- Le Service Worker écrit corps, chemin signé et enveloppe dans une seule réponse CacheStorage : un seul `cache.put` constitue le point d’activation atomique.
- Après une chaîne de deltas, la PWA sérialise le résultat puis le vérifie contre la signature détachée du snapshot final. Elle ne l’active jamais sur la seule foi des deltas.
- Un registre local `hc-integrity-state` conserve les séquences maximales par artefact et par slot régional. Une version inférieure est rejetée.
- Les anciennes entrées optionnelles sans métadonnées de signature ne sont pas migrées.

CacheStorage reste modifiable par une personne ayant le contrôle du navigateur. Le registre local limite surtout les rollbacks réseau/CDN entre deux états déjà vus ; sa suppression ou son altération peut provoquer un déni de service ou perdre cette mémoire. L’expiration signée reste la borne des nouveaux profils.

## Rotation et révocation

Une rotation de clé de données ajoute d’abord la nouvelle clé `ACTIVE` dans une keyring de révision supérieure signée par la racine. L’ancienne peut rester `RETIRED` pendant le chevauchement afin de vérifier les artefacts existants. Après publication des nouveaux artefacts, son identifiant peut être ajouté à `revoked_key_ids`; toute donnée portant cette clé est alors rejetée.

La clé racine privée doit rester hors ligne. Son remplacement exige une nouvelle version de la PWA embarquant une nouvelle racine ; la keyring ne peut pas autoriser elle-même une nouvelle racine.

Pour une publication réelle, les commandes exigent des JWK privées placées hors du workspace :

```powershell
$env:HC_ROOT_SIGNING_PRIVATE_JWK_FILE = 'D:\offline-secrets\root-private.jwk'
$env:HC_ROOT_SIGNING_EXPIRES_AT = '2031-08-17T12:00:00Z'
npm run integrity:sign-keyring

$env:HC_SIGNING_PRIVATE_JWK_FILE = 'D:\kms-export\data-private.jwk'
$env:HC_SIGNING_KEY_ID = 'hc-data-2026-b'
$env:HC_SIGNING_EXPIRES_AT = '2026-09-17T12:00:00Z'
npm run integrity:sign-release
npm run integrity:verify
```

En production, ces opérations doivent s’exécuter dans un staging non servi, idéalement avec une clé non exportable en HSM/KMS puis un déploiement atomique.

## Rotation du 18 août 2026 — sortie des clés de démonstration

Jusqu’à cette date, la keyring publiée était signée par une racine de démonstration dont les deux moitiés privées avaient été détruites à la génération. La vérification fonctionnait, mais aucune rotation, aucune révocation et aucune re-signature n’étaient possibles : la première mise à jour de jeu de données aurait été rejetée par la PWA elle-même.

`npm run integrity:rotate-root` remplace cette racine. Le script génère une paire racine et une paire de données P-256, écrit les moitiés privées **hors du workspace** en `0600` sans jamais les afficher, refuse d’écraser un fichier de clé existant, et interdit de réutiliser un identifiant retiré. Il exige `--confirm-rotation`.

```bash
HC_SIGNING_KEY_DIR=<répertoire hors dépôt> \
HC_ROTATION_ROOT_KEY_ID=hc-root-2026-a \
HC_ROTATION_DATA_KEY_ID=hc-data-2026-a \
HC_ROTATION_KEYRING_EXPIRES_AT=2031-08-18T00:00:00Z \
  npm run integrity:rotate-root -- --confirm-rotation

HC_ROOT_SIGNING_PRIVATE_JWK_FILE=<dir>/hc-root-2026-a.private.jwk.json npm run integrity:sign-keyring
HC_SIGNING_KEY_ID=hc-data-2026-a HC_SIGNING_PRIVATE_JWK_FILE=<dir>/hc-data-2026-a.private.jwk.json \
HC_SIGNING_EXPIRES_AT=2030-08-18T00:00:00Z npm run integrity:sign-release
npm run integrity:verify && npm run build
```

Résultat : keyring révision 2, `hc-data-2026-a` `ACTIVE`, et `hc-demo-data-2026-a` comme `hc-demo-root-2026-a` inscrits dans `revoked_key_ids`. La racine publique embarquée dans le bundle vient désormais de `config/trust-root.public.json`.

Le générateur de démonstration `scripts/bootstrap-demo-trust.mjs` est supprimé : tant qu’il existait, un `npm run` malencontreux pouvait réécrire la racine de production avec une clé jetable.

### Impact sur les clients ayant déjà du contenu en cache

Toutes les réponses sont servies en `Cache-Control: no-store` : le seul cache est celui du Service Worker.

- **Coque applicative** — `app.js`, `trust/keyring.json` et sa signature appartiennent au même précache versionné (`hc-shell-<empreinte>`), rempli par un unique `addAll` puis activé d’un bloc. L’empreinte change avec la keyring, donc un client passe de l’ancien couple cohérent (ancienne racine, ancienne keyring) au nouveau sans fenêtre intermédiaire. `directory.json` et `bootstrap.json` font partie de ce précache et arrivent re-signés avec lui.
- **Données optionnelles déjà installées** — régions, deltas et fiches de premiers secours survivent aux versions de coque dans `hc-data-*` et `hc-first-aid-v1`. Elles sont revérifiées à chaque lecture (`readCachedSignedResponse` dans `src/app.ts`), donc contre la **nouvelle** keyring. Leur enveloppe porte `hc-demo-data-2026-a`, désormais révoquée : `verifyArtifact` les rejette avec « Signing key revoked ».

Conséquence assumée : après cette mise à jour, un utilisateur doit se reconnecter une fois pour réinstaller les régions et fiches qu’il avait téléchargées. Un utilisateur hors ligne au moment de la bascule perd temporairement l’accès à ces bundles, la coque et l’annuaire restant fonctionnels.

L’alternative — laisser l’ancienne clé `RETIRED` dans la keyring au lieu de la révoquer — préserverait ces caches pendant une période de chevauchement. Elle est écartée ici : la clé de démonstration ne doit plus rien authentifier. Le choix se lit dans `revoked_key_ids` et peut être révisé à la révision suivante.

## Vérifications réalisées

- validation complète de la release depuis la racine publique ;
- rejet d’un octet altéré, d’une signature altérée et d’une substitution de chemin ;
- rejet du rejeu, de l’expiration et d’une clé révoquée ;
- acceptation contrôlée d’une rotation de clé ;
- correspondance octet pour octet entre le résultat des deltas et le snapshot signé ;
- smoke test Chrome en ligne puis hors ligne, avec installation, micro-deltas signés, rechargement offline et rejet visuel d’une entrée CacheStorage altérée ;
- inventaire strict : aucune clé privée ni configuration racine séparée dans `dist/`.

## Poids Brotli

| Ensemble | Mesure | Limite |
| --- | ---: | ---: |
| Transfert initial | 22 714 octets | 200 Ko |
| Core offline | 22 714 octets | 300 Ko |
| Distribution complète | 50 737 octets | 500 Ko |
| JavaScript total | 11 906 octets | 80 Ko |
| Clés publiques + enveloppes | 4 410 octets | 20 Ko |

Par rapport à la Phase 8, la vérification et ses métadonnées ajoutent 4 379 octets Brotli au transfert initial et 7 448 octets à la distribution complète.

## Limites résiduelles

La signature prouve l’origine et l’intégrité des octets, pas la véracité terrain d’un point. Une clé de données compromise exige une nouvelle keyring révoquant son identifiant ; une racine ou un frontend compromis dépasse ce mécanisme. Une horloge très incorrecte peut aussi refuser une release valide. La compatibilité a été exercée sur Web Crypto de Node et Chrome local ; la matrice de téléphones anciens et réseaux réels reste une phase ultérieure.

La Phase 10 devra implémenter le Panic Wipe best-effort. Aucun comportement de purge n’a été ajouté ici.
