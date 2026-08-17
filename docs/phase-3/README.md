# HELP CONNECT — Sortie de Phase 3

Date : 17 août 2026  
Statut technique : terminée ; arrêt avant la Phase 4.  
Statut éditorial : **REVIEW_REQUIRED** — les fiches ne sont pas autorisées pour une publication ou un pilote terrain sans revue clinique et linguistique humaine.

## Résultat

La PWA propose maintenant quatre fiches de premiers secours en français, anglais et urdu :

- hémorragie sévère, y compris la réponse immédiate à une blessure pénétrante ;
- brûlure thermique ;
- personne inconsciente qui respire et position latérale de sécurité ;
- soins immédiats après une naissance inattendue, sans procédure obstétricale avancée.

Les catégories ouvrent une fiche structurée avec résumé, urgence, étapes, gestes à éviter, références et date de vérification de la source. Le rendu dynamique utilise uniquement `textContent` et des éléments DOM créés localement.

## Gouvernance clinique

Les contenus de travail ont été rapprochés de sources institutionnelles ou de premiers secours reconnues :

- [WHO–ICRC Basic Emergency Care](https://www.who.int/publications/i/item/basic-emergency-care-approach-to-the-acutely-ill-and-injured) ;
- [WHO Essential Newborn Care](https://www.who.int/teams/maternal-newborn-child-adolescent-health-and-ageing/newborn-health/essential-newborn-care) ;
- [IFRC International First Aid, Resuscitation and Education Guidelines 2025](https://www.ifrc.org/document/ifrc-international-first-aid-resuscitation-and-education-guidelines-2025) ;
- [St John Ambulance — severe bleeding](https://www.sja.org.uk/first-aid-advice/severe-bleeding/), [severe burns](https://www.sja.org.uk/first-aid-advice/severe-burn/) et [recovery position](https://www.sja.org.uk/first-aid-advice/recovery-position/).

Chaque bundle porte un identifiant de schéma, une révision, les références utilisées, `sourceCheckedAt`, un état éditorial et un champ d'expiration explicite. La Phase 3 conserve `status: REVIEW_REQUIRED` et `expiresAt: null` : elle n'invente ni validation clinique ni date d'expiration. Le schéma et les tests rejettent notamment une fausse valeur `APPROVED`.

Avant diffusion, un responsable clinique doit valider chaque instruction et définir une durée de validité/revue. Des locuteurs qualifiés doivent aussi revoir les traductions, surtout l'urdu, la terminologie d'urgence et le rendu RTL. Tant que cette porte n'est pas franchie, l'interface affiche clairement l'état **REVIEW_REQUIRED**.

## Installation et export hors ligne

Le paquet JSON d'une langue n'est ni précaché ni mis en cache par une navigation ordinaire. Son installation suit ce flux :

1. l'utilisateur choisit « Enregistrer hors ligne » ;
2. une fenêtre de consentement explique la persistance dans le cache du navigateur ;
3. la PWA récupère le chemin same-origin autorisé avec `cache: no-store` ;
4. le client vérifie taille, structure, révision, statut et quatre identifiants de fiche ;
5. le Service Worker refait des contrôles de chemin, type, taille et JSON avant stockage.

Un paquet validé reste lisible après arrêt du serveur et coupure réseau. Le Panic Wipe étant encore un marqueur non protecteur, l'avertissement précise qu'il ne peut actuellement pas effacer ce cache.

L'export est un fichier HTML autonome par langue : CSS intégré, aucun JavaScript, aucune requête réseau, aucun tracking et aucun lien externe. Avant l'export, un second consentement indique que le fichier reste dans les téléchargements du téléphone et qu'HELP CONNECT ne pourra pas le supprimer, même avec un futur Panic Wipe.

## Validation et défense en profondeur

- liste fermée de trois chemins JSON installables ;
- limite de 60 000 caractères côté client et Service Worker ;
- validation de schéma partagée au build et stricte au runtime ;
- quatre fiches et références cohérentes entre les trois langues ;
- aucun cache médical avant consentement ;
- exports autonomes contrôlés contre scripts, feuilles externes et liens réseau ;
- fenêtre modale accessible, fond rendu inerte, focus transféré puis restauré, fermeture par Échap ;
- recherche sensible toujours uniquement en RAM ; langue et thème toujours limités à la session.

## Poids

Mesure : Brotli qualité 11, Gzip niveau 9, `1 Ko = 1024 octets`.

| Ensemble | Phase 2 | Phase 3 | Limite | Résultat |
| --- | ---: | ---: | ---: | --- |
| Transfert initial Brotli | 8 193 o | 11 277 o | 204 800 o | PASS |
| Core offline Brotli | 8 193 o | 11 277 o | 307 200 o | PASS |
| Tous assets Brotli | 11 264 o | 31 888 o | 512 000 o | PASS |
| JavaScript Brotli | 2 283 o | 4 224 o | 81 920 o | PASS |
| CSS Brotli | 2 398 o | 2 714 o | 30 720 o | PASS |
| Fiches optionnelles, trois langues | — | 16 404 o | 153 600 o | PASS |
| Plus gros paquet médical d'une langue | — | 3 226 o | 51 200 o | PASS |

Les trois JSON médicaux et les trois exports HTML autonomes représentent 16 404 octets Brotli. Ils restent hors du transfert initial et du core précaché.

## Vérifications exécutées

- `npm run lint` : PASS ;
- `npm run typecheck` : PASS ;
- `npm test` : 20/20 PASS, dont schéma, alignement multilingue et rejet d'une fausse approbation ;
- `npm run build` : PASS avec sept budgets bloquants ;
- `npm run test:offline` : PASS dans Chrome, y compris consentement, installation urdu, lecture d'une fiche puis rechargement totalement offline ;
- absence de paquet médical avant consentement : PASS ;
- persistance offline du paquet choisi et disparition de la recherche RAM après rechargement : PASS ;
- deux builds consécutifs : 16/16 fichiers `dist` avec hashes SHA-256 identiques ;
- `npm audit --audit-level=moderate` : 0 vulnérabilité ;
- liens locaux des dix fichiers Markdown : aucun lien cassé ;
- génération d'une capture de la fiche dans `reports/ui-first-aid.png` : PASS.

## Fichiers principaux

- `public/first-aid/{fr,en,ur}.json` : bundles médicaux versionnés ;
- `scripts/first-aid-schema.mjs` : contrat et validation éditoriale ;
- `scripts/build-first-aid.mjs` : exports HTML autonomes ;
- `src/index.html`, `src/styles.css`, `src/app.ts` : liste, fiche, statuts et consentements ;
- `src/sw.ts` : installation explicite dans CacheStorage ;
- `scripts/offline-smoke.mjs` : scénario navigateur online/offline ;
- `test/first-aid.test.mjs` : cohérence des contenus et garde-fous ;
- `scripts/build-config.mjs`, `scripts/check-budget.mjs` : groupes d'assets et budgets dédiés.

## Suite volontairement non commencée

La Phase 4 devra ajouter la recherche locale dans les fiches et faire du mode 100 % texte une vue complète. Aucun index de recherche, filtrage de catégorie ou mode texte de Phase 4 n'a été amorcé ici.
