# Plan d'implémentation HELP CONNECT

## Phase 0 — Threat model et décisions d'architecture

**Durée indicative : 3–5 jours.**

Cette phase doit précéder le développement de l'interface.

### 0.1 Définir ce que l'on protège

Les risques principaux ne sont pas seulement classiques comme XSS ou piratage du serveur. Dans le contexte décrit, il faut considérer :

* saisie physique du téléphone ;
* inspection du navigateur ;
* interception réseau ;
* faux points d'aide ;
* compromission d'un humanitaire autorisé ;
* modification malveillante des données ;
* serveur compromis ;
* connexion très lente ou intermittente ;
* téléphone ancien et peu puissant ;
* impossibilité de récupérer une mise à jour pendant plusieurs jours ;
* utilisation de la carte par un acteur hostile.

Ce dernier point est particulièrement important : **si la carte est publiquement consultable et sans authentification, un acteur hostile peut aussi la consulter**. Le CAPTCHA culturel envisagé dans le document ne peut pas garantir que seules les populations civiles y accèdent.

Par conséquent, seuls des lieux dont la publication a été explicitement considérée comme sûre par les partenaires humanitaires devraient apparaître publiquement.

### 0.2 Séparer totalement deux systèmes

```text
                    HELP CONNECT
                         │
          ┌──────────────┴───────────────┐
          │                              │
      PWA PUBLIQUE                 PORTAIL OPÉRATEURS
   lecture uniquement               accès protégé
          │                              │
          │                              │
          └──────── API / données ───────┘
```

**PWA publique**

* aucun compte ;
* aucun login ;
* aucun cookie utilisateur ;
* aucun profil ;
* aucune écriture sur les points d'aide ;
* aucun tracking ;
* aucune analytics ;
* aucune géolocalisation automatique.

**Portail opérateurs**

* séparé de la PWA ;
* idéalement autre sous-domaine/origin ;
* réservé ONG/médecins/comités autorisés ;
* authentification forte ;
* ajout/modification/invalidation des points ;
* journal d'audit ;
* révocation immédiate des accès.

Le document prévoit justement que la consultation soit anonyme alors que seuls des acteurs de confiance peuvent modifier les données. 

### 0.3 Règle de stockage

Créer dès maintenant une classification :

| Type                          | Stockage téléphone                         |
| ----------------------------- | ------------------------------------------ |
| Historique de recherche       | RAM uniquement                             |
| Recherche courante            | RAM                                        |
| Localisation utilisateur      | jamais stockée                             |
| Identité                      | inexistante                                |
| Paramètres langue/thème       | session uniquement par défaut              |
| App shell                     | cache autorisé                             |
| Données publiques de secours  | cache autorisé et supprimable              |
| Fiches médicales téléchargées | persistant uniquement sur action explicite |
| Clés opérateur                | jamais dans la PWA publique                |

OWASP recommande précisément de vérifier que les données sensibles ne se retrouvent pas dans `localStorage`, `IndexedDB`, caches ou autres stockages côté navigateur. ([OWASP Foundation][2])

---

# Phase 1 — Socle ultra-léger + budget de poids

**Durée : 4–6 jours.**

Je garderais l'idée du document : **pas de React, Next.js, Vue ou grosse librairie côté utilisateur**.

### Stack PWA

```text
HTML
CSS
TypeScript → JavaScript compilé
SVG
Service Worker natif
Fetch API
Cache API
Web Crypto API
```

TypeScript n'alourdit pas le client puisqu'il est compilé en JavaScript.

Un bundler peut être utilisé **uniquement pendant le build** ; il ne faut pas embarquer un framework runtime.

### Objectif de poids

Il ne faut pas définir uniquement « moins de 500 Ko ». Il faut créer plusieurs budgets.

| Élément                     | Budget compressé cible |
| --------------------------- | ---------------------: |
| HTML                        |               10–15 Ko |
| CSS                         |               15–25 Ko |
| JS application              |               40–70 Ko |
| Service Worker              |                5–10 Ko |
| SVG/icônes                  |               10–20 Ko |
| manifest + metadata         |                  <5 Ko |
| données initiales minimales |               30–60 Ko |
| **Core PWA initial**        |        **≈120–200 Ko** |
| marge                       |             100–200 Ko |
| **Hard limit initial**      | **<300 Ko idéalement** |
| **Maximum absolu**          |             **500 Ko** |

Les cartes régionales et les fiches médicales téléchargées à la demande **ne doivent pas entrer dans le poids initial**.

### Règles de poids

* aucune police web ;
* police système uniquement ;
* aucun PNG/JPEG pour les éléments UI ;
* SVG optimisés ;
* aucune bibliothèque d'icônes ;
* aucune animation lourde ;
* aucun CSS framework ;
* minification HTML/CSS/JS ;
* compression Brotli/Gzip côté serveur ;
* tree-shaking ;
* pas de source maps publiques en production ;
* CI qui bloque un build dépassant le budget.

Exemple :

```text
Build HELP CONNECT
────────────────────────
HTML                11 KB
CSS                 18 KB
JS                  54 KB
Service Worker       7 KB
SVG/icons            9 KB
manifest             2 KB
bootstrap data      42 KB
────────────────────────
TOTAL              143 KB ✓

Budget             300 KB
Hard limit         500 KB
```

---

# Phase 2 — Shell et navigation correspondant aux wireframes

**Durée : 4–5 jours.**

Implémenter exactement le squelette visible sur le diagramme.

### Navigation basse

Les quatre entrées :

```text
Accueil
Carte
Fiches
Recherche
```

Le bouton **PW / Panic Wipe** reste accessible sur les écrans critiques.

### Accueil

D'après le wireframe :

* logo ;
* Paramètres ;
* recherche ;
* recherches récentes ;
* catégories de premiers secours ;
* carte de survie ;
* accès Panic Wipe ;
* bottom navigation.

Important : les « dernières recherches » doivent être **en RAM uniquement**.

Après fermeture de la session :

```text
historique = []
```

### Paramètres

Wireframe :

```text
Paramètre
 ├─ Langue
 ├─ Panic Wipe
 └─ Affichage
      ├─ sombre
      └─ clair
```

Le mockup montre notamment English/Urdu. Le choix des langues devra être validé avec les utilisateurs terrain avant le déploiement ; il ne faut pas simplement figer cette liste dans le code.

### Architecture i18n ultra-légère

Pas de bibliothèque i18n.

```text
/i18n/en.json
/i18n/xx.json
```

Chaque langue est chargée uniquement lorsque nécessaire.

---

# Phase 3 — Fiches de premiers secours offline

**Durée : 5–7 jours.**

C'est une fonctionnalité prioritaire, car elle continue à fonctionner même lorsque HELP CONNECT n'est plus joignable.

Le document prévoit des fiches sur l'accouchement, les blessures par balle, hémorragies et autres urgences, accessibles hors ligne. 

### Écran catégories

Correspond au wireframe :

```text
Recherche
[Catégorie 1] [Catégorie 2] [Catégorie 3]

┌───────────────────┐
│ catégorie         │
│ 8 fiches          │
└───────────────────┘

┌───────────────────┐
│ catégorie         │
│ 5 fiches          │
└───────────────────┘

        ↓ télécharger
```

Puis :

```text
Catégorie sélectionnée

┌──────────┐ ┌──────────┐
│ nom      │ │ nom      │
│ 5 étapes │ │ 7 étapes │
└──────────┘ └──────────┘
```

### Format recommandé

Chaque bundle médical :

```text
first-aid-trauma.html
first-aid-childbirth.html
...
```

ou un :

```text
first-aid-complete.html
```

contenant uniquement :

* HTML ;
* CSS ;
* SVG ;
* zéro JavaScript si possible ;
* zéro requête réseau ;
* zéro tracking ;
* zéro lien vers une dépendance externe.

### Point de sécurité UX

Un fichier téléchargé **reste sur le téléphone**.

L'utilisateur doit voir avant le téléchargement :

> Cette fiche sera enregistrée sur votre appareil et ne pourra pas être supprimée par HELP CONNECT après avoir quitté le navigateur.

C'est une différence essentielle avec les données temporaires de la PWA.

---

# Phase 4 — Recherche et mode 100 % texte

**Durée : 4–6 jours.**

Le mode texte doit être considéré comme un produit de première classe, pas comme une version dégradée bricolée après la carte.

### Recherche

Recherche locale prioritaire :

```text
utilisateur
   ↓
index local miniature
   ↓
résultats
```

Pas besoin d'appeler le serveur pour chaque caractère tapé.

Recherche sur :

* quartier ;
* catégorie ;
* nom du point ;
* type de secours.

### Mode réseau dégradé

Définir trois niveaux :

```text
MODE A — NORMAL
Carte + données

MODE B — LOW DATA
Carte très simplifiée + texte

MODE C — TEXT ONLY
aucune carte
aucun asset non essentiel
liste uniquement
```

Exemple :

```text
Khartoum Nord
──────────────────
EAU
Al-Safaa
Point 04
Vérifié il y a 2 h

HÔPITAL
...
```

Cela correspond au mode grille textuel décrit dans le document, destiné à remplacer la carte lorsque le réseau est insuffisant. 

Il doit également être **activable manuellement** grâce au bouton « Mode text » visible dans le wireframe.

---

# Phase 5 — Carte ultra-légère

**Durée : 7–10 jours.**

La carte est probablement la fonctionnalité présentant le plus grand risque de faire exploser les 500 Ko.

Le document propose SVG/Canvas et uniquement les routes/points strictement nécessaires. 

Je déconseille donc totalement :

```text
Google Maps ❌
Mapbox GL JS ❌
Leaflet + tiles classiques ❌
OpenLayers ❌
```

pour la PWA publique ultra-légère.

### Carte maison

```text
SVG / Canvas
   │
   ├── limites simplifiées
   ├── routes principales
   ├── quartiers
   │
   └── points
       ├── eau
       ├── hôpital
       ├── nourriture
       ├── générateur
       └── autres secours
```

### Ne pas télécharger tout le Soudan

Les données doivent être découpées :

```text
/bootstrap.json

/regions/
   khartoum.min.json
   omdurman.min.json
   ...
```

L'utilisateur ne télécharge que la région demandée.

### Géométrie

Simplification effectuée **sur le serveur**, jamais sur le téléphone.

```text
GeoJSON lourd
       ↓
pipeline serveur
       ↓
géométrie simplifiée
       ↓
format compact
       ↓
PWA
```

Le client ne doit pas transformer de gros GeoJSON.

---

# Phase 6 — Micro-updates et fonctionnement réseau intermittent

**Durée : 5–7 jours.**

Le document veut que le bouton « Mise à jour » télécharge uniquement les changements plutôt que l'ensemble de la carte. 

Très bonne idée, mais je ne baserais pas le protocole uniquement sur « dernières 24 heures ».

Un utilisateur peut être hors ligne pendant dix jours.

### Utiliser des versions

Téléphone :

```text
dataset_version = 184
```

Serveur :

```text
current_version = 188
```

Réponse :

```text
184 → 185
185 → 186
186 → 187
187 → 188
```

Ou directement :

```text
delta-184-188
```

### Exemple conceptuel

```json
{
  "from": 184,
  "to": 188,
  "changes": [
    {"id": "W123", "status": "closed"},
    {"id": "H055", "status": "open"}
  ]
}
```

Quelques centaines d'octets suffisent fréquemment.

### Si l'utilisateur est trop en retard

```text
delta disponible ?
       │
   ┌───┴───┐
  oui     non
   │       │
 delta   snapshot régional
```

---

# Phase 7 — Intégrité des données et portail humanitaire

**Durée : 1–2 semaines.**

C'est probablement **la partie la plus importante de HELP CONNECT**.

L'application ne doit jamais considérer une donnée comme vraie simplement parce que l'API l'a renvoyée.

### Cycle d'un point

```text
OPÉRATEUR
    ↓
création
    ↓
validation
    ↓
publication
    ↓
vérifié
    ↓
expiration
    ↓
revalidation
```

Chaque point devrait avoir au minimum :

```text
id
category
region
location
status
verified_at
expires_at
revision
```

Pas :

```text
nom de l'humanitaire
téléphone de l'humanitaire
identité du validateur
```

dans les données publiques.

### Statuts

Je recommanderais :

```text
VERIFIED
STALE
UNAVAILABLE
CLOSED
```

plutôt qu'une simple promesse « 100 % sûr ».

Une donnée vérifiée hier peut être dangereusement fausse aujourd'hui dans une zone de conflit.

### Expiration automatique

Exemple :

```text
Point d'eau
vérifié : 14:30
expiration : 20:30
```

Passé cette heure :

```text
⚠ information ancienne
dernière vérification : il y a 7 h
```

et non :

```text
✓ disponible
```

---

# Phase 8 — Sécurisation des comptes opérateurs

Le PDF envisage une clé cryptographique sous forme de fichier ou QR code. 

Je déconseille qu'un simple fichier texte statique constitue à lui seul l'autorisation de modification.

S'il est copié, photographié ou confisqué, l'attaquant obtient potentiellement les mêmes droits.

### Architecture plus robuste

```text
Opérateur
   │
   ├── authentification forte
   │
   ├── credential révocable
   │
   └── permissions limitées
          │
          ▼
       API admin
          │
          ▼
      validation
          │
          ▼
      publication
```

### Autorisations

Par exemple :

```text
Opérateur A
├── Khartoum uniquement
├── eau
└── nourriture

Opérateur B
├── Omdurman
└── santé
```

La compromission d'un compte ne doit pas permettre de modifier tout le pays.

### Pour les informations critiques

Possibilité d'appliquer :

```text
éditeur A
    ↓
validation B
    ↓
publication
```

pour empêcher un compte compromis de publier immédiatement un piège.

---

# Phase 9 — Signature cryptographique des mises à jour

Même HTTPS ne résout pas tous les problèmes d'intégrité applicative.

Je ferais signer les datasets publiés.

```text
BACKEND
data.json
    │
    ▼
signature
    │
    ├── data
    └── signature

           Internet
              ↓

PWA
   ↓
Web Crypto API
   ↓
signature valide ?
   │
┌──┴──┐
oui  non
 │    │
affiche REJET
```

La PWA embarque uniquement la **clé publique**.

Pas de bibliothèque crypto JavaScript lourde : utiliser les primitives cryptographiques natives du navigateur après validation de compatibilité.

Cela améliore à la fois :

* la sécurité ;
* le poids ;
* la surface d'attaque.

---

# Phase 10 — Panic Wipe

**À traiter comme une fonctionnalité de sécurité complète, pas comme un simple bouton.**

Le document lui attribue un rôle de protection lors de contrôles physiques. 

### Appui sur PW

L'interface doit disparaître immédiatement.

```text
PW
 ↓
écran neutre IMMÉDIAT
 ↓
mémoire JS = purge
 ↓
historique de recherche = purge
 ↓
sessionStorage = purge
 ↓
localStorage = purge
 ↓
IndexedDB = purge
 ↓
CacheStorage = purge
 ↓
Service Worker = unregister
 ↓
remplacement de l'état/navigation
```

On peut en plus supprimer les données appartenant explicitement à l'application dans le navigateur.

### Mais ne jamais promettre

> « efface physiquement toutes les données du téléphone »

Ce n'est pas contrôlable par JavaScript.

`CacheStorage` est justement un mécanisme persistant utilisé par les PWA. ([MDN Web Docs][3]) Le cache et l'historique du navigateur sont également des surfaces à prendre en compte ; OWASP recommande notamment `Cache-Control: no-store` pour les réponses sensibles. ([OWASP Foundation][4])

### Attention aux téléchargements

Le Panic Wipe **ne peut pas garantir la suppression** de :

```text
Downloads/first-aid.html
```

si le navigateur l'a enregistré dans le système de fichiers.

Ce point doit être expliqué à l'utilisateur.

---

# Phase 11 — Hardening Web

**Durée : 3–5 jours puis continu.**

### HTTPS obligatoire

Les Service Workers et CacheStorage nécessitent un contexte sécurisé dans les navigateurs modernes. ([MDN Web Docs][5])

### Headers

Configurer notamment :

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
frame-ancestors
```

OWASP maintient précisément des recommandations sur ces protections HTTP. ([OWASP Foundation][6])

### CSP extrêmement restrictive

Conceptuellement :

```text
default-src 'self'
script-src 'self'
style-src 'self'
img-src 'self' data:
connect-src 'self'
object-src 'none'
frame-src 'none'
base-uri 'none'
```

À adapter au build final.

### Aucun tiers

C'est essentiel :

```text
Google Analytics      ❌
Google Fonts          ❌
Sentry                 ❌
Hotjar                 ❌
CDN JS externe         ❌
Facebook SDK           ❌
Google Maps            ❌
```

Chaque tiers :

1. ajoute du poids ;
2. crée des requêtes réseau ;
3. peut exposer des métadonnées ;
4. élargit la surface d'attaque.

OWASP signale également le risque d'informations sensibles ou de clés intégrées dans le JavaScript frontend. ([OWASP Foundation][7])

---

# Phase 12 — Privacy réseau et absence de télémétrie

Une autre affirmation du document doit être reformulée :

> « anonymat total »

Une application web ne peut pas garantir cela à elle seule.

Même sans compte :

```text
Téléphone
   ↓
opérateur télécom
   ↓
réseau
   ↓
DNS/CDN/serveur
```

peut générer des métadonnées réseau.

On peut néanmoins réduire considérablement ce qui est collecté.

### HELP CONNECT ne doit volontairement collecter

```text
nom              ❌
email            ❌
numéro            ❌
GPS               ❌
device ID         ❌
advertising ID    ❌
analytics ID      ❌
historique        ❌
profil            ❌
```

### Logs serveur

Minimiser drastiquement :

* durée de conservation ;
* logs applicatifs ;
* IP ;
* user-agent ;
* logs CDN ;
* logs de recherche.

L'API ne devrait même pas recevoir le texte de recherche quand la recherche peut être réalisée localement.

---

# Phase 13 — PWA offline et stratégie de cache

Le compromis fondamental de HELP CONNECT est ici :

```text
          OFFLINE
            ▲
            │
        stockage local
            │
            ▼
      MINIMUM DE TRACES
```

On ne peut pas maximiser les deux simultanément.

Faudrait séparer donc le cache en catégories.

### CACHE 1 — app-shell

```text
index.html
app.css
app.js
icons.svg
```

Permet de lancer HELP CONNECT hors ligne.

### CACHE 2 — données

```text
region-khartoum-188.dat
```

Supprimable.

### CACHE 3 — jamais

```text
historique de recherche
requêtes
navigation
position utilisateur
données personnelles
```

La Cache API est précisément le mécanisme prévu pour fournir des réponses locales lorsqu'une PWA est hors ligne. ([MDN Web Docs][8])

---

# Phase 14 — Network adaptation

Le comportement doit être piloté par **la réussite réelle des requêtes**, pas uniquement par `navigator.onLine`.

```text
         REQUEST
            │
          <1 s
            │
      mode normal

          timeout
            │
      retry minimal
            │
        timeout
            │
        TEXT MODE
```

Ne pas lancer de speed test : cela consommerait justement de la data.

### Ordre de chargement

```text
1. HTML
2. CSS critique
3. texte
4. données urgentes
5. carte
6. éléments secondaires
```

Jamais :

```text
1. animation
2. logo lourd
3. images
4. données vitales
```

---

# Phase 15 — Tests de poids

Chaque Pull Request doit exécuter automatiquement :

```text
build
 ↓
minify
 ↓
compress
 ↓
measure
 ↓
compare budget
```

Exemple :

```text
Initial transfer ≤ 200 KB      PASS
Core offline     ≤ 300 KB      PASS
Hard limit       ≤ 500 KB      PASS

JS               ≤ 80 KB       PASS
CSS              ≤ 30 KB       PASS
```

Si le seuil est dépassé :

```text
BUILD FAILED
```

et pas un simple warning.

---

# Phase 16 — Tests appareils/réseau réels

Ne surtout pas valider HELP CONNECT uniquement sur un MacBook avec fibre.

Créer une matrice :

| Test        | Condition               |
| ----------- | ----------------------- |
| Téléphone   | Android entrée de gamme |
| RAM         | faible                  |
| CPU         | faible                  |
| Réseau      | 2G simulée              |
| Latence     | 1–3 s                   |
| Packet loss | élevé                   |
| Internet    | intermittent            |
| Internet    | totalement coupé        |
| JavaScript  | lent                    |
| stockage    | presque plein           |
| écran       | petit                   |
| luminosité  | forte                   |
| thème       | sombre                  |
| langues     | toutes                  |

### Scénario critique

```text
1. Charger HELP CONNECT.
2. Couper Internet.
3. Fermer le navigateur.
4. Réouvrir.
5. Rechercher un hôpital.
6. Ouvrir la fiche de secours.
7. Basculer en mode texte.
8. Réactiver Internet très lent.
9. Recevoir un delta.
10. Panic Wipe.
11. Inspecter tous les stockages.
```

---

# Phase 17 — Audit sécurité avant pilote

Avant toute utilisation réelle :

### Audit frontend

* XSS ;
* DOM injection ;
* CSP ;
* storage ;
* caches ;
* service worker ;
* fichiers téléchargés ;
* URL ;
* browser history ;
* Panic Wipe.

### API

* auth opérateurs ;
* permissions ;
* rate limiting ;
* signatures ;
* replay ;
* modification de données ;
* suppression ;
* credential compromise.

### Infrastructure

* TLS ;
* DNS ;
* CDN ;
* logs ;
* backups ;
* secrets ;
* CI/CD ;
* accès administrateurs.

Le guide de tests OWASP couvre explicitement les risques liés au stockage navigateur, aux injections côté client, aux APIs et à l'exposition de données. ([OWASP Foundation][9])

---

# Phase 18 — Pilote terrain

Ne pas commencer avec tout le pays.

Par exemple :

```text
1 région
   ↓
20–50 points
   ↓
3–5 catégories
   ↓
quelques opérateurs vérifiés
   ↓
petit groupe d'utilisateurs
```

Mesurer **sans tracking individuel**, notamment avec des observations/tests terrain :

* temps pour trouver une ressource ;
* compréhension des icônes ;
* compréhension de « vérifié / ancien » ;
* mode texte ;
* qualité des traductions ;
* vitesse ;
* poids réel ;
* fonctionnement offline ;
* Panic Wipe ;
* erreurs de manipulation.

---

# Phase 19 — Déploiement

Architecture finale que je viserais :

```text
                     INTERNET
                         │
                 ┌───────┴───────┐
                 │               │
          CDN / static         API read
                 │               │
                 └───────┬───────┘
                         │
                    HELP CONNECT
                     Ghost-PWA
                         │
             ┌───────────┼───────────┐
             │           │           │
          App shell   Map data   First aid
          <200 KB      delta      optional
             │
             ▼
          OFFLINE


                  SYSTÈME SÉPARÉ
                         │
                  operator.help...
                         │
               Authentification forte
                         │
                 validation terrain
                         │
                     API admin
                         │
                    Database
                         │
                 signed snapshots
                         │
                        CDN
```

# Ordre de développement recommandé

En pratique, je ne commencerais **pas** par dessiner la carte.

```text
PHASE 0  Threat model
   ↓
PHASE 1  Architecture + limite 500 Ko
   ↓
PHASE 2  Shell/navigation du wireframe
   ↓
PHASE 3  Premiers secours offline
   ↓
PHASE 4  Recherche + Text Mode
   ↓
PHASE 5  Carte SVG/Canvas
   ↓
PHASE 6  Micro-updates
   ↓
PHASE 7  Backend + modèle de données
   ↓
PHASE 8  Portail opérateurs + validation
   ↓
PHASE 9  Signature/intégrité
   ↓
PHASE 10 Panic Wipe
   ↓
PHASE 11 Security hardening
   ↓
PHASE 12 Tests réseau/appareils
   ↓
PHASE 13 Audit externe
   ↓
PHASE 14 Pilote
   ↓
PHASE 15 Production
```

## Les 8 règles non négociables

1. **<300 Ko de transfert initial visé ; 500 Ko = plafond, pas objectif.**
2. **Pas de framework frontend lourd.**
3. **Aucune donnée personnelle dans la PWA.**
4. **Aucun GPS automatique.**
5. **Aucun tiers, analytics, font ou script externe.**
6. **La PWA publique ne peut jamais modifier les points d'aide.**
7. **Chaque information opérationnelle doit avoir une fraîcheur/expiration et non être présentée comme « sûre à 100 % ».**
8. **Panic Wipe = best-effort documenté, pas promesse d'effacement forensic.**



