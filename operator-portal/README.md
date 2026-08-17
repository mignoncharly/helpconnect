# Portail opérateur privé

Ce package est une application distincte de la PWA publique. Il utilise une passkey WebAuthn provisionnée par l’organisation, puis appelle l’API privée sur le même origin. Il ne doit jamais être servi depuis `dist/` ou l’origin public.

Le navigateur ne stocke aucun token dans Web Storage :

- la session opaque est un cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict` ;
- le jeton CSRF est conservé uniquement en RAM et renouvelé après rechargement ;
- la déconnexion exige une confirmation du serveur et n’affiche pas de faux succès en cas d’échec réseau.

Le reverse proxy doit servir `operator-portal/dist/`, transmettre `/v1/*` à l’API privée sur loopback et appliquer exactement les en-têtes de `security-headers.json`. HTTPS est obligatoire pour WebAuthn et le cookie sécurisé.

```powershell
npm run build:operator
```

L’enrôlement et la récupération de passkeys ne sont volontairement pas des routes publiques. Ils doivent être réalisés par une procédure administrative contrôlée avec vérification d’identité et révocation de l’ancien credential.
