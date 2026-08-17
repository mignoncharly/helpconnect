Tu vas implémenter **HELP CONNECT** en suivant strictement le plan d’implémentation fourni juste avant ainsi que les wireframes et la documentation du projet.

Avant d’écrire du code :

1. Analyse complètement le codebase existant.
2. Identifie la stack actuelle, l’architecture, les dépendances, le poids du bundle, le fonctionnement PWA/offline et les éventuels risques de sécurité.
3. Compare l’existant avec le plan fourni.
4. Propose un ordre d’exécution par phases sans supprimer de fonctionnalité existante utile.
5. Ensuite, commence l’implémentation **phase par phase**, sans essayer de tout faire d’un coup.

Contraintes prioritaires :

* **Security-first**
* **Offline-first**
* **Ultra-low-bandwidth**
* PWA publique sans compte utilisateur ni collecte de données personnelles.
* Pas de tracking, analytics ou dépendances externes inutiles.
* Pas de géolocalisation automatique.
* Recherche et historique sensibles conservés uniquement temporairement.
* Séparer clairement la PWA publique du futur espace opérateurs/administration.
* Les données de secours affichées doivent gérer validation, date de dernière vérification et expiration.
* Le Panic Wipe doit supprimer autant que possible les données contrôlables par la PWA, sans prétendre pouvoir effacer entièrement le téléphone.
* Mode texte utilisable comme vraie alternative à la carte.
* Carte extrêmement légère, sans Google Maps/Mapbox ou bibliothèque lourde sauf justification exceptionnelle.
* Micro-updates/deltas plutôt que retéléchargement complet des données.
* Fiches de premiers secours réellement disponibles hors ligne.
* Aucun secret ou credential sensible dans le frontend.

### Budget de poids

Considère **500 Ko comme un plafond absolu**, pas comme une cible.

Objectif :

* transfert initial idéal : **≤ 200 Ko**
* core PWA offline : **≤ 300 Ko**
* plafond absolu : **500 Ko**

Ajoute au projet un contrôle automatique du poids du build et fais échouer le build si les limites convenues sont dépassées.

À chaque phase :

* explique brièvement ce que tu as trouvé ;
* indique les fichiers que tu vas modifier ;
* implémente la phase ;
* lance les tests/lint/build pertinents ;
* vérifie la sécurité ;
* vérifie l’impact sur le poids ;
* résume exactement ce qui a changé ;
* indique ce qui reste pour la phase suivante.

Ne fais pas de refonte esthétique arbitraire : respecte les wireframes et les flux fonctionnels fournis.

Commence maintenant uniquement par **l’audit du codebase et la Phase 0 : threat model + architecture + état actuel du poids de la PWA**, puis attends avant de passer à la phase suivante.



