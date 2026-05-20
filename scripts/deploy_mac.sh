#!/usr/bin/env bash
#
# Local-dev "deploy" of sorghum-webapp on a macOS laptop. Mirrors the
# Rocky/RHEL deploy.sh but adapted for a single-user Mac:
#
#   - Operates against the existing checkout (no git clone/pull of the
#     main repo). Pass APP_DIR=... to override.
#   - Homebrew for redis (and optionally node). Docker Desktop is detected
#     but not auto-installed.
#   - No service user, no systemd, no /var/log, no cron.
#   - Env file lives at $APP_DIR/.sorghum.env (gitignored).
#   - Runs gunicorn in the foreground at the end (Ctrl-C to stop).
#
# Idempotent: safe to re-run. Re-runs do `pip install -r requirements.txt`,
# rebuild the parcel bundle, and restart gunicorn.
#
# Required environment variables (set in your shell before running):
#   TYPESENSE_API_KEY   long random string. openssl rand -hex 32
#   SB_WP_USERNAME      WordPress admin (used by /update_publications POSTs)
#   SB_WP_PASSWORD      ditto
#
# Optional (with defaults):
#   APP_DIR             <repo root resolved from script path>
#   GUNICORN_BIND       127.0.0.1:5001   (5000 collides with macOS AirPlay Receiver)
#   GUNICORN_WORKERS    2
#   GUNICORN_THREADS    2
#   WP_BASE_URL         https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/
#   TYPESENSE_PORT      8108
#   WPORM_REPO_URL      https://github.com/warelab/wordpress_orm
#   WPORM_BRANCH        master
#   SKIP_RUN            1 to install/build only, do not exec gunicorn
#   SKIP_TYPESENSE      1 to skip starting the typesense container
#   SKIP_BUILD          1 to skip `npm ci && npm run build`

set -euo pipefail
shopt -s inherit_errexit 2>/dev/null || true

: "${TYPESENSE_API_KEY:?TYPESENSE_API_KEY must be set in the calling env}"
: "${SB_WP_USERNAME:?SB_WP_USERNAME must be set in the calling env}"
: "${SB_WP_PASSWORD:?SB_WP_PASSWORD must be set in the calling env}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

GUNICORN_BIND="${GUNICORN_BIND:-127.0.0.1:5001}"
GUNICORN_WORKERS="${GUNICORN_WORKERS:-2}"
GUNICORN_THREADS="${GUNICORN_THREADS:-2}"
WP_BASE_URL="${WP_BASE_URL:-https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/}"
TYPESENSE_PORT="${TYPESENSE_PORT:-8108}"
WPORM_REPO_URL="${WPORM_REPO_URL:-https://github.com/warelab/wordpress_orm}"
WPORM_BRANCH="${WPORM_BRANCH:-master}"

FLASK_DIR="${APP_DIR}/sorghum_webapp"
SEARCH_DIR="${APP_DIR}/search_app"
VENV_DIR="${APP_DIR}/venv"
WPORM_DIR="${APP_DIR}/wordpress_orm"
ENV_FILE="${APP_DIR}/.sorghum.env"

log()  { printf '\033[1;34m[deploy-mac]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy-mac]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[deploy-mac]\033[0m %s\n' "$*" >&2; exit 1; }

check_macos() {
    [ "$(uname -s)" = "Darwin" ] || die "this script is macOS-only; use scripts/deploy.sh for Linux"
    log "macOS $(sw_vers -productVersion 2>/dev/null || echo '?') / $(uname -m)"
}

# Since Monterey, macOS AirPlay Receiver binds 0.0.0.0:5000 and 0.0.0.0:7000.
# A gunicorn on 127.0.0.1:<same port> binds successfully, but requests still
# get answered by AirTunes (403). Warn the user before they hit it.
check_airplay_collision() {
    local port="${GUNICORN_BIND##*:}"
    case "$port" in 5000|7000) ;; *) return ;; esac
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | grep -qi ControlCenter; then
        warn "macOS AirPlay Receiver is listening on :$port; gunicorn requests will 403."
        warn "  Fix: System Settings -> General -> AirDrop & Handoff -> AirPlay Receiver = Off"
        warn "  Or:  re-run with GUNICORN_BIND=127.0.0.1:5001 (or another free port)"
    fi
}

check_brew() {
    command -v brew >/dev/null || die "Homebrew not found; install from https://brew.sh and re-run"
    log "brew $(brew --version | head -1)"
}

# Redis: install via brew, start as a brew service so it persists across reboots.
install_redis() {
    if ! command -v redis-server >/dev/null; then
        log "brew install redis"
        brew install redis
    else
        log "redis $(redis-server --version | awk '{print $3}') already installed"
    fi
    # `brew services start` is idempotent (no-op if already running).
    brew services start redis >/dev/null
    # Quick liveness probe.
    if ! redis-cli ping >/dev/null 2>&1; then
        warn "redis-cli ping failed; check 'brew services list'"
    fi
}

# Node: only install if missing. Don't fight an existing nvm/asdf/brew install.
ensure_node() {
    if command -v node >/dev/null; then
        local v
        v="$(node -v)"
        case "$v" in
            v1[8-9].*|v[2-9][0-9].*) log "node $v already installed"; return ;;
            *) warn "node $v is older than 18; parcel may misbehave" ;;
        esac
    else
        log "brew install node (no existing node found)"
        brew install node
    fi
}

# Docker Desktop: detect, don't auto-install (it's a GUI app + cask).
check_docker() {
    if ! command -v docker >/dev/null; then
        warn "docker not found. Install Docker Desktop: brew install --cask docker"
        warn "  then launch Docker.app once to accept the license, and re-run."
        die  "docker required for the typesense container"
    fi
    if ! docker info >/dev/null 2>&1; then
        die "docker is installed but the daemon isn't running; open Docker.app"
    fi
    log "docker $(docker --version | awk '{print $3}' | tr -d ',') ready"
}

# wordpress_orm lives in its own repo (no setup.py); clone it next to APP_DIR
# and register it on sys.path via a .pth file in the venv.
install_wordpress_orm() {
    if [ -d "${WPORM_DIR}/.git" ]; then
        log "git pull on $WPORM_DIR"
        git -C "$WPORM_DIR" fetch --quiet origin "$WPORM_BRANCH"
        git -C "$WPORM_DIR" reset --hard "origin/${WPORM_BRANCH}"
    else
        log "cloning $WPORM_REPO_URL into $WPORM_DIR"
        git clone --quiet --branch "$WPORM_BRANCH" "$WPORM_REPO_URL" "$WPORM_DIR"
    fi

    local site_packages
    site_packages=$("${VENV_DIR}/bin/python" -c \
        'import sysconfig; print(sysconfig.get_paths()["purelib"])')
    log "registering $WPORM_DIR via wordpress_orm.pth in $site_packages"
    echo "$WPORM_DIR" > "${site_packages}/wordpress_orm.pth"

    "${VENV_DIR}/bin/python" -c 'import wordpress_orm' \
        || die "wordpress_orm import failing after install; check ${WPORM_DIR}"
}

setup_venv() {
    # A venv left over from a previous Python install (Xcode CLT update,
    # brew python upgrade, etc) will have a stale interpreter symlink and
    # explode with "ModuleNotFoundError: No module named 'encodings'" the
    # moment we try to run anything from it. Probe before reusing.
    if [ -x "${VENV_DIR}/bin/python" ]; then
        if ! "${VENV_DIR}/bin/python" -c 'import sys' >/dev/null 2>&1; then
            warn "venv at $VENV_DIR is broken (stale interpreter); recreating"
            rm -rf "$VENV_DIR"
        fi
    fi
    if [ ! -x "${VENV_DIR}/bin/python" ]; then
        log "creating venv at $VENV_DIR (python3=$(command -v python3))"
        python3 -m venv "$VENV_DIR"
    fi
    log "pip install -r requirements.txt + gunicorn"
    "${VENV_DIR}/bin/pip" install --quiet --upgrade pip
    "${VENV_DIR}/bin/pip" install --quiet -r "${FLASK_DIR}/requirements.txt"
    "${VENV_DIR}/bin/pip" install --quiet gunicorn
}

build_search_app() {
    if [ "${SKIP_BUILD:-0}" = "1" ]; then
        log "SKIP_BUILD=1; skipping npm ci + parcel build"
        return
    fi
    log "npm ci + parcel build in $SEARCH_DIR"
    ( cd "$SEARCH_DIR" && npm ci --no-audit --no-fund --prefer-offline && npm run build )
}

write_env_file() {
    log "writing $ENV_FILE"
    cat > "$ENV_FILE" <<EOF
# Generated by deploy_mac.sh — secrets, do not commit.
TYPESENSE_API_KEY=${TYPESENSE_API_KEY}
SB_WP_USERNAME=${SB_WP_USERNAME}
SB_WP_PASSWORD=${SB_WP_PASSWORD}
WP_BASE_URL=${WP_BASE_URL}
TYPESENSE_PORT=${TYPESENSE_PORT}
EOF
    chmod 600 "$ENV_FILE"
}

start_typesense() {
    if [ "${SKIP_TYPESENSE:-0}" = "1" ]; then
        log "SKIP_TYPESENSE=1; not touching the typesense container"
        return
    fi
    log "starting typesense container (loopback-bound on :${TYPESENSE_PORT})"
    env TYPESENSE_API_KEY="$TYPESENSE_API_KEY" \
        TYPESENSE_PORT="$TYPESENSE_PORT" \
        docker compose -f "${APP_DIR}/docker-compose.yml" up -d typesense
}

# Stop any gunicorn left over from a previous run (foreground means we own
# the process tree; this only matters if a prior run was kill -9'd).
kill_stale_gunicorn() {
    if pgrep -f "gunicorn.*wsgi:app.*${GUNICORN_BIND}" >/dev/null 2>&1; then
        log "killing stale gunicorn bound to ${GUNICORN_BIND}"
        pkill -f "gunicorn.*wsgi:app.*${GUNICORN_BIND}" || true
        sleep 1
    fi
}

run_gunicorn() {
    if [ "${SKIP_RUN:-0}" = "1" ]; then
        log "SKIP_RUN=1; setup complete. Start manually with:"
        log "  cd ${FLASK_DIR} && \\"
        log "  set -a && source ${ENV_FILE} && set +a && \\"
        log "  ${VENV_DIR}/bin/gunicorn --workers ${GUNICORN_WORKERS} --threads ${GUNICORN_THREADS} --bind ${GUNICORN_BIND} wsgi:app"
        return
    fi
    log "starting gunicorn in the foreground on http://${GUNICORN_BIND} (Ctrl-C to stop)"
    # Load env into our shell so gunicorn workers inherit it.
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    cd "$FLASK_DIR"
    exec "${VENV_DIR}/bin/gunicorn" \
        --workers "$GUNICORN_WORKERS" \
        --threads "$GUNICORN_THREADS" \
        --bind "$GUNICORN_BIND" \
        --capture-output \
        --timeout 60 \
        --graceful-timeout 30 \
        --reload \
        wsgi:app
}

log "starting mac deploy (dir=${APP_DIR})"
check_macos
check_airplay_collision
check_brew
install_redis
ensure_node
check_docker
setup_venv
install_wordpress_orm
build_search_app
write_env_file
start_typesense
kill_stale_gunicorn
run_gunicorn
