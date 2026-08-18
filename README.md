# HELP CONNECT

PWA publique de secours conçue pour fonctionner hors ligne, sur réseau très lent et sans compte, tracking ou géolocalisation automatique.

Les Phases 17 et 18 ont une décision effective **`GO` par `STAKEHOLDER_OVERRIDE`**. Le stakeholder responsable atteste leur réalisation et accepte que les artefacts externes ne soient pas vérifiables dans ce workspace ; les rapports conservent explicitement cette distinction. La Phase 19 reste séparément `NO_GO` et aucun déploiement n’a été exécuté.

## État de service

**La PWA publique est en service** pour de vrais utilisateurs : artefact signé,
chaîne de signatures vérifiée depuis l'origin, budgets de poids tenus.

**Le portail opérateur n'est pas un outil d'administration actif.** Aucun compte
opérateur n'existe, aucune passkey n'est provisionnée, et l'API opérateur est
volontairement arrêtée et désactivée. L'enrôlement WebAuthn est **reporté par
décision du stakeholder responsable**, avec réévaluation due le **18 septembre
2026**.

Conséquences, à connaître avant de compter sur ce périmètre :

- aucune création, modification ou invalidation de point d'aide n'est possible ;
- la révocation d'un accès opérateur n'est pas outillée — il n'existe aucun
  compte à révoquer, ce qui borne le risque, mais aucune procédure non plus ;
- la réponse à incident sur le système opérateur est manuelle ;
- toute mise à jour des données publiques passe par une nouvelle release signée.

Ce report est enregistré comme écart ouvert, jamais comme contrôle satisfait :
le dossier de déploiement reste `NO_GO`. Il vit hors de ce dépôt, avec les
preuves collectées sur l'hôte.

## Prérequis et commandes

Node.js 22 ou supérieur.

```powershell
npm ci
npm run validate
npm run weight:ci
npm run test:offline
npm run test:constrained
npm run security:audit
npm run governance:decision
npm run pilot:check -- path/to/pilot-admission.json
npm run release:hash
npm run deployment:check -- path/to/deployment-dossier.json
npm run security:check-deployment -- https://help-connect.example/
npm run security:check-operator-deployment -- https://operators.help-connect.example/
npm run privacy:check-deployment -- path/to/privacy-evidence.json
npm run store:migrate -- --source-dir path/to/data --database path/to/operator-store.db
npm run store:backup -- --database path/to/operator-store.db --output path/to/backup.db
npm run store:restore-proof -- --backup path/to/backup.db --into path/to/isolated
```

`npm run validate` exécute le lint des règles de sécurité sur les deux applications, le module d’intégrité partagé et l’API, les trois configurations TypeScript strictes, la vérification syntaxique de l’API, les tests unitaires/intégration, la validation de toutes les signatures, les builds séparés, les deux inventaires et les budgets Brotli. Le build échoue dès qu'un seuil est dépassé.

`npm run weight:ci` reproduit localement le gate Pull Request : build public minifié, compression gzip/Brotli, mesure, rapport JSON et comparaison bloquante aux budgets.

`npm run test:offline` demande Chrome ou Edge installé localement. Il lance un serveur et un profil navigateur temporaires, installe le Service Worker, coupe le serveur et le réseau émulé, puis vérifie le rechargement offline. Exécuter d'abord le build.

`npm run test:constrained` exécute les onze étapes critiques sous écran 320 × 568, CPU ralenti, 2G lente, pertes déterministes et stockage presque plein, puis contrôle tous les stockages après Panic Wipe. Ce test desktop ne remplace pas la [preuve sur Android physique](./docs/phase-16/android-field-checklist.md).

`npm run security:audit` valide le workflow de sécurité, les frontières privées, le lockfile et l’absence de clés privées versionnées, puis produit un verdict machine dans `reports/security-audit-report.json`. Un `PASS` local ne remplace ni un pentest indépendant ni les contrôles des origins finales.

`npm run governance:decision` valide la décision explicite du stakeholder, sa portée exacte sur les Phases 17 et 18, la couverture de chaque exigence et la divulgation des preuves absentes du workspace. Il produit le rapport effectif Phase 18 sans présenter la dérogation comme une vérification indépendante.

`npm run pilot:check -- …` contrôle le dossier d’admission Phase 18 : décision Phase 17 `GO`, six preuves externes fraîches liées par hash, périmètre d’une région/20–50 points, revues humaines, exercices de retrait et mesures agrégées sans tracking. Le [rapport de Phase 18](./docs/phase-18/README.md) documente le protocole ; l’exemple fourni est volontairement `NO_GO`.

`npm run release:hash` lie les octets exacts des deux distributions par une empreinte d’arbre déterministe. `npm run deployment:check -- …` recalcule ces empreintes et bloque la production sans pilote `GO`, origins distinctes, preuves live, sauvegarde, rollback et frontière publique `GET`/`HEAD`. Voir le [runbook de Phase 19](./docs/phase-19/README.md).

La cérémonie d'enrôlement bootstrap ([ADR-013](./docs/phase-19/adr-013-operator-store.md), section enrôlement) n'existe que si `HC_BOOTSTRAP_TOKEN_DIGEST_FILE` est fourni au service. L'identité de l'opérateur et ses habilitations viennent de la configuration, jamais de la requête : le client ne choisit ni qui il devient, ni ce qu'il obtient. L'usage unique est persisté dans le store, donc un redémarrage ne rouvre pas la fenêtre. La fenêtre est bornée à une heure au plus : au-delà, la cérémonie refuse de se construire, pour qu'une expiration lointaine ne transforme pas le mode bootstrap en porte permanente. La restriction par adresse est appliquée par le proxy, seul endroit où l'adresse du client est encore connue.

`npm run store:migrate -- …` migre les quatre anciens fichiers plats vers le store transactionnel décrit par [l'ADR-013](./docs/phase-19/adr-013-operator-store.md). La commande est **dry-run par défaut** : elle lit, valide, hashe chaque source et n'écrit qu'avec `--commit`, après avoir sauvegardé les originaux. `--rollback` restaure l'état antérieur et écarte la base sans la détruire.

`npm run store:backup -- …` prend une copie cohérente en ligne, sans arrêter le service, puis **rouvre la copie et la revalide** : une sauvegarde non vérifiée ne prouve rien. `npm run store:restore-proof -- …` restaure dans une base isolée, revalide toute la chaîne d'audit et compare le hash de tête au hash attendu.

`npm run security:check-deployment -- https://…/` contrôle sur l’origin publiée les en-têtes canoniques, l’absence de cookie, TLS 1.2/1.3, `GET`/`HEAD`, le rejet des méthodes de mutation et la redirection HTTP permanente vers HTTPS. Le fichier `dist/_headers` est directement utilisable seulement par les hébergeurs compatibles ; ailleurs, sa politique doit être transcrite dans la configuration du serveur ou du CDN.

`npm run privacy:check-deployment -- …` valide une preuve opérateur datée de moins de 90 jours contre [le contrat de minimisation des métadonnées](./config/public-deployment-privacy.requirements.json). Ce gate couvre la configuration déclarée de l’hébergeur/CDN/DNS ; il ne transforme pas une application Web en canal anonyme.

Le seul dossier public à déployer est `dist/`. `operator-portal/dist/` appartient exclusivement à l’origin privée et exige l’API, HTTPS, les en-têtes fournis et un registre de passkeys réellement provisionné. `operator-api/`, `docs/`, `flow.png`, `src/`, `scripts/`, `test/` et `reports/` ne sont jamais des assets publics.

## Documentation

- [Audit et threat model de Phase 0](./docs/phase-0/README.md)
- [Décisions d'architecture](./docs/phase-0/architecture.md)
- [Rapport de Phase 1](./docs/phase-1/README.md)
- [Rapport de Phase 2](./docs/phase-2/README.md)
- [Rapport de Phase 3](./docs/phase-3/README.md)
- [Rapport de Phase 4](./docs/phase-4/README.md)
- [Rapport de Phase 5](./docs/phase-5/README.md)
- [Rapport de Phase 6](./docs/phase-6/README.md)
- [Rapport de Phase 7](./docs/phase-7/README.md)
- [Rapport de Phase 8](./docs/phase-8/README.md)
- [Rapport de Phase 9](./docs/phase-9/README.md)
- [Rapport de Phase 10](./docs/phase-10/README.md)
- [Rapport de Phase 11](./docs/phase-11/README.md)
- [Rapport de Phase 12](./docs/phase-12/README.md)
- [Rapport de Phase 13](./docs/phase-13/README.md)
- [Rapport de Phase 14](./docs/phase-14/README.md)
- [Rapport de Phase 15](./docs/phase-15/README.md)
- [Rapport de Phase 16](./docs/phase-16/README.md)
- [Rapport de Phase 17](./docs/phase-17/README.md)
- [Préparation et gate d’admission de Phase 18](./docs/phase-18/README.md)
- [Préparation et gate de déploiement de Phase 19](./docs/phase-19/README.md)
- [ADR-013 — Store transactionnel du système opérateur](./docs/phase-19/adr-013-operator-store.md)

## Budgets bloquants

| Ensemble | Limite Brotli |
| --- | ---: |
| Transfert initial | 200 Ko |
| Core offline | 300 Ko |
| Plafond absolu | 500 Ko |
| JavaScript total | 80 Ko |
| CSS total | 30 Ko |
| Répertoire texte local | 20 Ko |
| Toutes les régions cartographiques optionnelles | 40 Ko |
| Plus gros chunk régional | 20 Ko |
| Protocole de mise à jour complet | 40 Ko |
| Plus gros micro-delta | 5 Ko |
| Clés publiques et enveloppes de signature | 20 Ko |
| Fiches de secours optionnelles, toutes langues | 150 Ko |
| Plus gros paquet de secours d'une langue | 50 Ko |

Le rapport machine courant est généré dans `reports/weight-report.json` à chaque build.
