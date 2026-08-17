# Phase 12 — Privacy réseau et absence de télémétrie

## Résultat

La PWA publique ne contient aucun analytics, pixel, beacon, crash reporter distant, SDK tiers, identifiant applicatif ou endpoint de recherche. Le texte recherché reste dans la RAM du document et n’est intégré ni à une URL, ni à une requête, ni à un cache, ni à un stockage persistant.

La formulation de sécurité est volontairement limitée : HELP CONNECT minimise les métadonnées sous son contrôle, mais ne garantit pas un « anonymat total ». L’adresse IP reste visible lors du transport au réseau, au résolveur DNS, au point de terminaison TLS et à l’hébergeur ; le navigateur peut également transmettre des caractéristiques HTTP générales. La [RFC 9205](https://www.rfc-editor.org/rfc/rfc9205.html) identifie notamment l’IP, les cookies, les tickets TLS, `User-Agent` et `Accept-Language` comme des informations de session ou de fingerprinting possibles, tandis que la [RFC 7626](https://www.rfc-editor.org/info/rfc7626/) décrit les métadonnées observables au niveau DNS.

## Contrat réseau de la PWA

`shared/network-privacy.js` construit désormais toutes les requêtes explicites de la PWA et du Service Worker avec les invariants suivants :

- méthode `GET` uniquement ;
- origin et scope de l’application uniquement ;
- `credentials: omit` ;
- `referrerPolicy: no-referrer` ;
- `cache: no-store` pour le cache HTTP implicite ;
- `redirect: error` ;
- aucun userinfo, query string ou fragment dans une URL d’asset.

Le Service Worker utilise ces mêmes Request pour le precache et les fetch réseau. Une navigation contrôlée ne relaie jamais son URL ou sa query éventuelle : elle sert l’`index.html` propre du cache, ou récupère cette URL canonique si le shell manque. Les données restent stockées seulement par des écritures CacheStorage explicites et allow-listées.

Au démarrage, la PWA retire aussi query et fragment de l’entrée d’historique courante en best effort. Cela réduit les traces locales après chargement, mais ne peut pas retirer une query déjà observée pendant la toute première requête HTTP. Les URLs publiques ne doivent donc jamais transporter de recherche ou d’information sensible.

La politique `no-referrer` est définie à la fois par en-tête et meta ; selon la [spécification Referrer Policy](https://www.w3.org/TR/referrer-policy/), elle supprime entièrement le champ `Referer` des requêtes issues du document.

## Absence de télémétrie

Le lint public interdit :

- `sendBeacon`, `XMLHttpRequest`, WebSocket et EventSource ;
- les marqueurs analytics/télémétrie déjà interdits ;
- les principales API de fingerprinting matériel, média, WebRTC et génération d’identifiant ;
- les URLs externes, cookies, géolocalisation, LocalStorage et IndexedDB hors module de Panic Wipe.

La CSP de Phase 11 demeure une seconde barrière : `connect-src 'self'` et l’absence totale de tiers empêchent les connexions externes même si un appel échappait au lint.

Le build rejette également les paramètres de tracking connus, les formulaires capables de sérialiser une recherche, un manifeste avec query et les en-têtes de réponse capables d’activer client hints, reporting navigateur, Server-Timing, cookie ou ETag. Un ETag statique partagé n’est pas nécessairement identifiant, mais il est exclu ici puisque `no-store` rend sa fonction inutile et qu’un ETag personnalisé pourrait devenir un identifiant stable.

## Logs d’infrastructure

Le fichier `config/public-deployment-privacy.requirements.json` est le contrat minimal du déploiement public :

- aucun compte, cookie, device ID, GPS ou analytics applicatif ;
- aucune conservation de query, body, referrer, user-agent, cookie, identifiant de requête ou horodatage précis ;
- IP supprimée ou anonymisée à l’entrée avant stockage ;
- au maximum 24 heures de logs bruts ;
- seules des métriques agrégées comme tranche horaire grossière, classe de statut et résultat cache sont autorisées.

OWASP recommande de ne pas journaliser directement les identifiants de session et données personnelles/sensibles, et de ne pas conserver les logs au-delà de leur durée nécessaire : [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

Avant production, une preuve fournisseur doit être validée avec :

```powershell
npm run privacy:check-deployment -- path/to/privacy-evidence.json
```

Le validateur exige une origin HTTPS propre, une revue de moins de 90 jours, l’analytics CDN désactivé, la revue du fournisseur DNS, les champs sensibles éliminés et une rétention brute de 0 à 24 heures. Cette preuve est un gate opérationnel ; elle doit correspondre à la configuration effectivement appliquée et être revue après tout changement d’hébergeur, CDN, DNS ou proxy.

## Preuves automatisées

Le smoke test conserve, pour chaque requête reçue par son serveur local, uniquement la méthode, le chemin, la query et la présence éventuelle de cookie/referrer. Après une recherche française et une recherche ourdoue, il exige :

- uniquement des GET sur l’inventaire public ;
- zéro query ;
- zéro cookie et zéro referrer ;
- aucune occurrence brute ou encodée des recherches ;
- zéro origin tierce observée par le navigateur.

Les tests unitaires couvrent aussi les tentatives d’origin externe, sortie de scope, userinfo, query et fragment, ainsi que l’acceptation/refus des preuves de déploiement.

## Fichiers principaux

- `shared/network-privacy.js` et `.d.ts` : constructeur de requêtes publiques et liste d’en-têtes interdits ;
- `src/app.ts`, `src/sw.ts` : fetch applicatifs et worker centralisés, URL courante minimisée ;
- `scripts/validate-privacy.mjs` : gate du runtime, des formulaires, du manifeste, des en-têtes et du contrat de logs ;
- `scripts/check-public-privacy-evidence.mjs` : validation de la preuve fournisseur ;
- `config/public-deployment-privacy.requirements.json` : exigences d’infrastructure ;
- `scripts/lint.mjs` : refus des transports et API de fingerprinting non autorisés ;
- `scripts/offline-smoke.mjs` : audit réseau réel autour des parcours sensibles ;
- `test/network-privacy.test.mjs` : tests du constructeur et des preuves.

## Validation

- 70/70 tests Node réussis, dont 4 tests réseau/privacy ;
- lint et trois typechecks TypeScript stricts réussis ;
- builds, inventaires, signatures et validation privacy réussis ;
- smoke test Edge en ligne/hors ligne réussi avec audit réseau sans query ;
- recherche française et ourdoue absente des requêtes et stockages persistants ;
- aucun cookie, referrer ou appel tiers observé ;
- cache signé altéré toujours refusé et Panic Wipe toujours fonctionnel.

## Poids

| Budget | Mesure Brotli | Limite |
| --- | ---: | ---: |
| Transfert initial | 24 611 octets | 200 Ko |
| Core offline | 24 611 octets | 300 Ko |
| Distribution complète | 53 325 octets | 500 Ko |
| JavaScript total | 13 722 octets | 80 Ko |
| CSS total | 3 385 octets | 30 Ko |

Le garde-fou réseau ajoute 580 octets Brotli au transfert initial et à la distribution complète par rapport à la Phase 11.

## Limites restantes

- aucune URL, configuration fournisseur ou preuve de production n’est présente dans le workspace ; le gate de déploiement n’a donc pas été exécuté contre une infrastructure réelle ;
- l’application ne peut empêcher les intermédiaires réseau de voir une connexion ou garantir leur conformité ;
- le premier chargement révèle nécessairement au serveur qu’un client demande HELP CONNECT ;
- une query déjà envoyée lors d’une toute première navigation peut exister dans des systèmes hors contrôle de la PWA ;
- les métriques agrégées autorisées nécessitent encore une revue juridique et terrain adaptée au pays du déploiement.

## Arrêt de phase

La Phase 12 est terminée. Aucun travail propre à la Phase 13 — PWA offline et stratégie de cache — n’a été commencé dans cette phase.
