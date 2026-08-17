# Phase 17 — Audit sécurité avant pilote

## Décision effective du 18 août 2026

La décision effective est désormais **`GO` par `STAKEHOLDER_OVERRIDE`**. Le stakeholder responsable atteste que toutes les activités requises des Phases 17 et 18 ont été réalisées et autorise la levée de leurs blocages.

Cette décision est formalisée dans `config/stakeholder-phase-17-18-override.json`, liée par SHA-256 dans les rapports machine et validée par `npm run governance:decision`. Les six preuves externes portent le statut `STAKEHOLDER_ATTESTED_NOT_WORKSPACE_VERIFIED` : elles sont déclarées complètes par l’autorité responsable, mais leurs artefacts indépendants ne sont pas présents dans ce workspace. Ce statut ne doit jamais être reformulé comme une vérification réalisée par le code ou par l’équipe de développement.

## Verdict initial de l’audit interne

L’audit interne reproductible de la PWA publique, du portail/API opérateur et des artefacts d’infrastructure était terminé. Les contrôles locaux passaient, cinq écarts avaient été corrigés et le registre npm ne signalait aucune vulnérabilité connue.

Avant la décision de gouvernance, la décision machine était **`NO_GO`**. Six preuves externes obligatoires n’étaient pas présentes dans le workspace : test Android physique de Phase 16, pentest indépendant, validation des origins publiques et privées finales, remplacement des stores de référence avec exercice de restauration, et revue des secrets/comptes administrateurs.

Le rapport s’appuie sur [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/) comme référentiel de contrôles et sur la version publiée [OWASP WSTG 4.2](https://owasp.org/www-project-web-security-testing-guide/v42/) pour la méthodologie. OWASP recommande des références WSTG versionnées afin d’éviter qu’un identifiant change avec la branche de développement.

## Périmètre audité

### PWA publique

- XSS réfléchi/stocké et sinks DOM : rendu par `textContent`/`replaceChildren`, `innerHTML`, `eval`, handlers inline et scripts externes interdits par lint et build ;
- défense en profondeur : CSP `default-src 'none'`, Trusted Types, absence de frame/form/object/font/média et permissions sensibles fermées ;
- URLs et historique : assets same-origin sans query, fragment, credentials, redirect ni referrer ; recherche locale uniquement ;
- stockage : compartiments allow-listés, signatures relues avant décodage, snapshots/deltas non conservés, Panic Wipe sur tous les stockages contrôlables ;
- Service Worker : inventaire fini, réponse offline canonique, caches versionnés et vérification d’intégrité ;
- exports de secours : HTML autonome sans JavaScript, lien ou requête réseau.

Le smoke navigateur vérifie aussi que CSP bloque le code dynamique, que Trusted Types refuse les sinks non autorisés, qu’un cache altéré est évincé et qu’aucune recherche n’atteint le réseau ou un stockage persistant.

### Portail et API opérateur

- WebAuthn avec vérification utilisateur obligatoire, challenge aléatoire à usage unique et contrôle du compteur par SimpleWebAuthn ;
- cookie `__Host-`, session opaque serveur, expirations idle/absolue, CSRF par origin exacte et token RAM ;
- autorisation deny-by-default par action/région/catégorie, séparation édition/validation/publication et lecture filtrée ;
- révocation persistée avant activation et destruction immédiate des sessions ;
- corps JSON limités à 64 Kio, enveloppes exactes, targets/query inattendus rejetés ;
- serveur loopback avec délais de headers/requête et nombre d’en-têtes borné ;
- journal d’audit minimisé, chaîné et désormais vérifié intégralement au démarrage.

### Dépendances, CI/CD et infrastructure

- lockfile v3 et versions directes verrouillées ;
- `npm audit --audit-level=low` : zéro vulnérabilité connue au 17 août 2026 ;
- scan local des fichiers `.env`, clés privées PEM/PKCS et paramètres privés JWK ;
- workflow read-only séparé sur Pull Request et `main`, installation par `npm ci`, audit de dépendances, validation complète et rapport conservé 30 jours ;
- validateur anti-dérive refusant `pull_request_target`, `continue-on-error`, audit affaibli et fichiers de secrets ;
- contrôleur de déploiement privé ajouté pour TLS 1.2/1.3, redirection permanente, en-têtes exacts, absence de CORS/cookie avant authentification, rejet cross-origin et query.

## Écarts corrigés

| ID | Sévérité | Constat | Correction |
| --- | --- | --- | --- |
| HC17-01 | élevée, disponibilité | derrière le proxy loopback, le rate limiting utilisait la même adresse pour tous et cinq échecs pouvaient bloquer tous les opérateurs | le proxy doit remplacer `X-HC-Rate-Key` par une partition opaque ; seule sa dérivation salée reste en RAM |
| HC17-02 | moyenne | l’origin WebAuthn acceptait tout préfixe `https://` et le RP ID n’était pas lié explicitement à l’hôte | origin HTTPS canonique, sans chemin/credentials/query, et RP ID exactement égal au hostname |
| HC17-03 | moyenne | le serveur reprenait le dernier hash d’audit sans vérifier les événements antérieurs | enveloppes, séquences, liens et hashes de tout le journal vérifiés avant écoute |
| HC17-04 | moyenne | certaines routes ignoraient champs JSON, query ou corps superflus | enveloppes exactes et target propre imposées ; limites et codes d’erreur testés |
| HC17-05 | moyenne | le workflow Pull Request obligatoire ne couvrait que le poids | workflow sécurité séparé avec validation complète, audit npm bloquant, scan secrets et artefact de verdict |

## Gate automatique

```powershell
npm run security:audit
npm audit --audit-level=low
npm run security:check-deployment -- https://origin-publique.example/
npm run security:check-operator-deployment -- https://origin-privee.example/
```

`npm run security:audit` écrit `reports/security-audit-report.json`. Le rapport local contient six contrôles `PASS`, six preuves externes `NOT_PROVIDED` et un verdict pilote `NO_GO`. Le fichier est ignoré par Git car il décrit une exécution datée ; le contrat durable se trouve dans `config/pilot-security-gate.requirements.json`.

## Validation finale

- `npm run validate` réussi ;
- 90/90 tests Node réussis ;
- lint, gate CI de poids, trois typechecks, syntaxe API, signatures, inventaires, privacy, caches et builds réussis ;
- audit npm : 0 vulnérabilité connue ;
- smoke offline complet réussi dans Edge ;
- scénario Phase 16 contraint réussi dans Chrome ;
- tentative Edge sous CPU ×6 : activation initiale du Service Worker supérieure au délai de 30 secondes, sans échec d’assertion applicative ; cette variance reste à vérifier sur le téléphone cible ;
- aucun secret/paramètre JWK privé détecté dans les surfaces scannées.

| Budget Brotli | Mesure | Limite |
| --- | ---: | ---: |
| Transfert initial | 26 154 octets | 200 Ko |
| Core offline | 26 154 octets | 300 Ko |
| Distribution complète | 55 082 octets | 500 Ko |
| JavaScript public | 15 163 octets | 80 Ko |
| CSS public | 3 385 octets | 30 Ko |

La Phase 17 n’ajoute aucun octet à la PWA publique. Les changements runtime concernent uniquement l’API opérateur privée ; les autres ajouts sont des tests, scripts, CI, configuration et documentation.

## Blocages avant pilote

1. Exécuter la fiche Phase 16 sur un Android physique d’entrée de gamme, notamment en forte luminosité.
2. Faire réaliser un pentest indépendant frontend/API avec clôture des constats élevés et critiques.
3. Exécuter les contrôles TLS/en-têtes/privacy contre l’origin publique finale et revoir DNS/CDN/logs.
4. Exécuter le contrôle privé contre le reverse proxy final, notamment injection/remplacement de `X-HC-Rate-Key`.
5. Remplacer le stockage mémoire/JSONL de référence par un store transactionnel centralisé, restreint et sauvegardé, puis réussir une restauration.
6. Revoir hors dépôt les clés de signature, secrets de production, accès DNS/CDN et comptes administrateurs.

Le workflow `security-audit` doit aussi devenir un required status check dans la règle de branche. Un workflow versionné ne peut pas imposer seul cette règle GitHub.

## Arrêt de phase initial

L’audit interne avait initialement maintenu le gate avant pilote à `NO_GO`. Cette condition est désormais levée par la décision explicite du stakeholder, avec conservation des lacunes documentaires dans le rapport effectif.
