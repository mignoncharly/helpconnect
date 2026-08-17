# Phase 13 — PWA offline et stratégie de cache

## Résultat

Le stockage offline est désormais compartimenté, borné et contrôlable par l’utilisateur. Une ressource ne peut entrer dans CacheStorage que si elle appartient à une allow-list de build et, pour les régions ou fiches de secours, après une action explicite précédée de l’avertissement existant.

Les noms, préfixes et fichiers internes sont centralisés dans `shared/cache-policy.js`. Le build échoue si deux catégories se chevauchent, si un chemin contient une query, si une donnée optionnelle entre dans le shell ou si un snapshot/delta de mise à jour devient automatiquement persistant.

## Compartiments

| Compartiment | Contenu autorisé | Création et durée |
| --- | --- | --- |
| `hc-shell-<hash>` | HTML, CSS, JavaScript, manifeste, SVG, dictionnaires chargés, répertoire/bootstrap/trust minimaux signés | installé avec le Service Worker ; ancienne version supprimée à l’activation |
| `hc-data-v1` | état anti-rejeu et régions explicitement choisies | créé pour l’intégrité ; région ajoutée uniquement après consentement, suppression individuelle possible |
| `hc-first-aid-v1` | paquet JSON signé d’une ou plusieurs langues choisies | créé uniquement après consentement ; supprimé lorsque sa dernière entrée est retirée |
| jamais mis en cache | recherches, historique, navigation, position, profil, données personnelles, manifeste de mise à jour, micro-deltas et snapshots réseau | aucune écriture autorisée |

Le répertoire texte, le bootstrap et la chaîne de confiance restent dans le core versionné afin que le parcours minimal et la vérification cryptographique fonctionnent dès le premier lancement offline. Aucune région ni fiche médicale n’entre dans ce core.

Les micro-deltas et snapshots sont récupérés avec `no-store`, vérifiés, puis seul le résultat final signé est promu sous l’URL allow-listée de la région. Les requêtes intermédiaires ne deviennent jamais des entrées CacheStorage.

## Installation et suppression

Les écrans carte et premiers secours exposent désormais deux états mutuellement exclusifs :

- « Enregistrer » lorsque le paquet n’est pas présent ;
- « Supprimer » lorsque le paquet signé est réellement disponible.

La suppression est immédiate et ne demande pas de confirmation, puisqu’elle réduit les traces. Elle passe par le Service Worker, qui refuse toute URL hors allow-list. Après suppression :

- les références RAM et la carte rendue sont vidées ;
- les fiches de la langue concernée ne sont plus ouvrables offline ;
- un cache médical devenu vide est supprimé ;
- les compteurs anti-rejeu restent conservés.

Conserver l’état anti-rejeu empêche qu’une suppression suivie d’une réinstallation réintroduise une ancienne version. Si la région avait déjà atteint la version 3, la réinstallation récupère et vérifie le snapshot courant signé au lieu d’accepter la version 1 de base.

## Migration et nettoyage

À l’activation, le Service Worker :

1. migre les anciennes entrées régionales ou médicales éventuellement présentes dans un ancien shell ;
2. déplace les fiches historiquement stockées dans `hc-data-v1` vers `hc-first-aid-v1` ;
3. supprime toute entrée inconnue ou privée de ses métadonnées de signature ;
4. supprime les anciennes versions du cache médical et les anciens shells ;
5. conserve uniquement l’état d’intégrité et les régions allow-listées dans le cache de données.

Une région ou fiche relue depuis le cache est vérifiée cryptographiquement avant décodage. Si l’enveloppe est altérée, expirée, révoquée ou incompatible, l’entrée exacte est supprimée au lieu de rester comme trace inutilisable. Un cache médical vide après cette éviction est également supprimé.

## Bornes de stockage

HELP CONNECT ne demande pas la permission de stockage persistant et n’utilise pas `navigator.storage.persist()`. Les caches restent donc best effort et peuvent être évincés par le navigateur sous pression. Le [Storage Standard](https://storage.spec.whatwg.org/) prévoit précisément cette possibilité pour les buckets best effort.

La borne ne dépend pas d’une estimation de quota potentiellement fingerprintable :

- 2 URLs régionales maximales, 30 000 octets chacune ;
- 3 paquets de premiers secours maximaux, 60 000 octets chacun ;
- un état d’intégrité de 12 000 octets maximum ;
- listes du shell et des locales finies au build ;
- aucun cache générique de réponse ou de navigation.

Les objets Cache ne s’expirent pas automatiquement lors d’une mise à jour du Service Worker ; leur versionnement et leur suppression doivent être gérés par l’application, conformément à la [spécification Service Workers](https://www.w3.org/TR/service-workers/). C’est pourquoi le hash du shell, la migration et l’éviction explicite sont des invariants testés.

## Fichiers principaux

- `shared/cache-policy.js` et `.d.ts` : noms et ownership des caches publics ;
- `src/sw.ts` : migration, validation des compartiments, stockage et suppression allow-listés ;
- `src/app.ts` : lectures nommées, éviction des entrées invalides, commandes de suppression et réinstallation sans rollback ;
- `src/index.html`, `public/i18n/*.json` : contrôles de suppression français, anglais et ourdou ;
- `scripts/validate-cache-policy.mjs` : gate de build des quatre politiques ;
- `test/cache-policy.test.mjs` : disjonction, ownership et liste « jamais » ;
- `scripts/offline-smoke.mjs` : preuve navigateur du cycle complet.

## Validation

- 73/73 tests Node réussis, dont 3 nouveaux tests de politique de cache ;
- lint, trois typechecks TypeScript stricts et vérification API réussis ;
- builds, signatures, inventaires, privacy et politique de cache réussis ;
- smoke test Edge en ligne/hors ligne réussi ;
- cache médical absent avant consentement puis créé après installation ;
- région et langue ourdoue dans deux compartiments distincts ;
- suppression individuelle, disparition du cache médical vide et réinstallation réussies ;
- réinstallation régionale en version 3 sans rollback vers la version 1 ;
- entrée régionale altérée refusée, non rendue puis supprimée du cache ;
- recherches toujours absentes de CacheStorage et des requêtes ;
- Panic Wipe supprime toujours tous les compartiments et la registration.

## Poids

| Budget | Mesure Brotli | Limite |
| --- | ---: | ---: |
| Transfert initial | 25 404 octets | 200 Ko |
| Core offline | 25 404 octets | 300 Ko |
| Distribution complète | 54 332 octets | 500 Ko |
| JavaScript total | 14 413 octets | 80 Ko |
| CSS total | 3 385 octets | 30 Ko |

La compartimentation, les suppressions et leurs traductions ajoutent 793 octets Brotli au core et 1 007 octets à la distribution complète par rapport à la Phase 12.

## Limites restantes

- le navigateur peut évincer tout le bucket best effort ; HELP CONNECT ne peut promettre la disponibilité offline après pression de stockage ou nettoyage utilisateur ;
- CacheStorage ne fournit pas d’effacement physique garanti du support ;
- un fichier HTML déjà exporté reste hors des compartiments et doit être supprimé depuis le système ;
- les limites de taille et d’entrées protègent le produit, mais le quota total de l’origin dépend toujours du navigateur ;
- la stratégie d’adaptation aux échecs réseau appartient à la Phase 14.

## Arrêt de phase

La Phase 13 est terminée. Aucun travail propre à la Phase 14 — adaptation réseau pilotée par les requêtes — n’a été commencé dans cette phase.
