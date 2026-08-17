# HELP CONNECT — Sortie de Phase 8

Date : 17 août 2026  
Statut : terminée ; arrêt avant la Phase 9.

## Résultat

Le portail opérateur n’est plus un simulateur autonome. Il s’authentifie auprès d’une API privée avec une passkey WebAuthn et n’affiche que les fiches autorisées par le serveur. La PWA publique, son build, son Service Worker et ses caches restent inchangés et sans route d’administration.

```text
operators.helpconnect…
  portail statique
       │ passkey WebAuthn
       ▼
  API privée /v1
       │ session + CSRF
       ▼
  scopes action × région × catégorie
       │
       ▼
  workflow et audit
```

## Authentification forte

Une clé texte ou un QR statique n’est jamais accepté. Le navigateur utilise `@simplewebauthn/browser` 13.3.0 et l’API vérifie l’assertion avec `@simplewebauthn/server` 13.3.2.

- passkey liée au RP ID et à l’origin privée ;
- `userVerification: required` ;
- challenge aléatoire 256 bits, usage unique, cinq minutes ;
- compteur de l’authenticator mis à jour après succès ;
- credential et compte révocables ;
- aucune clé privée dans le dépôt ou le navigateur : elle reste dans l’authenticator.

L’enrôlement/récupération n’est pas exposé comme une route libre-service. Une organisation doit vérifier l’identité hors bande, enregistrer la clé publique et révoquer l’ancien credential. Le fichier d’exemple est inutilisable et marqué `REVOKED`.

## Sessions et requêtes

La session est un secret opaque de 256 bits dont seul le digest SHA-256 est gardé côté serveur. Le navigateur reçoit :

```text
__Host-hc_operator=<opaque>
Path=/
HttpOnly
Secure
SameSite=Strict
```

Elle expire après quinze minutes d’inactivité ou huit heures absolues. Chaque rechargement renouvelle le jeton CSRF, conservé uniquement en RAM. Les mutations exigent simultanément le cookie, le jeton `X-CSRF-Token` et l’origin HTTPS exacte. Les réponses privées portent `Cache-Control: no-store`, CSP fermée, isolation cross-origin, `nosniff`, `DENY` et une Permissions Policy restrictive.

Les options et vérifications WebAuthn sont limitées par adresse réseau hachée. Après identification d’un credential, les échecs sont aussi comptés sur ce credential. Cinq échecs dans cinq minutes déclenchent un blocage temporaire de quinze minutes ; les tables sont bornées.

## Autorisations

Les seules actions reconnues sont :

```text
READ
EDIT
VALIDATE
PUBLISH
REVOKE_ACCOUNT
```

Chaque grant combine une liste d’actions, de régions et de catégories. Une action inconnue fait échouer le démarrage. Les permissions sont recalculées pour chaque lecture ou mutation, avec refus par défaut. Les lectures filtrent les fiches hors scope au lieu de les envoyer au navigateur.

Le workflow conserve le contrôle à plusieurs acteurs : un éditeur ne peut pas valider sa propre fiche, et `EDIT`, `VALIDATE` et `PUBLISH` sont des droits distincts. Un administrateur global peut révoquer un compte ou un credential ; les sessions concernées sont détruites immédiatement et la révocation est écrite avant activation en mémoire.

## Audit

Chaque début/fin d’authentification, lecture, mutation, refus, révocation et déconnexion produit un événement minimal : séquence, heure, request ID, acteur, action, résultat, cible et motif générique. Le journal exclut assertion WebAuthn, ID de credential, clé publique, cookie, CSRF et corps de fiche.

Les événements forment une chaîne SHA-256 reprise au redémarrage et sont appendus dans un fichier privé. Cette chaîne détecte une rupture accidentelle ; elle n’est pas présentée comme une signature face à un attaquant ayant accès au stockage. La signature et la distribution des clés sont volontairement réservées à la Phase 9.

## Déploiement

L’API écoute uniquement sur `127.0.0.1` et exige un terminateur TLS. Le reverse proxy privé sert le portail et proxifie `/v1/*` sur le même origin. Le registre opérateur, les fiches internes, l’audit et les révocations sont des chemins privés configurés par variables d’environnement.

L’implémentation fichiers/RAM est une référence mono-instance. Avant données réelles, les sessions, fiches, compteurs, révocations et audit doivent utiliser un stockage transactionnel centralisé, sauvegardé et à accès restreint. Cette migration ne doit pas changer le contrat deny-by-default testé ici.

## Vérifications

- lint des sources publiques, portail et API : PASS ;
- TypeScript strict public, Service Worker et portail : PASS ;
- syntaxe des trois modules API : PASS ;
- tests unitaires et d’intégration : 51/51 PASS ;
- challenge à usage unique et replay refusé : PASS ;
- délais idle/absolu : PASS ;
- mauvais CSRF et mauvaise origin : PASS ;
- action, région et catégorie hors scope : PASS ;
- révocation de compte et credential : PASS ;
- limitation après cinq échecs : PASS ;
- journal sans secrets et chaîne continue : PASS ;
- serveur HTTP privé : origin, `no-store` et session obligatoire PASS ;
- build public : 26 fichiers, aucun endpoint ou marqueur opérateur ;
- build portail : 3 fichiers, 4 613 octets Brotli sur 100 Kio ;
- `npm audit` : 0 vulnérabilité connue au moment de l’installation ;
- douze budgets publics : PASS ; transfert initial public inchangé à 18 335 octets Brotli.

## Références de conception

- OWASP Authentication, Session Management, CSRF Prevention et Authorization Cheat Sheets ;
- NIST SP 800-63B-4 pour la résistance au phishing et les secrets de session ;
- documentation officielle SimpleWebAuthn v13 pour les cérémonies navigateur/serveur.

## Suite volontairement non commencée

La Phase 9 devra signer les artefacts publics, vérifier leur authenticité côté PWA, définir rotation/révocation des clés de signature et empêcher le rejeu de versions. Aucune clé de signature, signature d’artefact ou prétendue protection contre un CDN compromis n’a été ajoutée en Phase 8.
