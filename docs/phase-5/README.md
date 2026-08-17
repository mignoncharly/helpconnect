# HELP CONNECT — Sortie de Phase 5

Date : 17 août 2026  
Statut : terminée ; arrêt avant la Phase 6.

## Résultat

HELP CONNECT dispose maintenant d'une carte SVG maison, sans Google Maps, Mapbox, Leaflet, OpenLayers, tuiles ou dépendance runtime. Elle affiche :

- une limite régionale simplifiée ;
- une route principale et des routes secondaires ;
- des noms de zones ;
- les points du répertoire texte ;
- des couleurs par catégorie, dont eau, hôpital, nourriture, abri, premiers secours et générateur.

Le client reçoit directement des tableaux de points normalisés et précalculés. Il assemble uniquement des éléments SVG (`polygon`, `polyline`, `circle`, `text`) avec `createElementNS` et `textContent`. Il ne charge, ne projette et ne simplifie aucun GeoJSON sur le téléphone.

## Découpage régional

Le core offline contient `/bootstrap.json`, soit 240 octets Brotli. Ce bootstrap expose deux chunks optionnels :

```text
/regions/demo-north.min.json  418 o Brotli
/regions/demo-south.min.json  436 o Brotli
```

Une seule région est sélectionnée et chargée à la fois. Aucun chunk régional n'est précaché ou récupéré en arrière-plan.

Le flux d'installation est explicite :

1. l'utilisateur choisit une région ;
2. une fenêtre indique que le fichier persistera dans le navigateur et que le PW actuel ne peut pas l'effacer ;
3. après confirmation, le client récupère le seul chemin autorisé avec `cache: no-store` ;
4. taille, schéma, région, points et géométrie sont validés ;
5. le Service Worker vérifie à nouveau type, chemin, taille et JSON avant l'écriture dans CacheStorage.

Le choix courant n'est stocké ni dans l'URL ni dans un storage : il reste en RAM. Le chunk explicitement enregistré persiste afin de rendre la carte disponible hors ligne.

## Carte schématique, pas géographique

Le projet ne possède toujours aucune donnée de terrain validée. Les deux régions et les six points sont donc synthétiques et portent obligatoirement :

```text
DEMO_NOT_OPERATIONAL
SCHEMATIC_NOT_GEOGRAPHIC
```

Les nombres 0–100 décrivent uniquement une position dans le `viewBox` SVG. Ce ne sont ni latitude, ni longitude, ni coordonnées projetées. L'interface affiche « DÉMONSTRATION — NON OPÉRATIONNEL » avant la carte et répète l'avertissement dans le répertoire.

Le schéma rejette tout champ `latitude`, `longitude`, `coordinates`, GeoJSON `features`/`geometry`, contact ou validateur. Il rejette aussi les points inconnus du répertoire, les doublons, les chemins régionaux non conformes et les valeurs hors du carré 0–100.

## Modes réseau intégrés

| Mode | Carte | Détails | Liste texte |
| --- | --- | --- | --- |
| A — Normal | visible | limites, toutes routes, zones, points et libellés | visible |
| B — Données réduites | visible | limite, route principale et points ; détails secondaires masqués | visible |
| C — Texte seul | absente du rendu | aucun élément cartographique affiché | visible |

Les filtres du répertoire masquent simultanément les cartes texte et les marqueurs SVG non correspondants. Le changement de langue rerend les options de région, quartiers, noms et types de secours, y compris en urdu/RTL.

## Poids

Mesure : Brotli qualité 11, Gzip niveau 9, `1 Ko = 1024 octets`.

| Ensemble | Phase 4 | Phase 5 | Limite | Résultat |
| --- | ---: | ---: | ---: | --- |
| Transfert initial Brotli | 14 157 o | 16 832 o | 204 800 o | PASS |
| Core offline Brotli | 14 157 o | 16 832 o | 307 200 o | PASS |
| Tous assets Brotli | 35 511 o | 39 479 o | 512 000 o | PASS |
| JavaScript Brotli | 5 489 o | 7 149 o | 81 920 o | PASS |
| CSS Brotli | 3 022 o | 3 353 o | 30 720 o | PASS |
| Répertoire texte | 821 o | 937 o | 20 480 o | PASS |
| Régions optionnelles réunies | — | 854 o | 40 960 o | PASS |
| Plus gros chunk régional | — | 436 o | 20 480 o | PASS |
| Fiches optionnelles | 16 404 o | 16 404 o | 153 600 o | PASS |
| Plus gros paquet médical | 3 226 o | 3 226 o | 51 200 o | PASS |

## Vérifications exécutées

- `npm run lint` : PASS ;
- `npm run typecheck` : PASS ;
- `npm test` : 30/30 PASS ;
- bootstrap, chemins fermés, deux chunks et géométrie précalculée : PASS ;
- rejet des champs géographiques, contacts et points inconnus : PASS ;
- `npm run build` : PASS avec dix budgets bloquants ;
- deux builds consécutifs : 20/20 fichiers `dist` avec hashes SHA-256 identiques ;
- `npm audit --audit-level=moderate` : 0 vulnérabilité ;
- liens locaux des douze fichiers Markdown : aucun lien cassé ;
- `npm run test:offline` : PASS dans Chrome ;
- aucun chunk régional avant consentement : PASS ;
- installation du seul chunk Nord, chunk Sud absent du cache : PASS ;
- carte normale avec une limite, trois routes et trois points : PASS ;
- mode réduit avec détails masqués et route principale visible : PASS ;
- mode texte sans carte : PASS ;
- rechargement serveur arrêté, carte Nord, recherche urdu et fiches médicales : PASS.

Les captures de contrôle sont disponibles dans `reports/ui-map.png` et `reports/ui-text-mode.png`, hors de `dist/`.

## Fichiers principaux

- `public/bootstrap.json` : catalogue minimal des régions ;
- `public/regions/*.min.json` : chunks schématiques précalculés ;
- `scripts/map-schema.mjs` : validation stricte bootstrap/région ;
- `test/map.test.mjs` : garde-fous de géométrie et d'identité ;
- `src/app.ts` : sélection, consentement, validation, cache et rendu SVG ;
- `src/sw.ts` : allow-list et stockage régional séparés des fiches médicales ;
- `src/index.html`, `src/styles.css` : sélecteur, carte et modes réseau ;
- `scripts/offline-smoke.mjs` : parcours cartographique online/offline.

## Suite volontairement non commencée

La Phase 6 devra introduire les versions de datasets, les deltas successifs, le rattrapage après plusieurs versions et le fallback vers un snapshot régional. Le bouton « Mise à jour » reste un marqueur non fonctionnel ; aucun protocole de delta ou prétendue fraîcheur n'a été simulé ici.
