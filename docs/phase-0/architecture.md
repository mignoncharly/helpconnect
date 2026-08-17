# HELP CONNECT — Décisions d'architecture de Phase 0

Statut : décisions cibles acceptées pour guider l'implémentation. Les noms de domaine et fournisseurs restent à choisir.

## ADR-001 — Deux systèmes et deux origins

**Décision.** La PWA publique et le portail opérateurs seront deux applications, déploiements, origins et surfaces d'API distincts.

```text
Origin public (exemple)                 Origin privé (exemple)
app.helpconnect.example                 operators.helpconnect.example
        |                                        |
        v                                        v
API/CDN public GET/HEAD seulement        API admin authentifiée
        ^                                        |
        |                                        v
        +--- artefacts publiés/signés --- pipeline de validation
```

L'origin public ne partagera pas cookies, tokens, Service Worker, caches, secrets, routes d'administration ou configuration CORS permissive avec l'origin privé. Le backend peut partager un stockage interne, mais uniquement derrière deux plans d'accès séparés. Un reverse proxy qui masque simplement des routes `/admin` sous l'origin public ne satisfait pas cette décision.

**Raison.** Réduire l'impact d'une compromission de la PWA et garantir que son contrat réseau reste en lecture seule.

## ADR-002 — Stack publique sans runtime de framework

**Décision.** HTML sémantique, CSS, TypeScript compilé en JavaScript, SVG, Service Worker natif, Fetch/Cache API et Web Crypto. Un outil de build dev-only minimal est autorisé s'il produit des assets statiques, déterministes et sans runtime tiers.

Interdits sans nouvelle ADR justifiée : React/Vue/Next, framework CSS, bibliothèque d'icônes, police web, SDK analytics/crash reporting, Google Maps/Mapbox/Leaflet/OpenLayers, script ou CDN tiers.

**Raison.** Budgets de transfert, compatibilité appareils faibles, auditabilité et réduction de la supply chain.

## ADR-003 — Modèle de publication à sens unique

**Décision.** Le portail écrit dans une zone non publiée. Validation puis publication produisent des snapshots/deltas immuables. L'API publique ne reçoit jamais de recherche et ne propose que `GET`/`HEAD` sur des ressources versionnées.

Contrat public minimal cible pour un point :

```text
id, category, region, coarse_location, status,
verified_at, expires_at, revision
```

Sont exclus : identité/contact du validateur, note interne, credential, localisation utilisateur. `coarse_location` signifie la précision minimale approuvée comme sûre pour la catégorie ; elle n'impose pas la publication systématique de coordonnées exactes.

Une donnée suit : brouillon → validation → publication → vérifiée → expirée/invalidation → revalidation. `VERIFIED`, `STALE`, `UNAVAILABLE` et `CLOSED` sont des statuts d'affichage ; la logique exacte sera formalisée avec le schéma.

## ADR-004 — Intégrité avant activation

**Décision.** Snapshots et deltas publics seront signés côté publication et vérifiés par Web Crypto avant activation. La PWA embarque uniquement une clé publique. Version, région, schéma, taille maximale, signature et transition de version sont vérifiés. L'écriture locale est temporaire puis atomiquement promue ; un échec conserve la dernière version valide.

**État Phase 9.** Décision implémentée avec une racine publique intégrée, une keyring racine-signée, des enveloppes ECDSA P-256/SHA-256 détachées, des séquences monotones et une activation CacheStorage en un seul `cache.put`. Le résultat d’une chaîne de deltas est vérifié contre le snapshot final signé avant promotion.

HTTPS reste obligatoire mais n'est pas considéré comme la seule preuve d'intégrité applicative. La gestion de rotation/révocation des clés doit être conçue avant l'implémentation de la signature.

## ADR-005 — Stockage explicite et compartimenté

**Décision.** Chaque écriture persistante doit appartenir à une allow-list documentée.

| Compartiment | Contenu | Stratégie |
| --- | --- | --- |
| mémoire JS | recherche courante, historique récent, état UI sensible | jamais sérialisé ; purgé à la navigation/PW |
| `sessionStorage` | langue et thème par défaut | aucune donnée sensible ; purge PW |
| cache `hc-shell-vN` | HTML/CSS/JS/SVG/manifest et core public signé minimal | precache borné, même origin, versionné |
| cache `hc-data-vN` | état anti-rejeu et régions publiques validées | région après action explicite, expiration et quota |
| cache `hc-first-aid-vN` | fiches offline demandées dans l'app | consentement explicite, version et suppression disponibles |
| téléchargement OS | export HTML éventuel | avertissement préalable ; hors garantie de PW |

`localStorage`, cookies utilisateur et IndexedDB sont interdits par défaut. IndexedDB ne pourra être introduit que par une nouvelle ADR démontrant que CacheStorage ne suffit pas, avec inventaire et purge testée. Les noms réels des caches devront être centralisés afin que Panic Wipe ne supprime que les données appartenant à HELP CONNECT.

**État Phase 13.** Décision implémentée avec `hc-shell-<hash>`, `hc-data-v1` et `hc-first-aid-v1`, allow-lists disjointes, migration des anciennes entrées, suppression individuelle région/langue et éviction à la lecture des réponses signées invalides ou expirées. Le produit ne demande volontairement pas la persistance du bucket navigateur.

## ADR-006 — Offline sélectif, confidentialité minimale

**Décision.** Le compromis offline/traces est rendu visible et contrôlable :

- le shell minimal est mis en cache pour le lancement offline ;
- seules les données publiques d'une région demandée sont mises en cache ;
- les fiches médicales deviennent persistantes uniquement après action explicite ;
- les recherches, suggestions personnalisées et chemins de navigation ne sont jamais mis en cache ;
- les réponses sensibles éventuelles utilisent `Cache-Control: no-store` et ne passent pas dans le Service Worker ;
- la réussite réelle et les délais des requêtes pilotent le mode dégradé, sans speed test.

Ordre de rendu : HTML → CSS critique → texte → données urgentes → carte → secondaire. Le texte demeure utilisable si JavaScript, carte ou mise à jour réseau échoue.

## ADR-007 — Recherche locale et mode texte de première classe

**Décision.** La recherche s'effectue sur un index régional compact local : quartier, catégorie, nom public et type de secours. La chaîne de recherche ne quitte pas l'appareil. L'historique du wireframe est limité à la RAM.

Le bouton « Mode texte » du wireframe est manuel et toujours disponible. L'adaptation automatique peut proposer/activer un mode dégradé après échecs réels, mais ne doit jamais empêcher le retour manuel. La carte future sera SVG ou Canvas sur géométrie pré-simplifiée côté serveur, chargée par région et non requise pour accomplir le parcours principal.

## ADR-008 — Panic Wipe comme transition de sécurité

**Décision.** PW déclenche d'abord un écran neutre local immédiat, puis purge en best-effort : état mémoire, `sessionStorage`, éventuel `localStorage`, bases IndexedDB appartenant à l'origin, caches HELP CONNECT et inscriptions Service Worker. La navigation finale utilise un remplacement d'historique quand le navigateur le permet.

La fonctionnalité ne promet pas d'effacer l'historique global du navigateur, caches intermédiaires, captures, téléchargements, sauvegardes ou fichiers du téléphone. Son interaction exacte (tap direct, appui long, confirmation discrète) est un gate de test terrain : une confirmation lente peut mettre l'utilisateur en danger, une action trop facile peut provoquer une purge accidentelle.

## ADR-009 — I18n progressive et accessible

**Décision.** Aucun runtime i18n. Un dictionnaire minimal par langue est chargé à la demande depuis le même origin. HTML conserve une langue de repli complète. Le sens de lecture (`dir`) est attaché à chaque locale, notamment pour les langues RTL. Les libellés, messages d'expiration et avertissements de sécurité doivent être revus par des locuteurs terrain ; English/Urdu dans le wireframe sont des exemples, pas une liste validée.

Le choix de langue/thème reste en session par défaut. Une éventuelle persistance entre sessions exigerait un consentement et une révision du threat model.

## ADR-010 — Politique réseau et navigateur restrictive

**Décision.** Production exclusivement HTTPS. Baseline de headers à adapter et tester :

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
```

Pas de CSP avec `unsafe-inline`/`unsafe-eval`, pas de mixed content, pas d'iframe, pas de formulaire cross-origin. Les headers doivent être vérifiés sur l'hébergement réel ; un fichier statique seul ne peut pas imposer HSTS.

## ADR-011 — Absence de télémétrie applicative

**Décision.** Aucun analytics, tracking, beacon, fingerprint, identifiant stable ou crash reporter distant dans la PWA. Le serveur public ne reçoit pas les recherches. Les logs d'accès d'infrastructure sont minimisés en champs et rétention, puis documentés avec chaque fournisseur. Le produit ne revendiquera pas « anonymat total ».

Les mesures pilote utilisent tests terrain agrégés et observation consentie, hors application publique.

**État Phase 12.** Décision implémentée côté PWA avec requêtes same-origin sans credentials/referrer/query, lint anti-télémétrie/fingerprinting, preuve navigateur que les recherches restent locales et contrat de logs machine-readable. L’infrastructure réelle reste soumise à une preuve fournisseur récente ; aucune revendication d’anonymat total n’est autorisée.

## ADR-012 — Budgets comme contrat de build

**Décision.** Le contrôle introduit en Phase 1 mesurera les assets réellement déployés, individuellement et en ensembles :

- transfert initial Brotli ≤ 200 Ko (objectif, bloquant sauf décision explicite) ;
- core offline Brotli ≤ 300 Ko (bloquant) ;
- total initial/core le plus large ≤ 500 Ko (plafond absolu bloquant) ;
- JavaScript Brotli ≤ 80 Ko ; CSS Brotli ≤ 30 Ko.

Les régions et fiches optionnelles sont exclues de l'initial mais disposent de rapports et plafonds propres. Un asset optionnel ne peut jamais être silencieusement ajouté au precache du core.

## Architecture cible et responsabilités

| Composant | Responsabilité | Ne doit jamais faire |
| --- | --- | --- |
| PWA publique | rendu, recherche locale, cache explicite, vérification crypto | authentifier un opérateur, muter un point, collecter une identité/GPS |
| Service Worker public | shell offline et caches allow-listés | cache générique de toutes les requêtes, journaliser les recherches |
| API/CDN public | servir artefacts versionnés signés | recevoir une recherche, exposer brouillons ou données opérateur |
| Portail opérateurs | saisie/revue avec authentification forte | partager origin/session avec la PWA |
| API admin | permissions, mutations, audit, révocation | publier directement sans validation |
| Pipeline publication | validation, minimisation, expiration, signature | inclure données internes ou clés privées dans l'artefact |

## Structure de projet proposée pour la Phase 1

Cette structure est une décision, pas encore créée :

```text
public/                 assets statiques et manifest
src/                    TypeScript/CSS/HTML de la PWA publique
src/sw/                 Service Worker natif
data/bootstrap/         données publiques minimales de démonstration
scripts/                build et contrôle des budgets
tests/                  sécurité, stockage, offline et UI
docs/                   threat model, ADR et rapports
```

Le portail opérateurs n'entre pas dans cette arborescence applicative publique. Il devra vivre dans un projet ou package déployable séparément, avec une configuration et des secrets indépendants.

## Gates humains avant données réelles

Ces choix ne peuvent pas être décidés par le code :

1. catégories et granularité de lieux dont la publication publique est sûre ;
2. partenaires habilités à valider, durée d'expiration par catégorie et procédure d'urgence ;
3. langues, dialectes, RTL, terminologie et pictogrammes compris sur le terrain ;
4. gouvernance clinique/versionnage des fiches médicales ;
5. interaction PW la plus sûre et écran neutre adapté au contexte ;
6. politique de logs/rétention des hébergeur, CDN et DNS ;
7. stratégie de clé de signature, rotation, révocation et récupération après compromission.

Sans validation des points 1, 2 et 4, aucune donnée opérationnelle réelle ne doit être publiée.
