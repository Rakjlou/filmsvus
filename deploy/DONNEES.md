# Transférer et sauvegarder les données

Le format commun est `filmsvus-data-<stamp>.tar.gz` : `films.db`,
`manifest.json` et `posters/`. Les horodatages sont en **UTC**.
Le manifeste compte les films et les **fichiers** d'affiche copiés ; l'export
affiche aussi le nombre de films qui référencent une affiche.
L'import vérifie le SHA-256, l'intégrité SQLite et la version du schéma.
Il fusionne les affiches sans jamais supprimer celles déjà présentes.

1. **Préalable.** Le site doit être créé et `install` terminé, suivant
   [INSTALL.md](INSTALL.md). Garder le service **arrêté**, idéalement faire
   le premier import avant le premier `start`. Ne lancer aucun autre script
   d'écriture ou d'enrichissement pendant l'import et le retour arrière.

2. **Exporter sur le PC**, depuis le dépôt dans Windows PowerShell :

   ```powershell
   npm.cmd run export:data
   ```

   Le serveur de développement peut tourner : `VACUUM INTO` produit un
   instantané SQLite cohérent, y compris les écritures validées dans le WAL.
   **Ne plus faire de modification locale ensuite.** Le script affiche le
   chemin, la taille et les compteurs. Pour choisir une destination :
   `npm.cmd run export:data -- --out C:\Sauvegardes\filmsvus`.
   `DB_PATH` et `POSTERS_DIR` viennent de `.env`, avec les valeurs par défaut
   `data/films.db` et `data/posters`.

3. **Transférer**, en remplaçant `<stamp>` par celui de l'archive affichée :

   ```powershell
   scp data\export\filmsvus-data-<stamp>.tar.gz rak:/tmp/
   ssh rak
   ```

4. **Importer sur le VPS**, dans la session SSH (remplacer `<stamp>`) :

   ```bash
   sudo nginx-site stop filmsvus
   sudo bash /home/filmsvus/site/deploy/manage.sh import-data /tmp/filmsvus-data-<stamp>.tar.gz
   sudo nginx-site start filmsvus
   ```

   L'import refuse un service actif. Il sauvegarde la base précédente et ses
   éventuels fichiers WAL/SHM dans `/home/filmsvus/data/backups/<stamp>/`, puis
   affiche ce chemin. Vérifier dans le navigateur le **nombre de films**, une
   **affiche** et une **fiche**. Après vérification, supprimer les archives
   transférées de `/tmp` :

   ```bash
   rm /tmp/filmsvus-data-*.tar.gz
   ```

5. **Après la bascule, la base du VPS fait foi.** Ne plus ajouter de films
   en local. Réimporter une archive locale écraserait les ajouts faits sur
   le VPS ; la sauvegarde dans `data/backups/` permet de revenir en arrière.

6. **Sens inverse / sauvegarde.** Exporter sur le VPS **en tant que
   `filmsvus`**, même si le service tourne :

   ```bash
   sudo -u filmsvus -H bash -c 'cd /home/filmsvus/site && ~/.local/bin/node --env-file=/home/filmsvus/config/.env scripts/export-data.ts --out /home/filmsvus/data/export'
   ```

   `/home/filmsvus/data` est privé (`0700`) : `scp` avec l'utilisateur SSH ne
   peut pas y entrer. Copier l'archive affichée vers un répertoire temporaire
   privé appartenant à cet utilisateur. Les commandes suivantes s'exécutent
   dans la session `ssh rak` ; remplacer `<stamp>` :

   ```bash
   pull_dir=$(mktemp -d /tmp/filmsvus-backup.XXXXXX)
   sudo install -o "$(id -un)" -g "$(id -gn)" -m 0600 /home/filmsvus/data/export/filmsvus-data-<stamp>.tar.gz "$pull_dir/"
   printf 'Chemin pour scp : %s/filmsvus-data-<stamp>.tar.gz\n' "$pull_dir"
   ```

   Dans **PowerShell sur le PC**, utiliser le chemin affiché :

   ```powershell
   scp rak:/tmp/filmsvus-backup.<suffix>/filmsvus-data-<stamp>.tar.gz .
   ```

   Puis, dans la même session SSH, nettoyer la copie temporaire :

   ```bash
   rm -- "$pull_dir/filmsvus-data-<stamp>.tar.gz"
   rmdir -- "$pull_dir"
   ```

   L'original reste dans `/home/filmsvus/data/export/`. L'archive récupérée
   utilise exactement le même format que l'export local. Pour restaurer sur
   le PC : arrêter le serveur local et les scripts d'écriture, extraire dans
   un dossier temporaire, vérifier le SHA-256 du manifeste et lancer
   `node scripts/check-db.ts <chemin-vers-films.db>`. Mettre de côté la base
   locale et ses éventuels fichiers `-wal`/`-shm`, installer `films.db` dans
   `DB_PATH`, puis copier les affiches dans `POSTERS_DIR` sans supprimer les
   affiches existantes. Ne jamais remettre un ancien WAL à côté de la
   nouvelle base. Redémarrer le serveur local seulement après cette copie.

7. **Ce qui n'est pas transféré.** `.env` (saisir la clé OMDb à la main avec
   `sudoedit /home/filmsvus/config/.env`), le classeur `data/source/`, les
   sauvegardes `.bak`. Le cache OMDb/Wikidata et le compteur de quota du jour
   sont dans la base, donc transférés.

8. **Retour arrière sur le VPS.** Reprendre le chemin de sauvegarde affiché
   par l'import et remplacer `<stamp>` ci-dessous. La base sauvegardée et ses
   fichiers WAL/SHM forment un ensemble : les restaurer ensemble, service
   arrêté. Conserver d'abord une archive de la base courante avec l'étape 6
   si elle contient des ajouts à garder.

   ```bash
   sudo nginx-site stop filmsvus
   sudo bash <<'BASH'
   set -euo pipefail
   backup=/home/filmsvus/data/backups/<stamp>
   data=/home/filmsvus/data
   test -f "$backup/films.db"
   rm -f -- "$data/films.db-wal" "$data/films.db-shm"
   install -o filmsvus -g filmsvus -m 0600 "$backup/films.db" "$data/films.db"
   for suffix in -wal -shm; do
     if [ -f "$backup/films.db$suffix" ]; then
       install -o filmsvus -g filmsvus -m 0600 "$backup/films.db$suffix" "$data/films.db$suffix"
     fi
   done
   BASH
   sudo nginx-site start filmsvus
   ```

   Les affiches restent en place, y compris celles ajoutées par l'import.
   Contrôler à nouveau le nombre de films et une fiche dans le navigateur.
