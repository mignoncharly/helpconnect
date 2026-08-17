# Phase 16 — Tests appareils/réseau réels

## Résultat actuel

La couche reproductible de la matrice Phase 16 est implémentée et passe. Le parcours est exécuté dans un profil Chrome jetable avec écran 320 × 568, CPU ralenti ×6, deux cœurs logiques exposés, quota limité à 64 Kio de marge, latence de 1,2 seconde, débit 2G et 50 % de pertes déterministes sur les ressources de mise à jour.

Le résultat global reste volontairement `PASS_WITH_PHYSICAL_GAPS` : aucun téléphone Android physique n’est connecté à cet environnement et la forte luminosité ne peut pas être validée fidèlement en headless. La Phase 16 n’est donc pas déclarée entièrement terminée et aucun travail de Phase 17 n’a commencé.

Chrome précise que Device Mode fournit une approximation de premier ordre et ne remplace pas un test sur appareil réel : [Simulate mobile devices with Device Mode](https://developer.chrome.com/docs/devtools/device-mode/). Les contraintes utilisent les domaines officiels du Chrome DevTools Protocol pour le [réseau](https://chromedevtools.github.io/devtools-protocol/tot/Network/), le [stockage](https://chromedevtools.github.io/devtools-protocol/tot/Storage/) et l’[émulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/).

## Parcours automatisé

`npm run test:constrained` reconstruit une preuve navigateur sans collecter de donnée personnelle :

1. charge la PWA et attend le contrôle du Service Worker ;
2. traverse anglais, ourdou RTL puis français et active le thème sombre ;
3. installe explicitement la région et les fiches de secours ;
4. applique la pression de stockage puis coupe entièrement le réseau ;
5. ferme Chrome et le rouvre avec le même profil, toujours hors ligne ;
6. recherche « hôpital », ouvre une fiche de secours et active le mode texte ;
7. rétablit un réseau 2G très lent ;
8. détruit la première requête de chacun des six artefacts du delta signé, soit 50 % de pertes déterministes ;
9. vérifie la reconstruction signée de la version 3 ;
10. déclenche Panic Wipe ;
11. exige `about:blank`, zéro cache, zéro base IndexedDB, zéro entrée LocalStorage/SessionStorage et la désinscription du Service Worker.

Le rapport machine local est écrit dans `reports/phase-16-evidence.json`. Il est ignoré par Git car il décrit une exécution locale ; le contrat durable est versionné dans `scripts/constrained-matrix.mjs` et testé dans `test/constrained-matrix.test.mjs`.

## Matrice constatée

| Condition | Preuve | Statut |
| --- | --- | --- |
| Android entrée de gamme | appareil physique requis | `NOT_RUN` |
| RAM faible | AVD ou appareil physique requis | `NOT_RUN` |
| CPU faible | ralentissement CPU ×6 | `PASS_SIMULATED` |
| 2G simulée | 51,2/25,6 kbit/s | `PASS_SIMULATED` |
| Latence 1–3 s | 1 200 ms | `PASS_SIMULATED` |
| Pertes élevées | 6 requêtes interrompues sur 12 premières tentatives d’update | `PASS_SIMULATED` |
| Internet intermittent | échecs déterministes puis retry minimal | `PASS_SIMULATED` |
| Internet coupé | fermeture et réouverture totalement offline | `PASS_SIMULATED` |
| JavaScript lent | CPU ×6 | `PASS_SIMULATED` |
| Stockage presque plein | quota = usage + 64 Kio | `PASS_SIMULATED` |
| Petit écran | 320 × 568, sans débordement horizontal | `PASS_SIMULATED` |
| Forte luminosité | appareil physique requis | `NOT_RUN` |
| Thème sombre | état DOM vérifié | `PASS_SIMULATED` |
| Toutes les langues | `en`, `ur` RTL, `fr` | `PASS_SIMULATED` |

## Fichiers principaux

- `scripts/constrained-matrix.mjs` : profil, matrice et ordre immuable des onze étapes ;
- `scripts/constrained-smoke.mjs` : serveur local audité et orchestration Chrome via CDP ;
- `test/constrained-matrix.test.mjs` : couverture de la matrice et rejet des profils affaiblis ;
- `docs/phase-16/android-field-checklist.md` : protocole de clôture sur téléphone physique ;
- `package.json` : commande `test:constrained`.

## Sécurité et confidentialité

- profil navigateur créé dans le répertoire temporaire puis supprimé ;
- serveur lié uniquement à `127.0.0.1` et limité à l’inventaire public du build ;
- aucun identifiant d’appareil, GPS, adresse IP distante, analytics ou texte utilisateur transmis ;
- signatures et comparaison finale du snapshot restent obligatoires sous pertes réseau ;
- Panic Wipe est vérifié après la contrainte de stockage et la mise à jour ;
- le rapport distingue `PASS_SIMULATED`, `NOT_RUN` et preuve physique, sans promotion implicite.

## Validation exécutée

- 86/86 tests Node réussis, dont trois tests nouveaux de contrat Phase 16 ;
- `npm run validate` réussi : lint, politique CI, trois typechecks, contrôle API, tests, signatures, inventaires, privacy, caches et builds ;
- scénario contraint Chrome réussi dans l’ordre complet ;
- smoke offline historique réussi dans Edge avec adaptation réseau, compartiments, cache altéré, recherche locale, deltas signés et Panic Wipe ;
- les six premières requêtes ciblées ont été interrompues et récupérées ;
- delta signé reçu jusqu’à la version 3 ;
- zéro stockage contrôlable et zéro Service Worker après Panic Wipe.

| Budget Brotli | Mesure | Limite |
| --- | ---: | ---: |
| Transfert initial | 26 154 octets | 200 Ko |
| Core offline | 26 154 octets | 300 Ko |
| Distribution complète | 55 082 octets | 500 Ko |
| JavaScript total | 15 163 octets | 80 Ko |
| CSS total | 3 385 octets | 30 Ko |

La Phase 16 n’ajoute aucun octet au runtime public. La seule modification du smoke historique attend désormais la stabilisation simultanée du cache et de l’interface après suppression d’une fiche, ce qui retire une course du test sans modifier la PWA.

## Blocage terrain et arrêt de phase

L’AVD Android 34 présent sur la machine n’a pas fourni de session ADB exploitable pendant cette phase et aucun téléphone physique n’est connecté. Ni cet AVD, ni Chrome desktop ne peuvent prouver la lisibilité en forte luminosité ou le comportement d’un véritable appareil Android d’entrée de gamme.

La [fiche terrain Android](./android-field-checklist.md) doit être exécutée sur l’appareil cible. Jusqu’à cette preuve, la Phase 16 reste partiellement validée et la Phase 17 — audit sécurité avant pilote — ne doit pas commencer.
