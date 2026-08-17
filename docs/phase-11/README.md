# Phase 11 — Hardening Web

## Résultat

HELP CONNECT dispose désormais d’une politique de sécurité HTTP unique, générée et testée pour chaque surface. La PWA publique, le portail opérateur, l’API opérateur et les exports HTML autonomes de premiers secours ont des profils distincts afin de ne pas élargir les permissions d’une surface pour les besoins d’une autre.

La PWA reste sans tiers, sans cookie et pleinement utilisable hors ligne. `Cache-Control: no-store` interdit la conservation implicite dans le cache HTTP ; l’installation hors ligne continue de passer uniquement par le Service Worker et ses écritures explicites, signées et atomiques dans CacheStorage.

## Profils appliqués

### PWA publique

- CSP `default-src 'none'`, avec uniquement les scripts, styles, connexions, worker et manifeste same-origin nécessaires ;
- aucun script inline, `eval`, frame, objet, police ou média ; images limitées à `self` et `data:` ;
- `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `base-uri 'none'` et `form-action 'none'` ;
- Trusted Types obligatoire pour les sinks de script ; une seule policy nommée `help-connect-static` accepte exclusivement `./service-worker.js` ;
- géolocalisation, caméra, microphone, paiement, USB, série, HID et passkeys désactivés par Permissions Policy ;
- `no-referrer`, `nosniff`, COOP/CORP same-origin et Origin-Agent-Cluster actif ;
- HSTS de deux ans avec `includeSubDomains` et `Cache-Control: no-store` sur tous les artefacts.

### Exports autonomes de premiers secours

Les exports complets sont sans JavaScript et sans accès réseau. Leur CSP interdit les scripts et les connexions ; seul le CSS inline généré dans le fichier est autorisé. Cette exception n’est présente ni dans la PWA ni dans le portail opérateur.

### Portail et API opérateur

Le portail conserve uniquement `publickey-credentials-get=(self)` pour WebAuthn. L’API n’accorde aucune permission de navigateur et utilise une CSP sans contenu actif. Les deux origins gardent les mêmes protections de transport, de cache, de framing, de referrer et d’isolation que l’origin publique.

## Déploiement et TLS

Le build produit `dist/_headers`, dérivé de `shared/security-headers.js`. La validation échoue si ce fichier, les meta CSP de repli ou `operator-portal/security-headers.json` divergent de la politique canonique.

`_headers` n’est pas un standard universel de serveur. Sur un hébergeur qui ne le reconnaît pas, chaque bloc doit être transcrit dans sa configuration. `frame-ancestors` est envoyé par en-tête HTTP car cette directive n’est pas prise en charge dans une meta CSP, conformément à [Content Security Policy Level 3](https://www.w3.org/TR/CSP/).

Avant chaque mise en production, exécuter :

```powershell
npm run security:check-deployment -- https://origin-publique.example/
```

Ce contrôle vérifie une réponse HTTPS 200, TLS 1.2 ou 1.3, tous les en-têtes exacts, l’absence de `Set-Cookie` et une redirection HTTP 301/308 qui conserve l’hôte et le chemin. Ces propriétés ne peuvent pas être prouvées par un build local statique.

HSTS suit le mécanisme défini par la [RFC 6797](https://www.rfc-editor.org/rfc/rfc6797). `includeSubDomains` ne doit être activé en production que si tous les sous-domaines concernés servent correctement HTTPS. Le projet ne demande pas le preload HSTS, qui exige une décision opérationnelle séparée et plus difficile à annuler.

## Choix de sécurité

- `no-store` suit les règles de cache de la [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) et évite une copie HTTP implicite distincte des caches applicatifs contrôlés ;
- la Permissions Policy est fermée selon la [spécification W3C](https://www.w3.org/TR/permissions-policy/) ;
- Trusted Types réduit les sinks DOM capables de recevoir du code, selon la [spécification Trusted Types](https://www.w3.org/TR/trusted-types/) ;
- aucune URI de reporting CSP n’est configurée afin de ne pas créer de télémétrie ou de fuite réseau ;
- aucune ressource, police, SDK, carte ou script tiers n’est autorisé par la CSP.

## Fichiers principaux

- `shared/security-headers.js` : source canonique des CSP, Permissions Policy et en-têtes communs ;
- `src/index.html`, `src/app.ts` : meta CSP de repli et policy Trusted Types étroite pour le Service Worker ;
- `scripts/build.mjs`, `scripts/build-first-aid.mjs` : génération de `_headers` et des exports sans script ;
- `operator-portal/security-headers.json`, `operator-api/src/server.mjs` : profils privés séparés ;
- `scripts/validate-dist.mjs`, `scripts/validate-operator-dist.mjs` : comparaison exacte des artefacts générés ;
- `scripts/check-public-deployment.mjs` : contrôle de l’origin réellement publiée ;
- `test/security-headers.test.mjs`, `test/operator-api-smoke.test.mjs` : invariants et réponses API ;
- `scripts/offline-smoke.mjs` : preuve navigateur de l’application des politiques et du maintien du mode hors ligne.

## Validation

- 66/66 tests Node réussis, dont 5 tests dédiés aux profils de sécurité ;
- lint, trois typechecks TypeScript stricts et vérification syntaxique API réussis ;
- builds public et opérateur, inventaires et validation des 13 artefacts signés réussis ;
- smoke test Edge en ligne/hors ligne réussi avec les en-têtes de production exacts ;
- CSP vérifiée dans le navigateur : code dynamique bloqué ;
- Trusted Types vérifié dans le navigateur : sink HTML et policy non autorisée bloqués ;
- géolocalisation et passkeys refusées par la Permissions Policy publique ;
- aucune origin tierce ni cookie observé ; cache signé altéré refusé ; Panic Wipe toujours fonctionnel.

Le smoke test lance uniquement une page locale dans un profil temporaire et ajoute `--no-sandbox` pour contourner un conflit entre le sandbox Chromium de l’environnement Windows géré et le cache GPU Dawn. Cette option appartient au harnais de test et n’est ni une option de build ni une recommandation de lancement pour les utilisateurs.

## Poids

| Budget | Mesure Brotli | Limite |
| --- | ---: | ---: |
| Transfert initial | 24 031 octets | 200 Ko |
| Core offline | 24 031 octets | 300 Ko |
| Distribution complète | 52 745 octets | 500 Ko |
| JavaScript total | 13 142 octets | 80 Ko |
| CSS total | 3 385 octets | 30 Ko |
| Politique `_headers` | 451 octets | inclus dans le plafond |

L’augmentation par rapport à la Phase 10 est de 156 octets Brotli sur le transfert initial et de 680 octets sur la distribution complète.

## Limites restantes

- le contrôle TLS/redirection doit être exécuté contre l’URL finale, indisponible dans ce workspace ;
- les en-têtes doivent être confirmés après toute modification de proxy, CDN ou hébergeur ;
- HSTS ne protège qu’après une première réponse HTTPS valide en l’absence de preload ;
- les politiques navigateur ne remplacent pas la validation des signatures applicatives déjà mise en place.

## Arrêt de phase

La Phase 11 est terminée. Aucun travail propre à la Phase 12 — privacy réseau et preuve d’absence de télémétrie — n’a été commencé dans cette phase.
