# Fiche terrain Android — Phase 16

Cette fiche ferme les lignes que Chrome DevTools ne peut pas prouver : téléphone Android physique d’entrée de gamme, faible RAM et lisibilité avec une forte luminosité. Une émulation desktop ou un AVD ne doit jamais être consigné comme appareil physique.

## Préconditions

- utiliser un téléphone Android physique destiné au test, sans donnée personnelle ;
- RAM annoncée inférieure ou égale à 3 Go et écran de largeur CSS inférieure ou égale à 360 px ;
- installer la version exacte de `dist/` produite par `npm run build` sur une origin HTTPS de test ;
- vider les données du site avant le départ ;
- régler la luminosité au maximum et effectuer le contrôle de lisibilité en extérieur ou sous une lumière forte ;
- préparer un profil réseau 2G avec 1 à 3 secondes de latence, pertes élevées et coupures contrôlées ;
- ne saisir aucun nom, numéro, position réelle ou autre donnée personnelle dans la preuve.

## Identification non sensible

| Champ | Valeur terrain |
| --- | --- |
| Date UTC | |
| Hash du build testé | |
| Modèle commercial | |
| Version Android | |
| RAM annoncée | |
| Largeur × hauteur CSS | |
| Navigateur et version | |
| Observateur | initiales ou identifiant d’équipe, jamais une identité personnelle |

Ne pas enregistrer le numéro de série, IMEI, Android ID, adresse IP, position GPS ni identifiant publicitaire.

## Matrice obligatoire

| Condition | Mesure attendue | Résultat |
| --- | --- | --- |
| Android entrée de gamme | téléphone physique confirmé | |
| RAM faible | ≤ 3 Go annoncés | |
| CPU faible | appareil d’entrée de gamme, aucune accélération desktop | |
| 2G simulée | débit descendant ≤ 64 kbit/s, montant ≤ 32 kbit/s | |
| Latence | 1 000–3 000 ms | |
| Pertes élevées | ≥ 30 % des requêtes d’update volontairement interrompues | |
| Internet intermittent | au moins une coupure puis reprise | |
| Totalement hors ligne | mode avion ou route bloquée | |
| JavaScript lent | parcours effectué sur le CPU réel de l’appareil | |
| Stockage presque plein | espace/quota restant ≤ 128 Kio pour l’origin si le navigateur permet ce réglage ; sinon limite documentée | |
| Petit écran | largeur CSS ≤ 360 px, aucun défilement horizontal | |
| Forte luminosité | 100 %, contenu critique lisible sous forte lumière | |
| Thème sombre | activé et lisible | |
| Langues | français, anglais et ourdou ; ourdou en RTL | |

Un résultat non mesurable reste `NOT_RUN` ou `BLOCKED`, jamais `PASS` par inférence.

## Scénario critique, ordre immuable

1. Charger HELP CONNECT et installer la région ainsi que les fiches de secours.
2. Couper Internet.
3. Fermer complètement le navigateur.
4. Rouvrir le navigateur sans réseau.
5. Rechercher « hôpital » et obtenir le résultat local.
6. Ouvrir la fiche « Hémorragie sévère » hors ligne.
7. Basculer en mode texte et vérifier que la carte visuelle disparaît.
8. Réactiver un Internet très lent et intermittent.
9. Recevoir le delta signé jusqu’à la version attendue sans perdre le mode texte.
10. Déclencher Panic Wipe sans confirmation.
11. Inspecter CacheStorage, IndexedDB, LocalStorage, SessionStorage et les registrations Service Worker : tous doivent être vides ou supprimés.

Chaque étape reçoit uniquement `PASS` ou `FAIL`, accompagnée d’une note factuelle courte. Un échec arrête le scénario et la Phase 17 ne commence pas.

## Critères de clôture

La Phase 16 peut être déclarée terminée seulement lorsque :

- les quatorze lignes de la matrice ont une preuve ;
- les onze étapes passent dans l’ordre sur le téléphone physique ;
- la purge finale constate zéro cache, zéro base IndexedDB, zéro entrée Web Storage et zéro registration Service Worker ;
- aucune capture ou note ne contient de donnée personnelle ;
- le rapport terrain référence le hash exact du build.

