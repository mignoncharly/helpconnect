# HELP CONNECT — Baseline de poids avant Phase 1

Date de mesure : 17 août 2026.

## Conclusion

Il n'existe actuellement **aucune PWA et aucun build**. Les poids « transfert initial » et « core offline » sont donc **non applicables**, et non « conformes à 0 Ko ». Aucun succès de budget ne peut être revendiqué avant qu'un artefact de distribution existe.

| Mesure produit | Valeur actuelle | Statut |
| --- | ---: | --- |
| Transfert initial compressé | N/A | Pas de build |
| Core PWA offline compressé | N/A | Pas de Service Worker/precache |
| JavaScript application | N/A | Aucun JavaScript |
| CSS | N/A | Aucun CSS |
| HTML de production | N/A | Aucun HTML |
| Manifest/icônes | N/A | Absents |
| Dépendances runtime | 0 déclarée | Aucun manifest de dépendances |

## Inventaire des seuls fichiers présents

Ces fichiers sont des entrées de conception, **pas des assets déployables** :

| Fichier | Octets bruts |
| --- | ---: |
| `flow.png` | 1 147 330 |
| `implementation plan.md` | 28 747 |
| `prompt.md` | 2 734 |
| Total workspace initial | 1 178 811 |

`flow.png` dépasse à lui seul le plafond absolu de 500 Ko. Il doit rester dans la documentation et l'interface doit être reconstruite avec HTML/CSS/SVG optimisé ; le bitmap ne doit jamais être copié dans le build public.

## Budgets contractuels pour le premier build

| Ensemble / type | Mesure | Limite |
| --- | --- | ---: |
| Transfert initial | somme des tailles Brotli des ressources requises au premier rendu | ≤ 200 Ko cible |
| Core offline | somme Brotli de l'intégralité du precache app-shell/bootstrap | ≤ 300 Ko bloquant |
| Plafond absolu | plus grand des ensembles initiaux/core définis | ≤ 500 Ko bloquant |
| JavaScript application | somme Brotli des JS chargés initialement | ≤ 80 Ko bloquant |
| CSS | somme Brotli des CSS chargées initialement | ≤ 30 Ko bloquant |

Les budgets portent sur la taille transférée en Brotli parce que le serveur devra le proposer. Le rapport devra aussi afficher octets bruts et Gzip pour diagnostiquer les hébergements sans Brotli. Les seuils sont évalués en octets avec `1 Ko = 1024 octets`.

## Règles de comptage à automatiser en Phase 1

1. Construire dans un dossier de distribution propre.
2. Refuser source maps, fichiers inattendus et liens vers des assets externes.
3. Lister chaque asset avec taille brute, Gzip et Brotli déterministes.
4. Calculer séparément l'ensemble du premier rendu et la liste exacte de precache du Service Worker.
5. Dédupliquer un asset référencé plusieurs fois dans un même ensemble.
6. Exclure les cartes régionales et fiches à la demande de l'initial/core, mais publier leur poids dans une section optionnelle.
7. Échouer avec un code non nul au dépassement de n'importe quelle limite bloquante.
8. Échouer si le script ne peut pas déterminer l'ensemble initial ou le precache ; une mesure incomplète ne passe pas.

Le script de budget sera versionné localement, sans service SaaS, et exécuté par la commande de build ainsi que par la CI. Le test doit couvrir au minimum un fixture qui passe et un fixture qui dépasse chaque seuil.

## Commandes de reproduction de l'état actuel

Depuis `C:\HelpConnect` :

```powershell
rg --files -uu
Get-ChildItem -File | Select-Object Name, Length
```

Résultat attendu pour cette baseline : seulement `prompt.md`, `implementation plan.md` et `flow.png`, sans `package.json`, lockfile, manifest PWA, Service Worker ni dossier de distribution.

## Impact de la Phase 0

La Phase 0 ajoute uniquement de la documentation dans `docs/phase-0/`. Son impact sur le transfert initial et le core offline est de **0 octet**, à condition que `docs/` et `flow.png` restent exclus du futur dossier de distribution.

## Condition d'entrée en Phase 2

La Phase 1 ne sera terminée que si un build reproductible génère un rapport réel, bloque les dépassements, prouve qu'aucun asset documentaire n'est livré et respecte les limites ci-dessus. Cette condition est désormais satisfaite et les mesures réelles sont consignées dans le [rapport de sortie de Phase 1](../phase-1/README.md).
