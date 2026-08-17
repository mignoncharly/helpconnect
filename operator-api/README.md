# API opérateur privée — Phase 8

Cette API Node.js est la frontière d’authentification et d’autorisation du portail séparé. Elle n’est jamais importée, construite ou servie par la PWA publique.

## Contrôles

- authentification WebAuthn sans mot de passe, `userVerification: required` ;
- challenge aléatoire à usage unique, expiration cinq minutes ;
- session opaque côté serveur, 15 minutes d’inactivité et 8 heures absolues ;
- cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict` ;
- origine exacte et jeton CSRF pour chaque mutation ;
- autorisation `deny by default` par action, région et catégorie ;
- séparation éditeur, validateur et publicateur ;
- lecture filtrée au scope ;
- cinq assertions invalides déclenchent un blocage temporaire de quinze minutes par adresse et credential ;
- le proxy supprime tout `X-HC-Rate-Key` entrant puis injecte une valeur opaque stable par client ; l’API ne conserve qu’un hash salé en RAM afin d’éviter qu’un client bloque tous les opérateurs derrière loopback ;
- révocation d’un compte ou credential avec destruction immédiate de ses sessions ;
- journal d’audit minimisé et chaîné, sans assertion, cookie, CSRF ou clé publique.

## Provisionnement

`config/operators.example.json` est volontairement révoqué et inutilisable. Une cérémonie WebAuthn administrative hors ligne doit produire l’identifiant et la clé publique COSE encodés en base64url. Aucun fichier secret ou clé privée ne doit être copié dans ce dépôt : la clé privée demeure dans l’authenticator.

Les grants acceptent seulement `READ`, `EDIT`, `VALIDATE`, `PUBLISH` et `REVOKE_ACCOUNT`. Les jokers `*` sont nécessaires sur région et catégorie pour la révocation globale. Toute action inconnue fait échouer le démarrage.

## Démarrage de référence

Variables obligatoires :

```text
HC_OPERATOR_ORIGIN=https://operators.helpconnect.example
HC_WEBAUTHN_RP_ID=operators.helpconnect.example
HC_OPERATOR_CONFIG=<registre privé JSON>
HC_RECORDS_PATH=<fiches privées JSON>
HC_AUDIT_PATH=<journal JSONL privé>
HC_REVOCATION_PATH=<journal de révocation JSONL privé>
HC_OPERATOR_PORT=8443
```

Puis `npm --workspace help-connect-operator-api start` derrière un terminateur TLS qui ne fait confiance qu’au loopback. Le serveur refuse une origin non HTTPS et n’écoute que `127.0.0.1`. Le proxy doit remplacer, et non relayer, `X-HC-Rate-Key` par un identifiant opaque de 16 à 128 caractères base64url ; cette valeur ne doit jamais être journalisée.

Les stores en mémoire et fichiers JSONL constituent une implémentation de référence mono-instance. Avant données réelles, ils doivent être remplacés par un stockage transactionnel centralisé, sauvegardé et à accès restreint ; le contrat du noyau et les tests d’autorisation restent applicables. La chaîne de hash du journal détecte les ruptures accidentelles mais n’est pas une signature cryptographique : la signature appartient à la Phase 9.
