# Phase 15 — Tests de poids automatisés

## Résultat

Chaque Pull Request exécute désormais un gate GitHub Actions dédié qui suit la chaîne imposée :

```text
build → minification → compression → mesure → comparaison aux budgets
```

Le job utilise le lockfile avec `npm ci`, reconstruit intégralement la PWA publique, compresse chaque artefact en gzip niveau 9 et Brotli qualité 11, mesure tous les ensembles budgétés puis termine en erreur dès qu’une limite est dépassée. Le même contrôle s’exécute sur `main` après fusion.

## Workflow Pull Request

Le workflow `.github/workflows/weight-budget.yml` :

- se déclenche sur chaque `pull_request` et chaque push vers `main` ;
- utilise Node.js 22, conformément au moteur déclaré par le projet ;
- installe exactement `package-lock.json` avec `npm ci` ;
- lance `npm run weight:validate`, puis `npm run weight:ci` ;
- publie `reports/weight-report.json` même lorsque la comparaison échoue ;
- limite le job à 15 minutes et annule les exécutions obsolètes de la même branche ;
- conserve le rapport 14 jours.

Le token du workflow est limité à `contents: read`. Le checkout ne conserve pas de credentials et `pull_request_target` est explicitement interdit par le validateur, afin que le code non approuvé d’une Pull Request ne s’exécute pas dans un contexte privilégié.

Le workflow suit les recommandations du guide officiel [Building and testing Node.js](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs) et utilise les actions GitHub maintenues officiellement : [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node) et [upload-artifact](https://github.com/actions/upload-artifact).

## Commandes et échec dur

La commande locale et CI est :

```powershell
npm run weight:ci
```

Elle est volontairement exacte et minimale :

```text
node scripts/build.mjs && node scripts/check-budget.mjs
```

`build.mjs` minifie JavaScript, CSS et HTML avant que `check-budget.mjs` ne mesure les fichiers de `dist/`. Le rapport est écrit avant l’assertion finale, de sorte qu’un dépassement reste inspectable comme artefact CI.

Un dépassement appelle `assertBudgets()` et lève une erreur commençant par :

```text
BUILD FAILED: one or more build budgets were exceeded
```

Il n’existe ni marge cachée, ni mode warning, ni tolérance différente en CI. Une valeur égale à la limite passe ; un seul octet supplémentaire échoue.

## Protection contre les régressions du gate

`npm run weight:validate` vérifie statiquement les invariants suivants :

- présence du déclencheur Pull Request ;
- permissions read-only et absence de `pull_request_target` ;
- versions attendues des actions officielles ;
- Node 22 et installation par lockfile ;
- ordre build puis comparaison ;
- minification activée avant mesure ;
- compression, rapport JSON et assertion d’échec dur présents ;
- upload du rapport même en cas d’échec.

Ce validateur fait lui-même partie de `npm run validate`. Les tests construisent aussi un workflow volontairement privilégié et warning-only pour confirmer son rejet.

## Budgets contrôlés

| Ensemble | Mesure Brotli | Limite |
| --- | ---: | ---: |
| Transfert initial | 26 154 octets | 200 Ko |
| Core offline | 26 154 octets | 300 Ko |
| Distribution complète | 55 082 octets | 500 Ko |
| JavaScript total | 15 163 octets | 80 Ko |
| CSS total | 3 385 octets | 30 Ko |
| Répertoire texte | 478 octets | 20 Ko |
| Toutes les régions | 1 619 octets | 40 Ko |
| Plus grosse région | 411 octets | 20 Ko |
| Protocole de mise à jour | 1 537 octets | 40 Ko |
| Plus gros micro-delta | 179 octets | 5 Ko |
| Métadonnées cryptographiques | 4 410 octets | 20 Ko |
| Toutes les fiches de secours | 16 477 octets | 150 Ko |
| Plus gros paquet de secours | 3 249 octets | 50 Ko |

La Phase 15 n’ajoute aucun octet au runtime public : le hash du shell et toutes les mesures restent identiques à la Phase 14.

## Fichiers principaux

- `.github/workflows/weight-budget.yml` : gate GitHub Actions des Pull Requests ;
- `package.json` : commandes `weight:ci` et `weight:validate` ;
- `scripts/check-budget.mjs` : rapport machine et appel à l’assertion finale ;
- `scripts/budget-lib.mjs` : compression, calculs et erreur `BUILD FAILED` ;
- `scripts/weight-ci-policy.mjs` : contrat testable du workflow ;
- `scripts/validate-weight-ci.mjs` : validateur anti-dérive exécuté localement et en CI ;
- `test/budget.test.mjs` : seuils à l’octet près, erreur dure et mutations négatives du workflow.

## Validation

- commande dédiée `npm run weight:ci` réussie de bout en bout ;
- 83/83 tests Node réussis ;
- lint, validateur CI, trois typechecks et vérification syntaxique API réussis ;
- builds, signatures, inventaires, privacy, compartimentation et 13 budgets réussis ;
- smoke test Chrome en ligne, réseau retardé et offline réussi ;
- fenêtre de démarrage du smoke API portée à 30 secondes pour éviter les faux négatifs sur runner chargé, sans modifier ses assertions de sécurité.

## Limites restantes

- le workflow doit être activé par la plateforme GitHub et configuré comme required status check dans les règles de branche pour empêcher effectivement une fusion ; cette règle de dépôt ne peut pas être imposée par un fichier versionné seul ;
- les mesures sont reproductibles avec les versions verrouillées du projet, mais peuvent évoluer lors d’une mise à jour explicite du minifier ou de Node ;
- cette phase vérifie le poids des artefacts, pas les performances d’un appareil réel ni les pertes réseau.

## Arrêt de phase

La Phase 15 est terminée. Aucun travail propre à la Phase 16 — tests sur appareils et réseaux réels — n’a été commencé dans cette phase.
