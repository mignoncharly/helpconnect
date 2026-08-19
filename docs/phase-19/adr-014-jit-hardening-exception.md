# ADR-014 — Exception de durcissement pour le JIT de l'API opérateur

Statut : **acceptée**, 18 août 2026. Portée : unité systemd de l'API opérateur
privée uniquement. La PWA publique n'est pas concernée : elle est servie en
statique par nginx et n'exécute aucun processus applicatif sur l'hôte.

## Contexte

L'unité `helpconnect-operator-api.service` applique un durcissement systemd
large, dont `MemoryDenyWriteExecute=yes` : aucune page mémoire ne peut être à la
fois inscriptible et exécutable.

Le service n'a jamais démarré sur la production. Le dossier Phase 19 l'a
d'abord attribué au refus délibéré d'un registre d'opérateurs vide
(`operator-api/src/security-core.mjs`), qui est une cause réelle mais distincte.
Le journal a tranché :

```
Fatal error
Check failed: 12 == errno
v8::internal::OS::SetPermissions
```

`errno 12` est `ENOMEM`, renvoyé par `mprotect` lorsque la politique interdit la
transition vers une page exécutable. V8 alloue ces pages au démarrage pour son
JIT : le processus meurt avant d'ouvrir son socket. systemd a enregistré
`status=5/TRAP`, `Result=core-dump`, et la politique `Restart=on-failure` a
produit une boucle de redémarrage — 18 tentatives observées le 18 août 2026.

La conséquence opérationnelle est directe : sans démarrage possible, aucune
cérémonie d'enrôlement ne peut avoir lieu, donc aucune passkey ne peut être
provisionnée, donc l'API ne peut jamais sortir de son registre vide.

## Options considérées

**Conserver `MemoryDenyWriteExecute=yes` et changer de runtime.** Un runtime
sans JIT satisferait la directive. Cela reviendrait à réécrire l'API opérateur
dans un autre langage pour une seule directive de confinement, alors que le
reste du système — vérification de signatures, store transactionnel, adaptateur
WebAuthn — est écrit et testé en JavaScript.

**Désactiver `--jitless` côté Node.** V8 propose un mode sans JIT. Il n'est pas
exposé de façon stable pour un serveur HTTP long, dégrade nettement les
performances, et déplacerait un problème de configuration système vers un
drapeau de runtime peu documenté, plus difficile à auditer qu'une ligne
d'unité.

**Lever la seule directive incompatible, dans un drop-in dédié et commenté.**
L'exception devient un artefact isolé, lisible, qui ne peut pas être confondu
avec un relâchement général du durcissement.

## Décision

Un drop-in `10-jit.conf` lève `MemoryDenyWriteExecute` et **rien d'autre** :

```ini
[Service]
MemoryDenyWriteExecute=no
```

Toutes les autres protections restent en vigueur et sont vérifiées
mécaniquement : `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`,
`PrivateTmp`, `PrivateDevices`, `ProtectKernelTunables`, `ProtectKernelModules`,
`ProtectControlGroups`, `RestrictAddressFamilies`, `RestrictNamespaces`,
`LockPersonality`, `SystemCallFilter=@system-service`,
`SystemCallArchitectures=native`, `UMask=0077`, et le confinement des écritures
à `ReadWritePaths=/var/lib/helpconnect`.

Le drop-in est installé par le kit de déploiement en même temps que l'unité :
une réinstallation qui poserait l'unité sans son exception reproduirait la
boucle de redémarrage.

## Conséquences

Ce qui est perdu : un attaquant disposant déjà d'une exécution de code dans le
processus peut allouer une page exécutable. La directive ne protégeait pas
contre l'obtention initiale de cette exécution ; elle en limitait
l'exploitation. Cette perte est inhérente à tout runtime JIT — la conserver
aurait exigé de ne pas utiliser Node.

Ce qui est conservé : le processus reste sans privilèges, sans accès au reste du
système de fichiers, sans possibilité d'élever ses droits, limité à `AF_INET` et
`AF_UNIX`, et ne peut écrire que dans le répertoire de son store.

Ce qui est exigé en contrepartie : l'exception n'est pas déclarée, elle est
prouvée. `phase-19/verify-api-runtime.sh` démarre un service **transitoire**
reprenant les directives de l'unité réelle, sur un store isolé et un port
distinct, vérifie que l'API répond réellement — 403 sur un jeton invalide, 200
sur le jeton valide, 503 sur les autres routes tant que le registre est vide —
et échantillonne `ActiveState`, `NRestarts` et `Result` sur plusieurs minutes.
La preuve `api-runtime-hardening` du dossier Phase 19 porte ce verdict, et la
production n'est jamais sollicitée pour l'obtenir.
