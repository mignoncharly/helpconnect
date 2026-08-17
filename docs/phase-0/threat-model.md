# HELP CONNECT — Threat model v1

Statut : accepté comme baseline de conception, à réévaluer à chaque phase et avant le pilote.  
Méthode : analyse par actifs, adversaires, frontières de confiance et scénarios inspirés de STRIDE, complétée par les risques de sûreté physique propres à une zone de conflit.

## Objectifs de sécurité et de sûreté

Par ordre de priorité :

1. ne pas transformer une information publique en piège pour les personnes qui cherchent de l'aide ;
2. préserver l'intégrité, la provenance et la fraîcheur des points d'aide ;
3. minimiser les traces contrôlables laissées sur l'appareil et les métadonnées collectées par HELP CONNECT ;
4. maintenir un accès utile hors ligne et sur réseau/appareil très contraint ;
5. empêcher la PWA publique de devenir un chemin d'écriture vers les données ;
6. permettre une purge best-effort immédiate sans promesse d'effacement forensic.

La confidentialité de la carte publique n'est **pas** un objectif atteignable : tout acteur hostile peut consulter une ressource anonyme et publique. Seuls les lieux explicitement approuvés pour publication par les partenaires humanitaires peuvent être inclus.

## Actifs protégés

| Actif | Besoin dominant | Défaillance critique |
| --- | --- | --- |
| Vie et sécurité physique des utilisateurs | Sûreté, intégrité | Orientation vers un lieu faux, fermé, périmé ou devenu dangereux |
| Dataset public | Intégrité, authenticité, fraîcheur, disponibilité | Altération, rejeu ou publication non autorisée |
| Chaîne de validation humanitaire | Intégrité, traçabilité | Compte compromis publiant une information malveillante |
| Historique/requête de recherche | Confidentialité, minimisation | Découverte lors d'une saisie physique ou dans les logs |
| État offline et fiches médicales | Disponibilité, intégrité, purgeabilité documentée | Contenu indisponible, corrompu ou laissé sur l'appareil à l'insu de l'utilisateur |
| Clés de signature et credentials opérateurs | Confidentialité, intégrité | Falsification de datasets ou prise de contrôle de publication |
| App shell / Service Worker | Intégrité, disponibilité | Code persistant compromis ou cache empoisonné |
| Budget data/CPU/stockage | Disponibilité | Application inutilisable sur 2G ou téléphone ancien |

## Adversaires et défaillances prises en compte

- acteur hostile consultant la carte publique ou saisissant physiquement le téléphone ;
- attaquant réseau contrôlant un point Wi-Fi, le DNS ou tentant une interception ;
- opérateur autorisé compromis, coercé ou malveillant ;
- attaquant web exploitant XSS, injection DOM, dépendance compromise ou mauvaise configuration ;
- serveur, CDN, pipeline CI/CD ou clé de signature compromis ;
- éditeur publiant par erreur une donnée non validée ;
- panne, réseau intermittent, horloge appareil erronée, cache ancien, stockage plein ou appareil faible ;
- navigateur, OS ou gestionnaire de téléchargements conservant des traces hors du contrôle de la PWA.

Hors périmètre des garanties : effacement complet du téléphone, anonymat face à l'opérateur télécom/DNS/hébergeur, confidentialité d'une carte publique, disponibilité face à une coupure nationale totale sans installation/cache préalable.

## Flux et frontières de confiance

```text
[Partenaire terrain]
        |
        | données non publiées + authentification forte
        v
[Portail opérateurs : origin séparé] ---> [API admin + journal d'audit]
                                                |
                                                | validation / expiration
                                                v
                                      [Pipeline de publication]
                                                |
                                                | snapshot/delta signé
                                                v
[PWA publique en lecture seule] <---- [API/CDN public en lecture seule]
        |
        +--> RAM : requête + historique temporaire
        +--> Cache app : shell + données publiques approuvées
        +--> Téléchargement OS : fiche, seulement après action explicite
```

Frontières obligatoires : navigateur/public Internet ; origin public/origin opérateurs ; API de lecture/API d'administration ; données en validation/données publiées ; stockage contrôlable par la PWA/téléchargements contrôlés par le navigateur ou l'OS.

## Invariants non négociables

- La PWA publique n'embarque ni login, ni credential opérateur, ni endpoint de mutation utilisable.
- Aucun nom, e-mail, téléphone, identifiant appareil, identifiant publicitaire ou GPS utilisateur n'est requis.
- Aucune géolocalisation automatique ni permission correspondante n'est demandée.
- Les requêtes et l'historique restent en RAM ; ils ne vont ni en URL, ni dans un log applicatif, ni dans un cache persistant.
- Toute donnée opérationnelle affichée porte un statut, `verified_at`, `expires_at` et une révision ; expirée, elle n'est jamais présentée comme disponible/vérifiée.
- Un dataset téléchargé n'est activé qu'après vérification de schéma, version et signature.
- L'ancien dataset valide reste disponible si une mise à jour échoue ou est invalide.
- Aucun contenu tiers, analytics, police distante, SDK de tracking ou carte externe.
- Toute insertion de texte non maîtrisé utilise des APIs sûres (`textContent`) ; pas de HTML dynamique non assaini.
- Panic Wipe est décrit comme best-effort et ne prétend jamais supprimer les téléchargements ou traces externes au contrôle de l'origin.

## Classification et stockage

| Donnée | Classification | Emplacement autorisé | Durée | Panic Wipe |
| --- | --- | --- | --- | --- |
| Recherche courante | sensible | RAM uniquement | vue/session active | purge mémoire |
| Historique de recherche | sensible | RAM uniquement | session active | purge mémoire |
| Position utilisateur | interdite | aucun | aucune | sans objet |
| Identité/profil | interdite | aucun | aucune | sans objet |
| Langue/thème | faible sensibilité | `sessionStorage` par défaut | fermeture onglet/session | purge |
| App shell | public | CacheStorage dédié | version courante + rollback borné | suppression du cache |
| Points d'aide publiables | public mais à risque physique | cache de données dédié | jusqu'à expiration/version suivante | suppression du cache |
| Fiche ouverte dans la PWA | public | cache seulement si explicitement demandé | jusqu'à suppression/purge | suppression best-effort |
| Fiche exportée/téléchargée | public, trace locale | stockage OS après consentement | contrôlée par l'utilisateur/OS | non garanti |
| Clé publique de vérification | publique | app shell | durée de la version | suppression avec shell |
| Clé privée/credential opérateur | secret | jamais dans la PWA publique | aucune | sans objet |

## Registre des menaces

Échelle : vraisemblance (V) et impact (I) de 1 à 5. Le risque initial est `V × I`. Les contrôles sont des exigences, pas des fonctionnalités actuellement présentes.

| ID | Scénario | V | I | Contrôles exigés | Risque résiduel accepté / décision |
| --- | --- | ---: | ---: | --- | --- |
| T01 | Un acteur hostile utilise la carte publique pour cibler un lieu | 5 | 5 | revue de publiabilité hors système, zone pilote réduite, pas de lieux secrets | élevé ; gate humain obligatoire, aucun contrôle technique ne rend une carte publique confidentielle |
| T02 | Faux point ou modification malveillante | 4 | 5 | API publique read-only, permissions opérateur limitées, double validation critique, audit, révocation | moyen ; accès opérateur compromis reste possible |
| T03 | Donnée ancienne affichée comme sûre | 5 | 5 | `verified_at`, `expires_at`, statuts, expiration locale conservative, avertissement explicite | moyen ; l'état terrain peut changer avant l'expiration |
| T04 | Snapshot/delta falsifié, rejoué ou tronqué | 3 | 5 | HTTPS, signature Web Crypto, version monotone, schéma strict, activation atomique, fallback au dernier dataset valide | faible à moyen ; compromission de la clé de signature nécessite rotation d'urgence |
| T05 | Serveur/CDN/pipeline compromis | 3 | 5 | séparation des rôles, signature hors plan de données public, CI protégée, déploiements reproductibles, rollback | moyen ; à détailler avec l'infrastructure réelle |
| T06 | Credential opérateur volé ou opérateur contraint | 4 | 5 | MFA/WebAuthn cible, credential révocable, portée région/catégorie, courte durée, double contrôle | moyen ; récupération de compte et procédures humaines requises |
| T07 | XSS/DOM injection exfiltre ou altère l'interface | 3 | 5 | aucun HTML dynamique non fiable, CSP restrictive, Typescript strict, zéro tiers, tests DOM-XSS | faible à moyen selon implémentation future |
| T08 | Service Worker ou cache empoisonné persiste | 3 | 5 | HTTPS, same-origin, pas d'`importScripts` tiers, noms/version de caches, validation/signature des données, purge | faible à moyen ; un origin compromis peut servir du code valide au navigateur |
| T09 | Recherche sensible persiste dans URL/storage/logs | 4 | 4 | état RAM, formulaire sans navigation GET, recherche locale, aucune télémétrie, inspection storage/cache | faible si invariant testé |
| T10 | Saisie physique du téléphone révèle l'application | 4 | 5 | PW toujours accessible, écran neutre immédiat, purge best-effort, libellé honnête | élevé ; historique navigateur, captures et fichiers OS peuvent rester |
| T11 | Téléchargement médical demeure après Panic Wipe | 4 | 4 | consentement avant téléchargement, avertissement clair, préférence au contenu offline dans l'origin | moyen à élevé ; suppression hors origin impossible à garantir |
| T12 | Interception réseau ou downgrade | 3 | 5 | HTTPS obligatoire, HSTS, pas de mixed content, CSP/`upgrade-insecure-requests` si pertinent | faible avec hébergement correctement configuré |
| T13 | Collecte involontaire par tiers ou logs | 3 | 4 | zéro tiers, recherche locale, logs minimisés, politique CDN/DNS/hébergeur, pas de query sensible | moyen ; métadonnées réseau persistent chez des intermédiaires |
| T14 | Déni de service, 2G ou coupure | 5 | 5 | shell offline, texte prioritaire, timeouts, cache minimal, snapshots régionaux, deltas, ancien dataset valide | moyen ; première visite sans réseau reste impossible |
| T15 | Bundle trop lourd épuise data/RAM | 4 | 4 | budgets bloquants, zéro framework runtime, SVG/CSS, découpage régional et lazy-load | faible si CI obligatoire |
| T16 | Stockage plein/éviction empêche l'offline | 4 | 4 | détection d'échec, cache borné, UI d'état offline, contenu vital minimal, tests appareils réels | moyen ; l'éviction appartient au navigateur |
| T17 | Horloge appareil fausse contourne l'expiration | 3 | 5 | conserver heure serveur signée + âge relatif, politique conservative si incohérence, jamais prolonger sur horloge incertaine | moyen ; conception à finaliser avec le protocole de données |
| T18 | Panique déclenchée accidentellement ou purge incomplète | 3 | 4 | action rapide mais protégée contre tap involontaire sans délai dangereux, opérations idempotentes, tests de chaque stockage | moyen ; arbitrage UX à tester sur le terrain |
| T19 | Information médicale erronée/traduction ambiguë | 3 | 5 | validation clinique, version, langue, date, contenu statique signé, revue terrain | moyen ; gouvernance éditoriale indispensable |
| T20 | Dépendance/build compromis | 3 | 5 | dépendances minimales, lockfile, versions pinées, audit, provenance CI, aucun script distant runtime | faible à moyen selon choix Phase 1 |

## Vérifications obligatoires par phase

- revue du registre et ajout de toute nouvelle surface ;
- test qu'aucune recherche/identité/position ne se retrouve dans URL, storage, caches ou requêtes ;
- scan des dépendances, secrets et endpoints de mutation ;
- build, tests, lint et contrôle de poids bloquant ;
- vérification offline avec cache vide, cache chaud, données expirées et mise à jour invalide ;
- inspection de l'accessibilité de Panic Wipe et de la fidélité au mode texte ;
- avant pilote : revue sécurité externe, revue clinique et autorisation explicite de chaque classe de lieux publiés.

## Risques résiduels à communiquer aux utilisateurs

HELP CONNECT peut réduire les traces qu'elle contrôle, pas rendre l'usage anonyme au niveau réseau. Une information vérifiée peut changer. Le Panic Wipe ne peut pas garantir l'effacement du téléphone, de l'historique géré par le navigateur, des captures, sauvegardes ou téléchargements. Une fiche enregistrée par le système doit être supprimée par l'utilisateur depuis le navigateur ou le gestionnaire de fichiers.

