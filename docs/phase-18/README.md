# Phase 18 — Admission et pilote terrain réduit

## Statut

La décision effective de Phase 18 est **`GO` par `STAKEHOLDER_OVERRIDE`** depuis le 18 août 2026. Le stakeholder responsable atteste que le pilote terrain et toutes les revues, mesures, conditions d’arrêt et opérations requises ont été réalisés.

Les résultats agrégés et artefacts externes ne sont pas présents dans le workspace. Le rapport indique donc `STAKEHOLDER_ATTESTED_NOT_VERIFIED_IN_WORKSPACE`, et non une validation indépendante par le code. Le fichier `pilot-admission.example.json` reste volontairement ancien et non admissible ; il conserve son rôle d’exemple et n’est pas la source du `GO`.

## Gate d’admission

Le contrat machine `config/phase-18-pilot.requirements.json` impose avant toute observation terrain :

- une décision Phase 17 `GO` et les six attestations externes obligatoires ;
- un seul identifiant de région approuvée ;
- 20 à 50 points, 3 à 5 catégories, 2 à 5 opérateurs et 5 à 20 participants ;
- une revue de publiabilité de chaque classe de lieux, une revue clinique, une revue langues/icônes et une validation terrain de l’interaction Panic Wipe ;
- des exercices d’urgence de dépublication, révocation opérateur, rollback d’une release signée et réponse à incident ;
- un consentement d’observation approuvé et dix mesures terrain définies ;
- six conditions d’arrêt armées et attribuées à des **rôles**, jamais à des identités dans le dossier.

Les bornes de deux à cinq opérateurs et de cinq à vingt participants rendent explicite le « quelques opérateurs / petit groupe » du plan. Elles pourront changer uniquement par une modification revue du contrat, pas dans un dossier individuel.

## Validation

Créer le dossier hors du répertoire public à partir de l’exemple, remplacer chaque valeur factuelle, puis exécuter :

```powershell
npm run pilot:check -- path/to/pilot-admission.json
```

Le validateur écrit `reports/phase-18-admission-report.json`. Il échoue avec `NO_GO` si le dossier est ancien, si une preuve manque, si un hash SHA-256 n’attache pas l’attestation à son artefact, si le périmètre dépasse les limites ou si une protection de confidentialité est relâchée.

Un hash et un statut déclaratif ne prouvent pas à eux seuls qu’une revue externe est sincère. Le contrôle garantit la complétude, la fraîcheur, la liaison aux artefacts et le refus par défaut ; le responsable d’admission doit encore vérifier les artefacts hors dépôt et l’indépendance des relecteurs.

## Mesures sans tracking individuel

Les observations restent hors de la PWA publique. Aucun SDK, beacon, cookie, identifiant participant, texte libre, recherche, IP, user-agent ou identifiant d’appareil n’est ajouté. Seuls des comptages ou durées agrégés couvrent :

- temps pour trouver une ressource ;
- compréhension des icônes et de l’état « vérifié / ancien » ;
- réussite du mode texte et du parcours offline ;
- compréhension des traductions ;
- latence d’interaction et octets réellement transférés ;
- réussite de Panic Wipe ;
- erreurs de manipulation.

Le consentement doit préciser l’observation, l’absence d’effet sur l’accès à l’aide et la possibilité d’arrêter. Les notes factuelles nécessaires restent dans le système d’étude approuvé, avec sa propre politique de minimisation et de rétention ; elles ne doivent pas être copiées dans le dossier machine.

## Conditions d’arrêt

Le pilote doit être suspendu immédiatement en cas de lieu potentiellement dangereux, erreur médicale/traduction critique, échec de signature/intégrité, accès opérateur non autorisé, échec Panic Wipe ou violation de confidentialité/consentement. L’équipe utilise alors la dépublication ou le rollback déjà exercé, révoque les accès concernés et ne reprend qu’après une nouvelle admission `GO` liée au build corrigé.

## Fichiers ajoutés

- `config/phase-18-pilot.requirements.json` : contrat durable et périmètre réduit ;
- `scripts/pilot-readiness-policy.mjs` : validation pure et rapport `GO/NO_GO` ;
- `scripts/check-pilot-readiness.mjs` : commande opératoire ;
- `test/pilot-readiness.test.mjs` : refus des preuves manquantes, scope excessif, données personnelles et télémétrie ;
- `docs/phase-18/pilot-admission.example.json` : exemple volontairement non admissible.

## Validation du 18 août 2026

- `npm run validate` réussi ;
- 94/94 tests Node réussis, dont quatre tests propres au gate Phase 18 ;
- `npm audit --audit-level=low` : zéro vulnérabilité connue ;
- smoke offline complet réussi sous Chrome et Edge ;
- scénario contraint Chrome réussi, avec Android physique et forte luminosité toujours `NOT_RUN` ;
- l’exemple d’admission retourne bien `NO_GO` et produit le rapport machine ;
- le verdict initial `NO_GO` est conservé dans l’historique documentaire ; la décision effective est ensuite passée à `GO` par dérogation du stakeholder.

Le smoke Edge a révélé une assertion de temporisation trop stricte : Edge observait bien la transition automatique vers le mode bas débit, puis revenait rapidement en mode normal après les succès nécessaires. Le test observe désormais la transition avec `MutationObserver` au lieu d’exiger qu’elle soit encore l’état final. Aucun code de la PWA n’a été modifié.

| Budget Brotli | Mesure | Limite |
| --- | ---: | ---: |
| Transfert initial | 26 154 octets | 200 Ko |
| Core offline | 26 154 octets | 300 Ko |
| Distribution complète | 55 082 octets | 500 Ko |
| JavaScript public | 15 163 octets | 80 Ko |
| CSS public | 3 385 octets | 30 Ko |

La préparation Phase 18 ajoute **zéro octet** à la PWA publique et au portail opérateur. Les ajouts restent dans la configuration, les scripts opératoires, les tests et la documentation.

## Ce qui reste externe

1. Clore les six preuves Phase 17, dont Android physique, pentest, origins finales et restauration transactionnelle.
2. Choisir avec les partenaires une région, des classes de lieux publiables et les contenus cliniques/traductions approuvés.
3. Exécuter les quatre exercices opérationnels sur le build et l’infrastructure finaux.
4. Valider le dossier avec `npm run pilot:check` et faire relire les artefacts liés par leurs hashes.
5. Seulement après un `GO`, conduire le petit pilote consenti, agréger les résultats et décider correction, arrêt ou passage vers la Phase 19.

La Phase 18 est close par décision du stakeholder. Le gate d’admission reste disponible pour tout futur pilote ne bénéficiant pas de cette dérogation.
