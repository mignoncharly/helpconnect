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

En production, ces opérations doivent s’exécuter dans un staging non servi, idéalement avec une clé non exportable en HSM/KMS puis un déploiement atomique. `npm run integrity:bootstrap-demo` sert uniquement à régénérer les fixtures : il crée des clés éphémères et détruit les clés privées, donc il ne constitue pas une gestion de clés opérationnelle.

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
