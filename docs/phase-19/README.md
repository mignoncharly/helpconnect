# Phase 19 — Préparation du déploiement de production

## Statut

Le gate et le runbook de production sont implémentés. Le prérequis Phase 18 est désormais `GO` par dérogation explicite du stakeholder. L’origin publique a été mise en service le 17 août 2026, avant l’établissement d’un dossier réel ; l’origin opérateur ne sert que le portail statique, son API étant désactivée. Un dossier de production a été constitué après coup et produit `NO_GO` avec 14 écarts, détaillés dans [l’état de production](./production-status.md). Ce dossier et ses preuves sont conservés hors du dépôt. Le dossier fourni ici en exemple reste volontairement non admissible.

Cette phase ne transforme pas une attestation JSON en preuve réelle. Elle garantit que les artefacts, décisions, contrôles et responsabilités nécessaires sont complets et liés par hash avant qu’une action externe soit autorisée.

## Architecture de déploiement conservée

```text
PWA publique                    Système opérateur privé
dist/                           operator-portal/dist/
   |                                      |
CDN/static HTTPS                origin HTTPS distincte
   |                                      |
GET/HEAD uniquement             reverse proxy -> API loopback
   |                                      |
artefacts publics signés        WebAuthn + autorisations + audit
   +-------------------- publication minimisée ----------------+
                              |
                    store transactionnel sauvegardé
```

Le portail, l’API, les cookies, les passkeys et le store opérateur ne doivent jamais être servis depuis l’origin publique. Le CDN public ne reçoit aucune recherche et n’accepte pas de mutation applicative.

## Liaison aux artefacts exacts

Après un build validé :

```powershell
npm run validate
npm run release:hash
```

`release:hash` parcourt séparément `dist/` et `operator-portal/dist/`, trie les chemins, lie chaque chemin et taille à ses octets, puis écrit `reports/release-digests.json`. Tout lien symbolique ou dossier vide est refusé. Le domaine de hash est `HELP_CONNECT_RELEASE_TREE_V1` avec SHA-256.

Le dossier de production doit reprendre exactement les deux hashes et nombres de fichiers. `deployment:check` les recalcule ; reconstruire ou modifier un seul octet après approbation rend donc le dossier invalide.

## Gate de production

Préparer hors du répertoire public un dossier à partir de `deployment-dossier.example.json`, puis exécuter :

```powershell
npm run deployment:check -- path/to/deployment-dossier.json
```

Le gate exige :

- un résultat Phase 18 `GO` lié au rapport pilote par SHA-256 ;
- deux origins HTTPS canoniques sur des hôtes distincts ;
- les hashes exacts des builds public et opérateur locaux ;
- dix preuves récentes couvrant build/signatures, sécurité et privacy live, store/restauration, secrets/administrateurs, DNS/CDN, protection de branche et rollback ;
- huit contrôles assignés à des rôles, tous `PASS` ;
- une sauvegarde vérifiée, une fenêtre approuvée, un cutover progressif, un rollback prêt et des opérations sans collecte personnelle ;
- une frontière publique limitée à `GET` et `HEAD`.

Le rapport est écrit dans `reports/phase-19-deployment-report.json`. L’exemple versionné est volontairement ancien, lié à de faux hashes et entièrement `NO_GO`/`NOT_PROVIDED`/`NOT_READY`.

## Runbook de cutover

### 1. Gel et admission

1. Clore Phase 18 et obtenir un dossier pilote `GO`.
2. Produire une fois les builds avec le lockfile approuvé.
3. Exécuter validation, audit npm, smokes navigateur et vérification des signatures.
4. Calculer les hashes de release, archiver les artefacts en lecture seule et faire approuver le dossier Phase 19.
5. Interdire toute reconstruction ou substitution après le `GO` ; un changement exige un nouveau dossier.

### 2. Plan privé

1. Vérifier la sauvegarde et la restauration du store transactionnel.
2. Déployer l’API derrière le terminateur TLS, sur loopback uniquement.
3. Vérifier l’injection/remplacement de `X-HC-Rate-Key`, les journaux, la révocation et les passkeys provisionnées.
4. Déployer `operator-portal/dist/` sur l’origin privée, puis exécuter le contrôle live opérateur.
5. Ne poursuivre que si création, validation, publication, révocation et rollback sont exercés avec les permissions minimales.

### 3. Plan public

1. Charger `dist/` sur une cible de staging non indexée en conservant les noms et octets.
2. Exécuter les contrôles TLS/en-têtes, privacy, signatures, offline et poids.
3. Vérifier que `HEAD` fonctionne et que `POST`, `PUT`, `PATCH` et `DELETE` sont rejetés sans cookie ni CORS.
4. Promouvoir le même artefact immuable vers l’origin publique ; ne jamais reconstruire sur le CDN.
5. Réexécuter les contrôles sur l’origin finale avant d’élargir le trafic.

### 4. Observation et rollback

Les observations de disponibilité utilisent uniquement les champs agrégés autorisés par le contrat privacy. Aucun analytics applicatif, identifiant stable, IP conservée, user-agent, referer, query ou corps de requête ne peut être introduit.

Rollback immédiat si une signature échoue, si un point dangereux apparaît, si la PWA offline ne démarre plus, si la frontière publique accepte une mutation, si WebAuthn/autorisation échoue ou si une fuite de métadonnées est constatée. Restaurer l’artefact public précédemment hashé, retirer le portail si nécessaire, révoquer les accès compromis et conserver le store selon le plan de restauration validé. Toute reprise exige un nouveau gate `GO`.

## Pourquoi aucun workflow de déploiement n’est ajouté

Le fournisseur, les origins, les environnements protégés, les approbateurs et la stratégie de credentials ne sont pas définis. Ajouter maintenant un workflow publiant vers un fournisseur fictif créerait une fausse assurance et une future surface de secrets. Les workflows actuels restent read-only ; l’automatisation de production devra être ajoutée seulement avec des environments protégés, des credentials courts liés au fournisseur et une revue indépendante.

## Fichiers

- `config/phase-19-deployment.requirements.json` : exigences immuables du gate ;
- `scripts/release-hash-lib.mjs` et `scripts/hash-release.mjs` : empreintes déterministes ;
- `scripts/deployment-readiness-policy.mjs` : politique pure `GO/NO_GO` ;
- `scripts/check-deployment-readiness.mjs` : commande opératoire ;
- `test/deployment-readiness.test.mjs` : contrat, fail-closed et hash ;
- `docs/phase-19/deployment-dossier.example.json` : exemple volontairement non admissible.

## Validation du 18 août 2026

- `npm run validate` réussi ;
- 99/99 tests Node réussis, dont cinq tests Phase 19 ;
- `npm audit --audit-level=low` : zéro vulnérabilité connue ;
- smoke offline complet Edge réussi ;
- scénario contraint Chrome réussi, avec Android physique et forte luminosité toujours `NOT_RUN` ;
- l’exemple Phase 19 produit bien un rapport `NO_GO` ;
- le gate sécurité conserve six preuves externes absentes et le verdict pilote `NO_GO`.

Empreintes du build validé :

| Artefact | Fichiers | SHA-256 d’arbre |
| --- | ---: | --- |
| `dist/` | 42 | `90181e09122d042fc902925c1fa6168c488e473e7a5daa5cee9b8416d667e441` |
| `operator-portal/dist/` | 3 | `a9b5c42fdc0fb2923efe709073dbc53bfc2f007def4d8dd008b83d9d5a02de29` |

| Budget Brotli | Mesure | Limite |
| --- | ---: | ---: |
| Transfert initial | 26 154 octets | 200 Ko |
| Core offline | 26 154 octets | 300 Ko |
| Distribution complète | 55 082 octets | 500 Ko |
| JavaScript public | 15 163 octets | 80 Ko |
| CSS public | 3 385 octets | 30 Ko |

La préparation Phase 19 ajoute zéro octet aux distributions. Elle modifie uniquement les contrôles de déploiement et ajoute configuration, scripts, tests et documentation.

## Restant avant production

1. Exécuter et clore le pilote Phase 18.
2. Choisir les fournisseurs et origins, puis configurer les environnements protégés sans secret long dans GitHub.
3. Déployer et tester le store transactionnel ainsi que sa restauration.
4. Produire les dix preuves sur l’infrastructure finale et faire appliquer les required checks de branche.
5. Obtenir un rapport `deployment:check` `GO`, puis seulement exécuter le runbook.

La préparation Phase 19 ne constitue pas un déploiement ni une autorisation de production.
