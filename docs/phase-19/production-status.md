# Phase 19 — état de production

Note publique expurgée. Le dossier de déploiement complet, ses preuves et la
configuration d'infrastructure sont conservés hors de ce dépôt : ils exposeraient
des détails d'origins, d'hébergement et de configuration interne.

## Verdict

**`NO_GO` — 11 écarts.** Le dossier en comptait 14 le 17 août ; trois ont été
fermés le 18 août par le déploiement du store transactionnel.

L'origin publique a été mise en service le 17 août 2026, **avant** l'établissement
du dossier Phase 19. Cette note enregistre ce fait ; elle ne le régularise pas.
L'origin opérateur ne sert que le portail statique : son API est désactivée.

## Artefacts liés

Empreintes d'arbre déterministes (`HELP_CONNECT_RELEASE_TREE_V1`, SHA-256),
recalculées et validées par le gate contre le build local :

| Artefact | Fichiers | SHA-256 d'arbre |
| --- | ---: | --- |
| `dist/` | 42 | `90181e09122d042fc902925c1fa6168c488e473e7a5daa5cee9b8416d667e441` |
| `operator-portal/dist/` | 3 | `a9b5c42fdc0fb2923efe709073dbc53bfc2f007def4d8dd008b83d9d5a02de29` |

Ces empreintes sont identiques à celles du build validé documenté dans le
[rapport de Phase 19](./README.md).

## Validé sans réserve par le gate

Le gate n'a levé aucun écart sur ces points ; ils sont donc vérifiés
mécaniquement, et non déclarés :

- les deux empreintes correspondent octet pour octet au build local ;
- les origins publique et opérateur sont des origins HTTPS canoniques sur des
  hôtes distincts ;
- la décision Phase 18 `GO` est liée par SHA-256 à son rapport d'admission ;
- la frontière publique est déclarée `GET`/`HEAD` et observée comme telle en live ;
- 5 preuves sur 10 et 4 contrôles sur 8 sont `PASS`.

Les preuves `PASS` reposent sur des sorties de commandes réelles, liées par
SHA-256 au dossier privé, et non sur des attestations.

## Les 11 écarts

**Fermés le 18 août 2026 — 3.** Le store transactionnel est déployé, sauvegardé
par une tâche planifiée qui revalide chaque copie, et restauré dans une base
isolée. Réserve enregistrée dans le dossier : le store ne contient encore aucune
donnée, la restauration a donc revalidé zéro événement — le mécanisme est prouvé,
pas la reprise de données d'exploitation. Concerne `transactional-restore`,
`backup-before-cutover` et `backup_verified`.

**Bloqués par l'absence d'enrôlement — 2.** L'API opérateur ne démarre pas : le
registre d'opérateurs vide est refusé, et aucune cérémonie d'enrôlement WebAuthn
n'existe dans ce dépôt. Aucune passkey ne peut donc être provisionnée avec les
outils actuels. Concerne `operator-live-security` et `operator-webauthn-enforced`.

**Non exercés — 5.** La mise en ligne est allée directement en production, sans
staging. Il n'existe qu'une seule release, donc aucune cible de retour arrière,
et le rollback n'a jamais été joué. Concerne `rollback-and-incident-drill`,
`staged-cutover`, `rollback-ready`, `rollback_ready` et `staged_cutover`.

**Non documentés — 3.** Ni inventaire des secrets et des accès administrateur,
ni politique de rotation. La branche `main` n'est pas protégée : les workflows
s'exécutent mais ne sont pas requis pour merger. Aucune fenêtre de changement
n'a été approuvée. Concerne `secrets-and-admin-access`,
`branch-protection-required-checks` et `change_window_approved`.

**Tension assumée — 1.** `privacy-preserving-operations` est `PASS` tandis que
`privacy_preserving_monitoring` reste `false`. Le contrôle porte sur la
configuration déployée, vérifiée sur l'origin live : aucun journal d'accès,
aucun cookie, aucun CDN, aucune télémétrie, zéro heure de rétention de log brut.
Le drapeau porte sur une pratique de supervision, qui n'existe pas encore.
Le déclarer `true` au motif qu'il n'y a rien à superviser transformerait une
absence en contrôle.

## Chemin de remédiation

Par ordre de dépendance :

1. ~~store transactionnel opérateur~~ — fait le 18 août 2026 ;
2. ~~sauvegarde et restauration vérifiée~~ — fait, sur un store encore vide ;
3. cérémonie d'enrôlement WebAuthn à usage unique et auditable ;
4. provisionnement du premier opérateur ;
5. contrôles live de l'origin opérateur ;
6. rejeu de la restauration une fois le store porteur de données réelles ;
7. exercice de rollback chronométré ;
8. revue des secrets et des accès administrateur ;
9. protection de branche et fenêtre de changement approuvée.

Tant qu'aucun opérateur réel n'est provisionné, le service API reste désactivé
et la Phase 19 reste `NO_GO`.
