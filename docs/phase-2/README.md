# HELP CONNECT — Sortie de Phase 2

Date : 17 août 2026  
Statut : terminée ; aucune fiche médicale réelle de Phase 3 incluse.

## État trouvé

La Phase 1 fournissait une PWA technique installable et offline de 1 811 octets Brotli, mais seulement une page d'état. Aucun écran, flux du wireframe, navigation, paramètre, thème ou dictionnaire de langue n'existait.

## Implémentation du wireframe

Le shell mobile contient désormais :

- navigation basse Accueil, Carte, Fiches et Recherche avec état actif ;
- Accueil avec logo, Paramètres, recherche, historique temporaire, accès rapide aux catégories, carte de survie et PW ;
- squelette Carte avec recherche, catégories, bouton Mode texte, légende, mise à jour et PW ;
- squelette Fiches avec recherche, catégories, cartes, téléchargement et PW ;
- écran Recherche avec suggestions et historique en RAM ;
- Paramètres avec langue, état Panic Wipe et thème clair/sombre ;
- boutons retour et gestion du focus des titres lors des changements d'écran.

La navigation est entièrement en mémoire : elle n'ajoute aucun fragment, chemin ou terme sensible à l'URL. Les quatre routes principales ont été testées dans un vrai navigateur.

Les fonctionnalités des phases ultérieures ne simulent pas une fausse sécurité :

- PW affiche « Prototype non protecteur — activation prévue en Phase 10 » ;
- aucune fausse carte ou fausse localisation n'est affichée ;
- aucune instruction médicale non validée n'est fournie ;
- recherche, téléchargement, mise à jour et Mode texte annoncent leur phase au lieu de prétendre fonctionner.

## État sensible et paramètres

| Donnée | Stockage | Comportement vérifié |
| --- | --- | --- |
| Recherche courante | DOM/RAM | jamais dans l'URL, cookie, storage ou cache |
| Historique récent | RAM, quatre entrées maximum | disparu après rechargement offline |
| Langue | `sessionStorage`, clé `hc:locale` | limitée à l'onglet |
| Thème | `sessionStorage`, clé `hc:theme` | limitée à l'onglet |
| Localisation | aucune | aucune API ou permission demandée |

Les champs de recherche n'ont volontairement pas d'attribut `name`, désactivent l'autocomplétion et leur soumission est interceptée sans navigation réseau.

## I18n légère

Le français complet reste présent dans le HTML et ne provoque aucune requête de dictionnaire au premier affichage. English et Urdu sont chargés uniquement après sélection ou restauration de la session. Les dictionnaires same-origin sont ensuite disponibles offline via une liste fermée du Service Worker.

Chaque dictionnaire doit contenir exactement les 65 clés du contrat UI, uniquement des chaînes non vides et bornées. Les valeurs sont injectées avec `textContent` ou des attributs ciblés, jamais comme HTML. Urdu bascule `lang="ur"` et `dir="rtl"`, y compris l'orientation du bouton retour.

Français, English et Urdu restent des **langues de prototype**. La terminologie, les traductions urdu, le sens RTL et les pictogrammes doivent être revus avec des locuteurs et utilisateurs terrain avant pilote.

## Offline et stratégie d'assets

Le core précache six assets : HTML, CSS, JavaScript, manifest, logo et sprite SVG local. Les trois JSON de langue sont optionnels et exclus du transfert initial/core. Le hash de cache couvre malgré tout le core et les langues, de sorte qu'une modification d'un dictionnaire invalide correctement l'ancienne version.

Le Service Worker n'accepte le cache runtime que pour les trois chemins i18n déclarés. Il ne met toujours en cache aucune recherche ni requête générique.

## Résultat de poids

Mesure : Brotli qualité 11, Gzip niveau 9, `1 Ko = 1024 octets`.

| Ensemble | Phase 1 | Phase 2 | Limite | Résultat |
| --- | ---: | ---: | ---: | --- |
| Transfert initial Brotli | 1 811 o | 8 193 o | 204 800 o | PASS |
| Core offline Brotli | 1 811 o | 8 193 o | 307 200 o | PASS |
| Tous assets Brotli | 1 811 o | 11 264 o | 512 000 o | PASS |
| JavaScript Brotli | 660 o | 2 283 o | 81 920 o | PASS |
| CSS Brotli | 283 o | 2 398 o | 30 720 o | PASS |

Tous les fichiers produits représentent 43 973 octets bruts, 13 315 octets Gzip et 11 264 octets Brotli. Les trois langues optionnelles représentent ensemble 3 071 octets Brotli. `flow.png`, la documentation, les tests et la capture de contrôle visuel restent hors de `dist/`.

## Sécurité et accessibilité vérifiées

- aucune dépendance runtime, URL externe, source map ou asset inattendu ;
- CSP restrictive conservée ;
- zéro cookie, `localStorage`, IndexedDB, géolocalisation, analytics ou télémétrie ;
- recherche témoin « sensitive sample » absente de `sessionStorage` et CacheStorage ;
- seules les clés `hc:locale` et `hc:theme` existent en session ;
- HTML français complet en repli, cinq titres d'écran, aucun ID dupliqué ;
- aucun bouton/input sans nom accessible détecté dans Chromium ;
- quatre destinations de navigation et état `aria-current` testés ;
- cibles interactives principales d'au moins 44 px et focus clavier visible ;
- thème sombre et sens RTL vérifiés fonctionnellement.

## Vérifications exécutées

- `npm run lint` : PASS ;
- `npm run typecheck` : PASS ;
- `npm test` : 13/13 PASS, dont contrat exact des trois dictionnaires ;
- `npm run build` : PASS avec cinq budgets bloquants ;
- deux builds consécutifs : hashes SHA-256 identiques ;
- `npm audit --audit-level=moderate` : 0 vulnérabilité ;
- `npm run test:offline` : PASS dans Chrome à 390×844 ;
- rechargement avec serveur arrêté et réseau offline : PASS en urdu/RTL/thème sombre ;
- nettoyage du profil navigateur temporaire : PASS.

Une capture générée par le smoke test est disponible localement dans `reports/ui-home.png` et reste exclue du build.

## Fichiers principaux modifiés

- `src/index.html` : écrans statiques et fallback français ;
- `src/styles.css` : shell mobile, thèmes, RTL, focus et composants du wireframe ;
- `src/app.ts` : navigation, état RAM, paramètres session et chargement i18n ;
- `src/sw.ts` : cache runtime strict des langues ;
- `public/ui-icons.svg` : sprite local sans bibliothèque ;
- `public/i18n/*.json` : français, anglais et urdu ;
- `scripts/build-config.mjs`, `scripts/build.mjs`, `scripts/file-inventory.mjs` : assets imbriqués et groupes core/optionnels ;
- `scripts/offline-smoke.mjs` et `test/i18n.test.mjs` : contrôles UI, confidentialité, RTL et langues.

## Ce qui reste pour la Phase 3

- définir la gouvernance clinique, la source et la version des contenus ;
- créer de vraies fiches statiques sans requête réseau ni JavaScript inutile ;
- permettre sélection, lecture et téléchargement offline explicite ;
- afficher l'avertissement qu'un fichier exporté hors navigateur ne peut pas être supprimé par Panic Wipe ;
- ajouter tests offline par fiche, validation de contenu/langue et budgets optionnels propres ;
- ne publier aucune instruction réelle avant revue clinique et traduction terrain.

La Phase 3 ne doit commencer qu'après instruction explicite.
