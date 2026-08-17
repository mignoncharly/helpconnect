# ADR-013 — Store transactionnel du système opérateur

Statut : **acceptée**, 17 août 2026. Portée : système opérateur privé uniquement.
La PWA publique n'est pas concernée et ne doit pas être modifiée par ce changement.

## Contexte

L'état du système opérateur vit aujourd'hui dans quatre fichiers plats, lus au
démarrage et écrits par `appendFileSync` :

| Fichier | Contenu | Écriture |
| --- | --- | --- |
| `operators.json` | registre des opérateurs et de leurs passkeys | aucune |
| `records.json` | fiches privées avant publication | aucune |
| `audit.jsonl` | journal d'audit chaîné par hash | ajout ligne à ligne |
| `revocations.jsonl` | révocations d'opérateurs et de credentials | ajout ligne à ligne |

Ce modèle ne peut pas satisfaire quatre exigences de la remédiation Phase 19 :

1. **Atomicité.** Une révocation doit modifier le registre *et* écrire son
   événement d'audit *et* son événement de révocation, ou ne rien faire. Trois
   `appendFileSync` successifs n'offrent aucune garantie de tout-ou-rien : un
   arrêt entre le premier et le deuxième laisse un état incohérent.
2. **Intégrité de la chaîne d'audit à l'écriture.** `validateAuditJournal`
   vérifie `sequence`, `previous_hash` et `hash` à la lecture, mais rien
   n'empêche un écrivain d'ajouter une ligne rompant la chaîne. La vérification
   doit précéder l'écriture, pas la suivre.
3. **Écrivain unique et contrôlé.** Une cérémonie d'enrôlement qui écrirait
   directement dans un JSONL contournerait à la fois l'atomicité et la
   vérification de chaîne. Le format plat n'offre aucun moyen de l'interdire.
4. **Sauvegarde cohérente.** Copier quatre fichiers pendant qu'un processus
   écrit produit une sauvegarde éventuellement déchirée, sans point de
   cohérence commun.

## Options considérées

### A — Conserver les fichiers plats, avec écriture atomique

Écriture par fichier temporaire puis `rename`, plus un verrou de répertoire.

Rejetée. `rename` rend atomique l'écriture *d'un* fichier, pas la transaction
*entre* quatre fichiers. Obtenir le tout-ou-rien inter-fichiers reviendrait à
écrire un journal de transactions à la main, c'est-à-dire à réimplémenter un
moteur transactionnel dans une frontière de sécurité — exactement ce qu'il faut
éviter.

### B — SQLite via `node:sqlite`

Base fichier unique, ouverte en processus par l'API.

### C — PostgreSQL 16

Une instance est déjà installée sur l'hôte et écoute en loopback.

Rejetée pour trois raisons. D'abord elle est **partagée** avec d'autres
applications de l'hôte : y placer la frontière de sécurité opérateur contredit
la compartimentation posée en [ADR-001](../phase-0/architecture.md). Une
instance dédiée lèverait l'objection mais ajouterait un service, un cycle de
vie et une surveillance pour une charge d'un seul écrivain. Ensuite elle impose
un **secret de connexion** à créer, stocker, distribuer et faire tourner, là où
l'option B n'en a aucun. Enfin le pilote `pg` ajouterait un arbre de
dépendances à un composant qui en compte aujourd'hui exactement une.

## Décision

**SQLite, via le module intégré `node:sqlite`**, dans un fichier unique du
répertoire de données du service, en mode WAL, avec `foreign_keys` activé.

### Pourquoi

- **Aucune dépendance ajoutée.** `node:sqlite` fait partie de Node 22. La
  politique d'audit interdit déjà toute dépendance runtime à la racine, et
  l'API opérateur n'en a qu'une. L'option C en aurait ajouté un arbre entier à
  une frontière de sécurité.
- **Aucun secret de connexion.** La contrainte « secrets de connexion
  uniquement sur le VPS » est mieux satisfaite en n'en ayant aucun. Le contrôle
  d'accès est celui du système de fichiers : fichier `0600`, propriété du compte
  de service, répertoire `0750`.
- **Une seule frontière transactionnelle.** Les quatre domaines vivent dans un
  fichier, donc dans une transaction. Le tout-ou-rien exigé est celui du moteur,
  pas un protocole maison.
- **Le modèle d'écrivain unique est ici un atout.** Un journal chaîné par hash
  ne *peut pas* accepter deux écrivains concurrents : deux événements calculant
  leur `previous_hash` depuis le même parent produiraient une fourche. La
  sérialisation stricte de SQLite est la sémantique voulue, pas une limite subie.
- **Sauvegarde cohérente native.** `node:sqlite` expose une API de sauvegarde en
  ligne qui produit une copie cohérente sans arrêter le service. La restauration
  dans une base isolée est une copie de fichier, une ouverture et une
  revalidation complète.

### Coûts et risques assumés

- `node:sqlite` est marqué **expérimental** dans Node 22 et émet un
  `ExperimentalWarning` à l'import. Son API peut changer.
  *Mitigation* : tous les appels au moteur sont confinés dans un module
  adaptateur unique ; aucun autre fichier n'importe `node:sqlite`. Un changement
  d'API, ou un remplacement du moteur, reste local à ce module.
- **Un seul hôte, aucune réplication.** Assumé : l'API est déjà mono-hôte, liée
  à la loopback, et sa disponibilité ne dépend pas d'un quorum.
- **Un seul écrivain.** Assumé et recherché, voir ci-dessus.

## Conséquences

### Modèle de données

Les opérateurs et les fiches sont stockés comme **documents JSON validés** dans
des lignes indexées par identifiant, et non éclatés en colonnes. Les validateurs
existants restent la source unique de vérité sur leur forme : dupliquer ces
règles en contraintes SQL créerait deux définitions à maintenir, dont l'une
pourrait diverger sans que rien ne l'indique.

Le journal d'audit, lui, est structuré en colonnes : `sequence` est la clé
primaire et `hash` porte une contrainte d'unicité. Le moteur interdit donc
matériellement un numéro de séquence dupliqué ou un hash rejoué, en plus de la
vérification applicative.

### Vérification avant écriture

Tout ajout au journal d'audit vérifie, **dans la transaction et avant
insertion**, que `sequence` suit exactement le dernier numéro, que
`previous_hash` est le `hash` du dernier événement, et que `hash` est bien le
condensat du corps de l'événement. Un écart annule la transaction entière.

### Reprise après redémarrage

L'ouverture du store relit et revalide **tout** le journal, pas seulement le
dernier événement, avant d'accepter la moindre écriture. Une chaîne rompue
empêche le démarrage plutôt que de le laisser continuer sur un état douteux.

### Impact sur la politique d'audit de sécurité

`scripts/security-audit-policy.mjs` exige aujourd'hui que `server.mjs` contienne
littéralement `validateAuditJournal(readJsonLines(auditPath))`, sous le libellé
« startup audit verification ». Ce fragment disparaît avec les fichiers plats.

Cette règle doit donc être mise à jour **dans le même changement**, pour exiger
la garantie équivalente au niveau du store — revalidation complète de la chaîne
à l'ouverture — et son test adapté. Le point est signalé ici explicitement :
il s'agit d'un assouplissement apparent de la politique de sécurité, et il ne
doit pas passer inaperçu en revue. L'exigence n'est pas retirée, elle est
déplacée là où la vérification a désormais lieu.

### Migration

La migration est **dry-run par défaut**. Elle lit les quatre fichiers, les
valide avec les validateurs existants, calcule et enregistre le SHA-256 de
chaque source, et n'écrit qu'avec un drapeau explicite. Les sources sont
sauvegardées avant écriture, et un rollback restaure l'état antérieur.

### Ce que cette décision ne fait pas

Elle ne réactive pas l'API opérateur, n'introduit aucune cérémonie d'enrôlement
et ne modifie pas l'origin publique. Le dossier Phase 19 reste `NO_GO` tant que
la restauration et l'enrôlement ne sont pas réellement exercés.
