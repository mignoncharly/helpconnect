# Phase 14 — Adaptation réseau

## Résultat

HELP CONNECT adapte maintenant son rendu à la réussite réelle de ses requêtes utiles. Aucun test de débit, aucune requête de sondage et aucune lecture de `navigator.onLine` ou de la Network Information API ne sont utilisés.

Le contrôleur partagé commence en mode normal. Une requête qui n’aboutit pas dans la première seconde est annulée, fait passer le mode automatique à « données réduites », puis reçoit une unique reprise. Si cette reprise n’aboutit pas dans les trois secondes suivantes, le rendu passe en texte seul. Il n’existe jamais de troisième tentative automatique.

## Politique bornée

| Événement observé | Effet |
| --- | --- |
| réponse complète en moins de 1 000 ms | succès rapide réel |
| échec ou timeout de la première tentative | mode réduit et une reprise minimale |
| échec ou timeout de la reprise de 3 000 ms | mode texte, erreur rendue à l’appelant |
| 3 succès rapides consécutifs | remontée automatique d’un seul cran |
| choix explicite `normal`, `réduit` ou `texte` | priorité manuelle jusqu’au rechargement |
| annulation par Panic Wipe | aucune dégradation réseau ni reprise |

La remontée progressive évite qu’une réponse isolée fasse osciller l’interface. L’état automatique continue d’être calculé sous une préférence manuelle, mais ne peut pas la remplacer. Le DOM expose séparément `data-network-mode` et `data-network-mode-source`, ce qui rend cette distinction testable sans stockage persistant.

## Requêtes couvertes

Le délai englobe la réception du corps, pas seulement celle des en-têtes. Il couvre les dictionnaires de langue, la chaîne de confiance, le répertoire et le bootstrap signés, les régions choisies, les fiches de secours demandées, les manifestes, les micro-deltas et les snapshots.

Chaque tentative recrée une requête publique avec les invariants existants : même origin, `GET`, credentials omis, aucun referrer, aucun redirect automatique, aucune query et `no-store`. Le signal d’annulation est propagé au Service Worker pour éviter qu’une requête runtime abandonnée continue volontairement en arrière-plan.

Les erreurs HTTP, réseau et de lecture du corps suivent la même borne. La vérification cryptographique reste ensuite obligatoire avant tout décodage, rendu ou stockage.

## Ordre et sobriété

L’ordre fonctionnel reste celui du plan :

1. le document HTML et son texte de repli ;
2. la feuille CSS critique et le module applicatif ;
3. le répertoire texte et les données urgentes signées du core ;
4. une région cartographique uniquement après action et consentement ;
5. les fiches, langues et mises à jour optionnelles uniquement à la demande.

Le produit ne contient ni animation téléchargée, ni photographie, ni logo raster lourd. Les deux SVG d’interface du core totalisent moins de 1,3 Ko Brotli et le texte vital est disponible indépendamment d’eux. Le mode réduit masque les détails secondaires de la carte ; le mode texte masque toute représentation cartographique mais conserve le répertoire local.

## Correctif de délégation d’événement

L’état du document utilise historiquement `data-network-mode`. Le gestionnaire de clic recherchait auparavant tout ancêtre portant cet attribut ; `<html>` pouvait donc être confondu avec un bouton lors d’un clic dans les paramètres. Le sélecteur exige désormais explicitement `button[data-network-mode]`. Cette correction est indispensable pour qu’un changement de langue ne devienne pas une préférence réseau manuelle implicite.

## Fichiers principaux

- `shared/network-adaptation.js` et `.d.ts` : machine d’état, délais, reprise unique et priorité manuelle ;
- `src/app.ts` : enveloppe adaptative de toutes les requêtes applicatives et rendu des modes ;
- `src/sw.ts` : propagation du signal d’annulation aux fetchs runtime ;
- `test/network-adaptation.test.mjs` : transitions, reprise, récupération, Panic Wipe et absence de sonde ;
- `scripts/offline-smoke.mjs` : réponses retardées contrôlées et preuve navigateur automatique/manuelle.

## Validation

- 80/80 tests Node réussis, dont 7 nouveaux tests d’adaptation réseau ;
- lint et trois typechecks TypeScript stricts réussis ;
- vérification API, builds, signatures, inventaires, privacy et compartimentation réussis ;
- smoke test Chrome réussi avec premier timeout, reprise réussie, double timeout, mode texte, priorité manuelle, parcours offline, cache altéré et Panic Wipe ;
- aucun accès à `navigator.onLine`, `navigator.connection` ou équivalent ;
- aucune requête de speed test et au plus deux tentatives par opération.

## Poids

| Budget | Mesure Brotli | Limite |
| --- | ---: | ---: |
| Transfert initial | 26 154 octets | 200 Ko |
| Core offline | 26 154 octets | 300 Ko |
| Distribution complète | 55 082 octets | 500 Ko |
| JavaScript total | 15 163 octets | 80 Ko |
| CSS total | 3 385 octets | 30 Ko |

L’adaptation ajoute 750 octets Brotli au core, à la distribution complète et au JavaScript par rapport à la Phase 13.

## Références

L’annulation s’appuie sur les primitives `Request`, `AbortController` et `AbortSignal` définies par le [Fetch Standard](https://fetch.spec.whatwg.org/) et le [DOM Standard](https://dom.spec.whatwg.org/#aborting-ongoing-activities).

## Limites restantes

- le timeout décrit l’expérience de la requête utile, pas le débit brut ni la qualité future du réseau ;
- un cache local très rapide est correctement considéré comme un succès, même si Internet reste indisponible ;
- une préférence manuelle est limitée à la page courante et revient en automatique au rechargement ;
- les gates CI de poids propres à chaque Pull Request appartiennent à la Phase 15.

## Arrêt de phase

La Phase 14 est terminée. Aucun travail propre à la Phase 15 — automatisation des tests de poids par Pull Request — n’a été commencé dans cette phase.
