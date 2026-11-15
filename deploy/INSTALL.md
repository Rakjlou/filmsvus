# Déployer Films vus

1. **Préparer le VPS Debian 12.** Installer nginx-site ≥ 1.1 et terminer
   `sudo nginx-site setup nsierra.dev`. Le DNS de `filmsvus.nsierra.dev` doit
   pointer vers le VPS **avant `create`**, qui lance certbot.

   ```bash
   sudo apt-get update
   sudo apt-get install jq curl xz-utils openssl
   ```

   Aucun Node global n'est nécessaire : le hook installe la version de
   `.node-version` dans `/home/filmsvus/.local/node/`, vérifie son SHA-256 et
   crée le lien stable `/home/filmsvus/.local/bin/node`. Node et npm s'exécutent
   sous le compte `filmsvus`, y compris pendant l'installation.

2. **Publier le dépôt.** Le propriétaire choisit et configure le remote, puis
   pousse les commits ; aucun fichier de données ni `.env` ne doit être publié.
   Pour GitHub privé, créer une clé dédiée sur le VPS :

   ```bash
   sudo ssh-keygen -t ed25519 -N '' -f /root/.ssh/filmsvus-deploy
   sudo cat /root/.ssh/filmsvus-deploy.pub
   ```

   Ajouter cette clé publique aux *Deploy keys* du dépôt GitHub, **sans accès
   en écriture**. Ajouter aussi la clé d'hôte GitHub à `/root/.ssh/known_hosts`
   après vérification de son empreinte par un canal de confiance. Utiliser
   l'URL SSH du dépôt et ajouter à `create` les options
   `--identity /root/.ssh/filmsvus-deploy --known-hosts /root/.ssh/known_hosts`.

3. **Créer le site**, en remplaçant `<url>` par le remote :

   ```bash
   sudo nginx-site create app --repo <url> --start "/home/filmsvus/.local/bin/node server/index.ts --production"
   ```

   Pour le dépôt privé, la commande complète est :

   ```bash
   sudo nginx-site create app --repo git@github.com:<proprietaire>/filmsvus.git --identity /root/.ssh/filmsvus-deploy --known-hosts /root/.ssh/known_hosts --start "/home/filmsvus/.local/bin/node server/index.ts --production"
   ```

   Le nom du dépôt doit être `filmsvus`. nginx-site crée le compte, le checkout
   `/home/filmsvus/site`, le port et les métadonnées dans `config/`. Le manifeste
   `nginx-site.json` active les hooks gérés ; le hook remplace l'unité systemd
   initiale. Garder le service arrêté jusqu'à la fin de l'installation.

4. **Créer les accès nginx** (mot de passe saisi deux fois, sans affichage) :

   ```bash
   sudo bash /home/filmsvus/site/deploy/manage.sh set-password fleur
   sudo bash /home/filmsvus/site/deploy/manage.sh set-password noe
   ```

   L'authentification Basic est obligatoire : l'installation refuse un fichier
   de mots de passe absent ou vide. Les hashes APR1 sont dans
   `config/htpasswd`, propriété de `root:www-data`, mode `0640`. Le script permet
   à nginx de traverser le home et `config/` ; `.env` reste privé (`0600`) et
   `data/` reste privé (`0700`). Rejouer la commande pour changer un mot de passe,
   puis `sudo systemctl reload nginx` si le site fonctionne déjà.

5. **Installer**, après inspection de la simulation :

   ```bash
   sudo nginx-site install filmsvus --dry-run
   sudo nginx-site install filmsvus
   sudoedit /home/filmsvus/config/.env
   ```

   Renseigner `OMDB_API_KEY` dans cet éditeur. Sans clé, Wikidata reste utilisable
   pour la recherche, mais l'enrichissement OMDb est indisponible. Les hooks
   préservent les valeurs existantes et ajoutent seulement les clés manquantes.
   `PORT` doit rester identique aux métadonnées nginx-site. La base et les
   affiches vivent dans `/home/filmsvus/data/`, hors du checkout. Le build Vite
   s'exécute sans typecheck sur le VPS ; les trois contrôles locaux restent
   requis avant chaque commit. Les hooks ne démarrent aucun service.

6. **Importer les données locales.** La procédure sera documentée dans
   [deploy/DONNEES.md](DONNEES.md) lors d'une prochaine tâche. Effectuer cet
   import avant de démarrer ; aucun hook ne réimporte ni ne supprime les données.

7. **Démarrer et contrôler** :

   ```bash
   sudo nginx-site start filmsvus
   sudo nginx-site check filmsvus
   sudo nginx-site status filmsvus
   sudo nginx-site logs filmsvus --follow
   ```

   Ouvrir `https://filmsvus.nsierra.dev` et vérifier la demande d'identifiants.
   L'application écoute uniquement sur `127.0.0.1` ; nginx fournit HTTPS et
   l'authentification. `check` teste directement l'API et la SPA sur le port local,
   sans mot de passe nginx. `status` affiche Node, la taille des données et le
   budget OMDb.

8. **Mettre à jour**, après les contrôles locaux et le commit :

   ```bash
   # Sur la machine locale
   git push
   # Sur le VPS
   sudo nginx-site update filmsvus
   ```

   Le checkout du VPS doit rester propre. `node_modules/` et `dist/` sont ignorés
   par Git ; caches, secrets et données restent dans le home, hors du checkout.
   nginx-site gère le rechargement systemd et le redémarrage du service.
   Pour changer Node : modifier `.node-version`, lancer les contrôles locaux,
   commiter, pousser, puis mettre à jour. Les anciennes versions restent dans
   `/home/filmsvus/.local/node/` et peuvent être supprimées à la main lorsqu'elles
   ne servent plus ; conserver celle visée par `.local/bin/node`.

9. **Enrichir par petits lots** sur le VPS :

   ```bash
   sudo -u filmsvus -H bash -c 'cd /home/filmsvus/site && ~/.local/bin/node --env-file=/home/filmsvus/config/.env scripts/hydrate.ts --limit 20'
   ```

   Cette commande peut tourner pendant le service : SQLite utilise WAL et
   `busy_timeout`, et le budget OMDb est partagé dans la même base.
