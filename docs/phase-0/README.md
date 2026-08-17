# HELP CONNECT — Audit initial et sortie de Phase 0

Date de l'audit : 17 août 2026  
Périmètre : contenu complet du workspace `C:\HelpConnect`, `prompt.md`, `implementation plan.md` et `flow.png`.

## Résultat

HELP CONNECT est un projet **greenfield**. Le workspace ne contient encore aucune application exécutable. La Phase 0 fixe donc les invariants de sécurité et les frontières d'architecture avant toute création du socle PWA.

La Phase 0 produit trois documents de référence :

- [Threat model](./threat-model.md) : actifs, adversaires, frontières de confiance, menaces, contrôles et risques résiduels ;
- [Décisions d'architecture](./architecture.md) : séparation public/opérateurs, flux de données, stockage, offline, sécurité et décisions encore bloquantes ;
- [État du poids](./weight-baseline.md) : mesure reproductible de l'état actuel et budgets à automatiser en Phase 1.

## Audit complet de l'existant

| Domaine | État constaté | Conséquence |
| --- | --- | --- |
| Sources applicatives | Absentes | Aucun comportement existant à préserver ou à tester |
| Stack frontend/backend | Absente | La stack cible reste à créer en Phase 1 |
| Manifest PWA | Absent | L'application n'est pas installable |
| Service Worker / Cache API | Absents | Aucun fonctionnement offline |
| Dépendances / lockfile | Absents | Surface supply-chain actuelle nulle, mais non verrouillée pour la suite |
| Build / bundle / dossier de distribution | Absents | Aucun transfert initial ou core offline mesurable |
| Tests / lint / CI | Absents | Aucun garde-fou automatisé |
| Configuration HTTP | Absente | HTTPS, CSP et autres headers ne sont pas encore vérifiables |
| API / modèle de données | Absents | Fraîcheur, expiration et signature ne sont pas implémentées |
| Portail opérateurs | Absent | Il doit rester un système et un origin distincts |
| Secrets frontend | Aucun constaté | Aucun code frontend n'existe encore |
| Contrôle de version | `C:\HelpConnect` n'est pas un dépôt Git | Traçabilité des changements non disponible |

Versions d'outils disponibles au moment de l'audit : Node.js 22.20.0, npm 10.9.3 et Python 3.13.11. Ce constat ne choisit pas encore un gestionnaire de paquets ni un outil de build.

## Lecture fonctionnelle du wireframe

`flow.png` définit les écrans et flux à conserver lors des phases UI :

- navigation basse à quatre entrées : Accueil, Carte, Fiches et Recherche ;
- Accueil avec paramètres, recherche, recherches récentes, catégories de secours, carte de survie et Panic Wipe ;
- Carte avec recherche, catégories, vue cartographique, vraie vue texte, légende et micro-mise à jour ;
- Fiches avec recherche locale, catégories, téléchargement explicite et détail par étapes ;
- Recherche avec historique temporaire et suggestions ;
- Paramètres avec langue, disponibilité de Panic Wipe et thème clair/sombre ;
- Panic Wipe accessible depuis les écrans critiques.

Le wireframe est une référence de flux, pas un asset de production : son bitmap de plus de 1 Mo ne doit pas être livré dans la PWA.

## Écarts entre l'existant et la cible

Tous les éléments applicatifs décrits par le plan restent à construire. Les écarts les plus critiques sont :

1. aucune séparation déployée entre PWA publique et administration ;
2. aucune chaîne de publication validant puis signant les données publiques ;
3. aucun modèle de fraîcheur (`verified_at`, `expires_at`, statut et révision) ;
4. aucun socle offline ni politique de cache/purge ;
5. aucun contrôle automatisé des budgets de poids ;
6. aucun mécanisme de recherche locale, de mode texte ou de fiches offline ;
7. aucun Panic Wipe best-effort et aucune explication de ses limites ;
8. aucun hardening de livraison ou test sur appareil/réseau contraint.

## Ordre d'exécution retenu

L'ordre du plan est conservé : socle et budgets, shell/navigation, fiches offline, recherche/mode texte, carte légère, micro-updates, données/portail, intégrité, Panic Wipe, hardening, tests terrain puis déploiement. Les contrôles de sécurité, de stockage et de poids définis ici sont transverses et devront être vérifiés à chaque phase, pas reportés à leur chapitre final.

La prochaine intervention autorisée est uniquement la **Phase 1 — socle ultra-léger et contrôle automatique du poids**. Aucun fichier applicatif de Phase 1 n'a été créé pendant cet audit.

## Critères de sortie de Phase 0

- [x] inventaire complet du workspace et de la stack actuelle ;
- [x] fonctionnement PWA/offline actuel constaté ;
- [x] dépendances, build, poids et risques de sécurité actuels constatés ;
- [x] flux du wireframe intégrés aux contraintes d'architecture ;
- [x] actifs, adversaires, frontières de confiance et registre des menaces documentés ;
- [x] classification du stockage et invariants de sécurité acceptés comme décisions cibles ;
- [x] séparation PWA publique / portail opérateurs décidée ;
- [x] budgets de poids et méthode de mesure de Phase 1 définis ;
- [ ] décisions terrain listées dans la section « Gates humains » de l'architecture à faire valider avant publication de données réelles.

## Références de contrôle

- [OWASP — Testing Browser Storage](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/12-Testing_Browser_Storage)
- [OWASP — Secure Headers Project](https://owasp.org/www-project-secure-headers/)
- [W3C — Service Workers](https://www.w3.org/TR/service-workers/)

