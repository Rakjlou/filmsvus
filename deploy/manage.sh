#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

require_tools() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || fail "Required tool not found: $tool"
  done
}

require_root() { [[ $EUID -eq 0 ]] || fail 'This command requires root (use sudo).'; }

init_paths() {
  PROJECT=${NGINX_SITE_PROJECT:-filmsvus}
  [[ $PROJECT =~ ^[a-z][a-z0-9_-]{0,30}$ ]] || fail 'Invalid project name.'
  APP_HOME=${NGINX_SITE_HOME:-/home/$PROJECT}
  APP_ROOT=${NGINX_SITE_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)}
  local path
  for path in "$APP_HOME" "$APP_ROOT"; do
    # Paths are also written to nginx, systemd and an environment file.
    [[ $path =~ ^/[A-Za-z0-9_./-]+$ && $path != / && $path != */ && $path != *//* && ! $path =~ /\.\.?(/|$) ]] ||
      fail 'Home and checkout must be absolute paths without spaces or dot components.'
    [[ -d $path ]] || fail "Directory missing: $path"
  done
  [[ $APP_ROOT != "$APP_HOME/data" && $APP_ROOT != "$APP_HOME/data/"* && $APP_HOME != "$APP_ROOT" && $APP_HOME != "$APP_ROOT/"* ]] ||
    fail 'The data directory must be outside the checkout.'
  require_tools id
  id -u "$PROJECT" >/dev/null 2>&1 || fail "System user does not exist: $PROJECT"
  CONFIG_DIR=$APP_HOME/config
  ENV_FILE=$CONFIG_DIR/.env
}

read_metadata() {
  require_tools jq
  local metadata=$CONFIG_DIR/nginx-site.json label
  [[ -f $metadata ]] || fail "Missing $metadata; create the site with nginx-site first."
  PORT=$(jq -er '.port | select(type == "number") | select(. == floor and . >= 1024 and . <= 65535)' "$metadata") ||
    fail 'Metadata port must be an integer between 1024 and 65535.'
  [[ $PORT =~ ^[0-9]+$ ]] || fail 'Invalid metadata port.'
  DOMAIN=$(jq -er '.domain | select(type == "string")' "$metadata") || fail 'Missing metadata domain.'
  [[ ${#DOMAIN} -le 253 && $DOMAIN == *.* && $DOMAIN =~ ^[A-Za-z0-9.-]+$ && $DOMAIN != *. ]] || fail 'Invalid metadata domain.'
  local -a labels
  IFS=. read -ra labels <<< "$DOMAIN"
  for label in "${labels[@]}"; do
    [[ $label =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || fail 'Invalid metadata domain label.'
  done
}

read_version() {
  require_tools tr uname
  [[ -f $APP_ROOT/.node-version ]] || fail 'Missing .node-version.'
  VERSION=$(tr -d '[:space:]' < "$APP_ROOT/.node-version")
  [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid .node-version (expected x.y.z).'
  case $(uname -m) in
    x86_64) ARCH=x64 ;;
    aarch64) ARCH=arm64 ;;
    *) fail 'Only Linux x86_64 and aarch64 are supported.' ;;
  esac
  NODE_DIR=$APP_HOME/.local/node/v$VERSION
}

# Read simple EnvironmentFile assignments without executing or sourcing secrets.
env_value() {
  local key=$1 line value found=1
  [[ -f $ENV_FILE ]] || return 1
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    if [[ $line =~ ^[[:space:]]*$key[[:space:]]*=(.*)$ ]]; then
      value=${BASH_REMATCH[1]}
      value=${value#"${value%%[![:space:]]*}"}
      value=${value%"${value##*[![:space:]]}"}
      if [[ $value == \"*\" || $value == \'*\' ]]; then value=${value:1:${#value}-2}; fi
      found=0
    fi
  done < "$ENV_FILE"
  [[ $found -eq 0 ]] || return 1
  printf '%s' "$value"
}

validate_env_port() {
  local existing
  if existing=$(env_value PORT); then
    [[ $existing == "$PORT" ]] || fail 'Existing PORT differs from nginx-site metadata; reconcile it before installing.'
  fi
}

as_project() {
  runuser -u "$PROJECT" -- env HOME="$APP_HOME" \
    NGINX_SITE_PROJECT="$PROJECT" NGINX_SITE_HOME="$APP_HOME" NGINX_SITE_ROOT="$APP_ROOT" \
    PATH="$NODE_DIR/bin:/usr/local/bin:/usr/bin:/bin" npm_config_cache="$APP_HOME/.npm" \
    bash "$APP_ROOT/deploy/manage.sh" "$@"
}

require_project() {
  [[ $EUID -ne 0 && $(id -un) == "$PROJECT" ]] || fail "Run this command as $PROJECT, never as root."
}

install_node() (
  require_project
  require_tools curl tar xz sha256sum mktemp mkdir mv rm ln flock
  read_version
  umask 022
  mkdir -p -- "$APP_HOME/.local/node" "$APP_HOME/.local/bin"
  exec 8>"$APP_HOME/.local/node/.install.lock"
  flock 8
  local work='' stage='' archive expected checksum filename name backup
  trap '[[ -z $work ]] || rm -rf -- "$work"; [[ -z $stage ]] || rm -rf -- "$stage"' EXIT
  if [[ ! -x $NODE_DIR/bin/node ]] || [[ $("$NODE_DIR/bin/node" --version) != "v$VERSION" ]]; then
    work=$(mktemp -d)
    filename=node-v$VERSION-linux-$ARCH.tar.xz
    archive=$work/$filename
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
      "https://nodejs.org/dist/v$VERSION/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
      "https://nodejs.org/dist/v$VERSION/$filename" -o "$archive"
    expected=''
    while read -r checksum name; do
      if [[ $name == "$filename" ]]; then
        [[ -z $expected && $checksum =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Invalid or duplicate Node checksum.'
        expected=$checksum
      fi
    done < "$work/SHASUMS256.txt"
    [[ -n $expected ]] || fail 'Node archive not found in SHASUMS256.txt.'
    printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status || fail 'Node checksum verification failed.'
    stage=$(mktemp -d "$APP_HOME/.local/node/.staging-v$VERSION.XXXXXX")
    tar -xJf "$archive" --strip-components=1 -C "$stage"
    [[ $("$stage/bin/node" --version) == "v$VERSION" ]] || fail 'Downloaded Node version does not match.'
    if [[ -e $NODE_DIR || -L $NODE_DIR ]]; then
      backup=$(mktemp -d "$APP_HOME/.local/node/.replaced-v$VERSION.XXXXXX")
      mv -- "$NODE_DIR" "$backup/node"
    fi
    mv -- "$stage" "$NODE_DIR"
    stage=''
  fi
  ln -sfnT -- "$NODE_DIR/bin/node" "$APP_HOME/.local/bin/node"
  printf 'Node v%s installed.\n' "$VERSION"
)

build_app() {
  require_project
  read_version
  cd -- "$APP_ROOT"
  npm ci --no-audit --no-fund
  node_modules/.bin/vite build --config vite.config.ts
}

append_env() {
  local key=$1 value=$2
  if ! env_value "$key" >/dev/null; then printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"; fi
}

install_app() {
  require_root
  require_tools curl tar xz sha256sum openssl jq flock runuser install grep tail chown chmod mktemp mkdir mv rm ln
  read_metadata
  read_version
  [[ -f $CONFIG_DIR/nginx.conf ]] || fail 'Missing nginx.conf.'
  local line include_found=false include_pattern='^[[:space:]]*include[[:space:]]+([^[:space:];]+)[[:space:]]*;'
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $line =~ $include_pattern && ${BASH_REMATCH[1]} == "$CONFIG_DIR/nginx.d/*.conf" ]]; then include_found=true; fi
  done < "$CONFIG_DIR/nginx.conf"
  [[ $include_found == true ]] || fail "nginx.conf must include $CONFIG_DIR/nginx.d/*.conf inside its server block."
  [[ -s $CONFIG_DIR/htpasswd ]] ||
    fail "Basic auth is required. Run: sudo bash $APP_ROOT/deploy/manage.sh set-password <user>"
  id -u www-data >/dev/null 2>&1 || fail 'The nginx worker account www-data is missing.'
  validate_env_port

  # Only mutate files after every preflight check, including auth and PORT.
  exec 9>"$CONFIG_DIR/.filmsvus-manage.lock"
  flock 9
  as_project _install-node
  as_project _build
  install -d -o "$PROJECT" -g "$PROJECT" -m 0700 "$APP_HOME/data" "$APP_HOME/data/posters"
  if [[ ! -e $ENV_FILE ]]; then install -o "$PROJECT" -g "$PROJECT" -m 0600 /dev/null "$ENV_FILE"; fi
  chown "$PROJECT:$PROJECT" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  if [[ -s $ENV_FILE && -n $(tail -c 1 "$ENV_FILE") ]]; then printf '\n' >> "$ENV_FILE"; fi
  append_env NODE_ENV production
  append_env PORT "$PORT"
  append_env DB_PATH "$APP_HOME/data/films.db"
  append_env POSTERS_DIR "$APP_HOME/data/posters"
  append_env OMDB_DAILY_BUDGET 900
  append_env OMDB_API_KEY ''
  if [[ -z $(env_value OMDB_API_KEY) ]]; then
    printf 'Warning: OMDB_API_KEY is empty; search uses Wikidata only and OMDb hydration is unavailable.\n' >&2
  fi
  chown root:www-data "$CONFIG_DIR/htpasswd"
  chmod 0640 "$CONFIG_DIR/htpasswd"
  # nginx must traverse these directories, including homes created with mode 0700.
  # This grants traversal only; .env stays private and data stays mode 0700.
  chmod o+x "$APP_HOME" "$CONFIG_DIR"
  install -d -o root -g root -m 0755 "$CONFIG_DIR/nginx.d"
  install -o root -g root -m 0644 /dev/stdin "$CONFIG_DIR/nginx.d/filmsvus-auth.conf" <<EOF
auth_basic "Films vus";
auth_basic_user_file $CONFIG_DIR/htpasswd;
EOF
  install -o root -g root -m 0644 /dev/stdin "/etc/systemd/system/$PROJECT.service" <<EOF
[Unit]
Description=Films vus
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$PROJECT
Group=$PROJECT
WorkingDirectory=$APP_ROOT
EnvironmentFile=$ENV_FILE
ExecStart=$APP_HOME/.local/bin/node server/index.ts --production
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$APP_HOME/data
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
  printf 'Installed for https://%s. Next steps:\n' "$DOMAIN"
  printf '  sudoedit %s  # set OMDB_API_KEY\n' "$ENV_FILE"
  printf '  Import your data (see deploy/DONNEES.md).\n'
  printf '  sudo nginx-site start %s\n' "$PROJECT"
}

check_app() {
  require_project
  require_tools curl jq grep
  read_metadata
  local html
  curl --fail --silent --show-error --max-time 3 --retry 10 --retry-delay 1 \
    --retry-connrefused --retry-max-time 20 "http://127.0.0.1:$PORT/api/viewers" |
    jq -e 'type == "array"' >/dev/null
  html=$(curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:$PORT/")
  printf '%s' "$html" | grep -Eiq '<!doctype html>|<html' || fail 'GET / did not return SPA HTML.'
  printf '%s' "$html" | grep -Eq "id=[\"']root[\"']" || fail 'SPA root element is missing.'
  printf 'OK: API and production SPA respond on 127.0.0.1:%s.\n' "$PORT"
}

status_app() {
  require_project
  require_tools curl jq du
  read_metadata
  printf 'Node: '
  "$APP_HOME/.local/bin/node" --version
  du -sh -- "$APP_HOME/data"
  curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:$PORT/api/omdb/budget" | jq .
}

set_password() (
  require_root
  require_tools openssl flock mktemp chown chmod mv rm
  local username=${1:-} password='' repeated='' hash temporary=''
  [[ $username =~ ^[A-Za-z0-9._-]{1,32}$ ]] || fail 'Username must contain 1-32 letters, digits, dots, underscores or hyphens.'
  [[ -d $CONFIG_DIR ]] || fail 'Missing config directory; create the site with nginx-site first.'
  if [[ -t 0 ]]; then
    IFS= read -rsp 'Password: ' password || fail 'Could not read password.'
    printf '\n' >&2
    IFS= read -rsp 'Repeat password: ' repeated || fail 'Could not read repeated password.'
    printf '\n' >&2
    [[ $password == "$repeated" ]] || fail 'Passwords do not match.'
  else
    IFS= read -r password || true
  fi
  [[ -n $password ]] || fail 'Empty passwords are not allowed.'
  hash=$(printf '%s\n' "$password" | openssl passwd -apr1 -stdin)
  unset password repeated
  [[ $hash == '$apr1$'* && $hash != *$'\n'* ]] || fail 'Password hashing failed.'
  umask 077
  exec 9>"$CONFIG_DIR/.filmsvus-manage.lock"
  flock 9
  trap '[[ -z $temporary ]] || rm -f -- "$temporary"' EXIT
  temporary=$(mktemp "$CONFIG_DIR/.htpasswd.XXXXXX")
  if [[ -f $CONFIG_DIR/htpasswd ]]; then
    local line
    while IFS= read -r line || [[ -n $line ]]; do
      [[ ${line%%:*} == "$username" ]] || printf '%s\n' "$line" >> "$temporary"
    done < "$CONFIG_DIR/htpasswd"
  fi
  printf '%s:%s\n' "$username" "$hash" >> "$temporary"
  chown root:www-data "$temporary"
  chmod 0640 "$temporary"
  mv -f -- "$temporary" "$CONFIG_DIR/htpasswd"
  temporary=''
  chmod o+x "$APP_HOME" "$CONFIG_DIR"
  printf 'Password saved for %s. If the site is running: sudo systemctl reload nginx\n' "$username"
)

require_service_stopped() {
  local state
  state=$(systemctl is-active "$PROJECT.service") || true
  case $state in
    inactive|failed) ;;
    active|activating|deactivating|reloading) fail "Service is not stopped. Run: sudo nginx-site stop $PROJECT" ;;
    *) fail "Cannot confirm that $PROJECT.service is stopped (state: $state). Check the installation and systemd." ;;
  esac
}

import_data() (
  require_root
  require_tools tar jq sha256sum systemctl runuser mktemp install chown chmod cp mv rm mkdir date flock
  local archive=$1 work='' stage listing verbose entry normalized kind line expected actual checked films posters backup=''
  [[ -f $archive && ! -L $archive ]] || fail 'The archive must be a regular file.'
  [[ -x $APP_HOME/.local/bin/node ]] || fail 'Install the application first (Node is missing).'
  [[ -d $CONFIG_DIR ]] || fail 'Install the application first (config is missing).'
  exec 9>"$CONFIG_DIR/.filmsvus-manage.lock"
  flock 9
  require_service_stopped
  umask 077
  work=$(mktemp -d)
  trap '[[ -z $work ]] || rm -rf -- "$work"' EXIT
  # Freeze the input before validation; never extract from an operator-writable archive.
  cp -- "$archive" "$work/archive.tar.gz"
  archive=$work/archive.tar.gz
  listing=$(LC_ALL=C tar -tzf "$archive") || fail 'Cannot list archive.'
  verbose=$(LC_ALL=C tar -tvzf "$archive") || fail 'Cannot inspect archive types.'
  [[ -n $listing && -n $verbose ]] || fail 'Empty archive.'
  local -A seen=()
  while IFS= read -r entry; do
    [[ $entry =~ ^(\./)?(films\.db|manifest\.json|posters/?|posters/[A-Za-z0-9._-]+)$ ]] ||
      fail "Unsafe archive entry: $entry"
    normalized=${entry#./}
    [[ $normalized != posters/. && $normalized != posters/.. ]] || fail 'Dot components are forbidden.'
    normalized=${normalized%/}
    [[ ! ${seen[$normalized]+present} ]] || fail "Duplicate archive entry: $entry"
    seen[$normalized]=1
  done <<< "$listing"
  [[ ${seen[films.db]+present} && ${seen[manifest.json]+present} && ${seen[posters]+present} ]] ||
    fail 'Archive must contain films.db, manifest.json and posters/.'
  while IFS= read -r line; do
    kind=${line:0:1}
    [[ $kind == '-' || $kind == d ]] || fail 'Archive links and special files are forbidden.'
  done <<< "$verbose"
  stage=$work/content
  mkdir -- "$stage"
  tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$stage"
  [[ -f $stage/films.db && -f $stage/manifest.json && -d $stage/posters ]] || fail 'Invalid archive layout.'
  jq -e 'type == "object" and .format == 1 and
    (.sha256["films.db"] | type == "string" and test("^[a-f0-9]{64}$")) and
    (.films | type == "number" and . >= 0 and . == floor) and
    (.posters | type == "number" and . >= 0 and . == floor) and
    (.user_version | type == "number" and . >= 0 and . == floor)' "$stage/manifest.json" >/dev/null ||
    fail 'Invalid manifest.'
  expected=$(jq -r '.sha256["films.db"]' "$stage/manifest.json")
  actual=$(sha256sum -- "$stage/films.db")
  [[ ${actual%% *} == "$expected" ]] || fail 'Database SHA-256 mismatch.'
  # The app-owned Node executable must NEVER execute as root.
  chmod 0711 "$work"
  chmod 0700 "$stage" "$stage/posters"
  chmod 0600 "$stage/films.db" "$stage/manifest.json"
  chown -R "$PROJECT:$PROJECT" "$stage"
  checked=$(runuser -u "$PROJECT" -- "$APP_HOME/.local/bin/node" "$APP_ROOT/scripts/check-db.ts" "$stage/films.db") ||
    fail 'Database validation failed.'
  films=$(jq -er '.films' <<< "$checked")
  [[ $films == "$(jq -r '.films' "$stage/manifest.json")" ]] || fail 'Film count differs from manifest.'
  [[ $(jq -r '.user_version' <<< "$checked") == "$(jq -r '.user_version' "$stage/manifest.json")" ]] ||
    fail 'Database version differs from manifest.'
  posters=0
  local poster suffix
  shopt -s nullglob dotglob
  for poster in "$stage/posters/"*; do
    [[ -f $poster && ! -L $poster ]] || fail 'Posters must be regular files.'
    posters=$((posters + 1))
  done
  [[ $posters == "$(jq -r '.posters' "$stage/manifest.json")" ]] || fail 'Poster count differs from manifest.'
  require_service_stopped

  install -d -o "$PROJECT" -g "$PROJECT" -m 0700 "$APP_HOME/data" "$APP_HOME/data/posters"
  if [[ -e $APP_HOME/data/films.db ]]; then
    install -d -o "$PROJECT" -g "$PROJECT" -m 0700 "$APP_HOME/data/backups"
    backup=$(mktemp -d "$APP_HOME/data/backups/$(date -u +%Y%m%d-%H%M%S).XXXXXX")
    chown "$PROJECT:$PROJECT" "$backup"
    for suffix in '' -wal -shm; do
      if [[ -e $APP_HOME/data/films.db$suffix || -L $APP_HOME/data/films.db$suffix ]]; then
        mv -- "$APP_HOME/data/films.db$suffix" "$backup/"
      fi
    done
  fi
  rm -f -- "$APP_HOME/data/films.db-wal" "$APP_HOME/data/films.db-shm"
  install -o "$PROJECT" -g "$PROJECT" -m 0600 "$stage/films.db" "$APP_HOME/data/films.db"
  for poster in "$stage/posters/"*; do
    install -o "$PROJECT" -g "$PROJECT" -m 0600 "$poster" "$APP_HOME/data/posters/${poster##*/}"
  done
  printf 'Imported: %s films, %s posters. Backup: %s\n' "$films" "$posters" "${backup:-none (no previous database)}"
  printf 'Next step: sudo nginx-site start %s\n' "$PROJECT"
)

usage() {
  printf 'Usage: bash deploy/manage.sh {install|update|check|status|set-password <user>|import-data <archive.tar.gz>}\n' >&2
}

main() {
  local command=${1:-}
  case $command in
    install|update|check|status|_install-node|_build) [[ $# -eq 1 ]] || { usage; return 1; } ;;
    set-password|import-data) [[ $# -eq 2 ]] || { usage; return 1; } ;;
    *) usage; return 1 ;;
  esac
  init_paths
  case $command in
    install|update) install_app ;;
    check) check_app ;;
    status) status_app ;;
    set-password) set_password "$2" ;;
    import-data) import_data "$2" ;;
    _install-node) install_node ;;
    _build) build_app ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
