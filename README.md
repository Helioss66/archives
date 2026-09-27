# Archives

PWA personnelle pour retrouver, trier et enrichir ce qui est sauvegardé dans des collections Instagram privées (films, cuisine, apprentissage, IA, et d'autres collections ajoutables). Chaque personne qui se connecte a son propre espace de données, séparé des autres.

Stack : HTML/CSS/JS vanilla (aucune étape de build), Supabase (Postgres + Auth par lien magique par email), PWA installable avec ajout rapide depuis le menu de partage Android.

## Mise en place (à faire une seule fois)

### 1. Créer le projet Supabase

1. Aller sur https://supabase.com, se connecter avec GitHub, créer un nouveau projet (nom, mot de passe de base de données, région)
2. Une fois le projet prêt, aller dans **SQL Editor** → coller le contenu du fichier `schema.sql` de ce dossier → Run
3. Aller dans **Project Settings → API** → copier **Project URL** et la clé **anon public**
4. Coller ces valeurs dans `supabase-config.js` à la racine de ce dossier (ces clés ne sont pas secrètes, la sécurité vient des règles RLS de l'étape 2)
5. L'authentification par email (lien magique) est activée par défaut, rien à configurer en plus

### 2. Tester en local

Les modules ES et le service worker exigent un vrai serveur (pas d'ouverture directe du fichier `index.html`) :

```
npx serve .
```

puis ouvrir l'URL affichée.

### 3. Déployer sur Netlify

Glisser-déposer ce dossier sur https://app.netlify.com/drop, ou connecter le dépôt GitHub du projet. Aucune commande de build n'est nécessaire (dossier de publication = racine).

### 4. Première connexion

À la première connexion, 4 collections par défaut sont créées automatiquement (Films, Cuisine, Apprentissage, IA). Le bouton **Réglages → Importer les données de démo** charge les 103 items d'origine (issus de l'export Instagram de Hugo) — à utiliser uniquement sur le compte de Hugo, pas sur celui des autres utilisateurs.

## Ajout rapide depuis Instagram (Android)

Une fois l'appli installée sur l'écran d'accueil (bouton "Ajouter à l'écran d'accueil" du navigateur), elle apparaît directement dans le menu **Partager** d'Instagram. Le lien partagé pré-remplit automatiquement le formulaire d'ajout.

Cette fonctionnalité (Web Share Target) fonctionne sur Chrome/Edge Android. Elle n'existe pas sur iOS Safari — non traitée dans cette version.

## Hors ligne

Les dernières données synchronisées sont mises en cache localement (`localStorage`) et s'affichent même sans réseau. En revanche, ajouter/modifier/supprimer un élément demande une connexion (pas de file d'attente d'écritures hors-ligne dans cette version) : un message d'erreur s'affiche si l'action échoue faute de réseau.

## Limites connues

- Pas d'icône PNG générée (aucun outil de conversion d'image disponible côté build) : l'icône SVG fonctionne partout sauf pour l'icône d'écran d'accueil iOS, qui a besoin d'un PNG dédié
- Supabase reste gratuit dans la limite de son offre gratuite (largement suffisante pour un usage personnel + quelques proches) ; au-delà d'un usage à grande échelle, ça deviendrait payant
- Écritures hors-ligne non mises en file d'attente (voir section "Hors ligne" ci-dessus)
