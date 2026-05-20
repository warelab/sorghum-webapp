#!/usr/bin/env bash
#
# Provision-or-deploy the sorghum-webapp on a Rocky Linux 9 host (also
# works on RHEL 9 / AlmaLinux 9) with Gunicorn + systemd + Redis +
# Typesense (Docker CE).
#
# Idempotent: safe to re-run.
#   First run -> installs system packages, adds Docker CE + nodesource
#                repos, creates the service user, clones the repo,
#                writes systemd + cron, brings everything up.
#   Re-runs   -> git pull, pip install, npm run build, systemctl reload.
#
# Run as root or with passwordless sudo on the target host.
#
# Required environment variables:
#   TYPESENSE_API_KEY   long random string; same value both Docker + Flask see.
#                       openssl rand -hex 32
#   SB_WP_USERNAME      WordPress admin (used by /update_publications POSTs).
#   SB_WP_PASSWORD      ditto.
#
# Optional (with defaults):
#   APP_USER              sorghum
#   APP_DIR               /opt/sorghum-webapp
#   REPO_URL              git@github.com:warelab/sorghum-webapp.git
#   GIT_BRANCH            master
#   GUNICORN_BIND         127.0.0.1:8000
#   GUNICORN_WORKERS      4
#   GUNICORN_THREADS      2
#   FORWARDED_ALLOW_IPS   *                 # restrict to your proxy's IP in prod
#   WP_BASE_URL           https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/
#   WARM_SCHEDULE         */30 * * * *      # cron entry for warm_wp_cache.sh
#   TYPESENSE_PORT        8108              # bound to 127.0.0.1 only

set -euo pipefail
shopt -s inherit_errexit 2>/dev/null || true

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
: "${TYPESENSE_API_KEY:?TYPESENSE_API_KEY must be set in the calling env}"
: "${SB_WP_USERNAME:?SB_WP_USERNAME must be set in the calling env}"
: "${SB_WP_PASSWORD:?SB_WP_PASSWORD must be set in the calling env}"

APP_USER="${APP_USER:-sorghum}"
APP_DIR="${APP_DIR:-/opt/sorghum-webapp}"
REPO_URL="${REPO_URL:-git@github.com:warelab/sorghum-webapp.git}"
GIT_BRANCH="${GIT_BRANCH:-master}"
GUNICORN_BIND="${GUNICORN_BIND:-127.0.0.1:8000}"
GUNICORN_WORKERS="${GUNICORN_WORKERS:-4}"
GUNICORN_THREADS="${GUNICORN_THREADS:-2}"
FORWARDED_ALLOW_IPS="${FORWARDED_ALLOW_IPS:-*}"
WP_BASE_URL="${WP_BASE_URL:-https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/}"
WARM_SCHEDULE="${WARM_SCHEDULE:-*/30 * * * *}"
TYPESENSE_PORT="${TYPESENSE_PORT:-8108}"

LOG_DIR="/var/log/sorghum-webapp"
ENV_FILE="/etc/sorghum-webapp/sorghum.env"
SERVICE_NAME="sorghum-webapp"
SYSTEMD_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
CRON_FILE="/etc/cron.d/${SERVICE_NAME}-warm"

REPO_ROOT="${APP_DIR}"
FLASK_DIR="${APP_DIR}/sorghum_webapp"
SEARCH_DIR="${APP_DIR}/search_app"
VENV_DIR="${APP_DIR}/venv"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

sudo_() {
    if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi
}

# ---------------------------------------------------------------------------
# 0. Distro sanity check
# ---------------------------------------------------------------------------
check_distro() {
    if [ ! -r /etc/os-release ]; then
        die "cannot read /etc/os-release; this script targets Rocky/RHEL/Alma 9."
    fi
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}${ID_LIKE:-}" in
        *rhel*|*rocky*|*almalinux*|*centos*) : ;;
        *) die "unsupported distro ID=${ID}; this script targets Rocky/RHEL/Alma 9." ;;
    esac
    log "distro: ${PRETTY_NAME:-$ID $VERSION_ID}"
}

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------
install_packages() {
    log "dnf: ensuring base packages"
    sudo_ dnf -q -y install epel-release || true
    sudo_ dnf -q -y install \
        python3 python3-pip python3-devel \
        gcc make \
        git curl ca-certificates \
        redis \
        cronie

    log "ensuring redis + crond are enabled and running"
    sudo_ systemctl enable --now redis
    sudo_ systemctl enable --now crond
}

install_node() {
    if command -v node >/dev/null && node -v | grep -qE '^v(1[8-9]|[2-9][0-9])\.'; then
        log "node $(node -v) already installed"
        return
    fi
    log "installing node 20 LTS via nodesource (for parcel build)"
    # Disable the Rocky-shipped nodejs module so the nodesource RPM wins.
    sudo_ dnf -q -y module disable nodejs >/dev/null 2>&1 || true
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo_ -E bash -
    sudo_ dnf -q -y install nodejs
}

install_docker() {
    if command -v docker >/dev/null; then
        log "docker $(docker --version) already installed"
    else
        log "installing docker-ce + compose plugin"
        sudo_ dnf -q -y install dnf-plugins-core
        if [ ! -f /etc/yum.repos.d/docker-ce.repo ]; then
            sudo_ dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        fi
        sudo_ dnf -q -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
        sudo_ systemctl enable --now docker
    fi
}

# ---------------------------------------------------------------------------
# 2. Service user + directories
# ---------------------------------------------------------------------------
create_user_and_dirs() {
    if id -u "$APP_USER" >/dev/null 2>&1; then
        log "user $APP_USER exists"
    else
        log "creating user $APP_USER"
        sudo_ useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
        # Allow this user to drive `docker compose` for typesense.
        sudo_ usermod -aG docker "$APP_USER"
    fi

    sudo_ mkdir -p "$APP_DIR" "$LOG_DIR" "$(dirname "$ENV_FILE")"
    sudo_ chown "$APP_USER:$APP_USER" "$APP_DIR" "$LOG_DIR"
    sudo_ chmod 750 "$(dirname "$ENV_FILE")"
}

# ---------------------------------------------------------------------------
# 3. Code: clone or pull
# ---------------------------------------------------------------------------
clone_or_pull() {
    if [ -d "${REPO_ROOT}/.git" ]; then
        log "git pull on $REPO_ROOT"
        sudo_ -u "$APP_USER" git -C "$REPO_ROOT" fetch --quiet origin "$GIT_BRANCH"
        sudo_ -u "$APP_USER" git -C "$REPO_ROOT" reset --hard "origin/${GIT_BRANCH}"
    else
        log "cloning $REPO_URL into $REPO_ROOT"
        sudo_ -u "$APP_USER" git clone --branch "$GIT_BRANCH" "$REPO_URL" "$REPO_ROOT"
    fi
}

# ---------------------------------------------------------------------------
# 4. Python: venv + dependencies (incl. gunicorn)
# ---------------------------------------------------------------------------
setup_venv() {
    if [ ! -x "${VENV_DIR}/bin/python" ]; then
        log "creating venv at $VENV_DIR"
        sudo_ -u "$APP_USER" python3 -m venv "$VENV_DIR"
    fi
    log "pip install -r requirements.txt + gunicorn"
    sudo_ -u "$APP_USER" "${VENV_DIR}/bin/pip" install --quiet --upgrade pip
    sudo_ -u "$APP_USER" "${VENV_DIR}/bin/pip" install --quiet -r "${FLASK_DIR}/requirements.txt"
    sudo_ -u "$APP_USER" "${VENV_DIR}/bin/pip" install --quiet gunicorn
}

# ---------------------------------------------------------------------------
# 5. React bundle
# ---------------------------------------------------------------------------
build_search_app() {
    log "npm ci + parcel build in $SEARCH_DIR"
    sudo_ -u "$APP_USER" env -C "$SEARCH_DIR" npm ci --no-audit --no-fund --prefer-offline
    sudo_ -u "$APP_USER" env -C "$SEARCH_DIR" npm run build
}

# ---------------------------------------------------------------------------
# 6. Per-host config: env file + Flask cfg
# ---------------------------------------------------------------------------
write_env_file() {
    log "writing $ENV_FILE"
    # 0640 — service user can read; group restricted; not world-readable.
    sudo_ tee "$ENV_FILE" >/dev/null <<EOF
# Generated by deploy.sh — secrets, do not commit.
TYPESENSE_API_KEY=${TYPESENSE_API_KEY}
SB_WP_USERNAME=${SB_WP_USERNAME}
SB_WP_PASSWORD=${SB_WP_PASSWORD}
WP_BASE_URL=${WP_BASE_URL}
TYPESENSE_PORT=${TYPESENSE_PORT}
EOF
    sudo_ chown root:"$APP_USER" "$ENV_FILE"
    sudo_ chmod 640 "$ENV_FILE"
}

# ---------------------------------------------------------------------------
# 7. Typesense via docker compose
# ---------------------------------------------------------------------------
start_typesense() {
    log "starting typesense container"
    # docker-compose.yml at repo root expects TYPESENSE_API_KEY (+ optional
    # TYPESENSE_PORT) in env. Loopback-bind for safety; if your prod compose
    # already has 127.0.0.1: prefixed in the ports stanza, this is a no-op.
    sudo_ -u "$APP_USER" \
        env TYPESENSE_API_KEY="$TYPESENSE_API_KEY" \
            TYPESENSE_PORT="$TYPESENSE_PORT" \
        docker compose -f "${REPO_ROOT}/docker-compose.yml" up -d typesense
}

# ---------------------------------------------------------------------------
# 8. Systemd unit for Gunicorn
# ---------------------------------------------------------------------------
write_systemd_unit() {
    log "writing $SYSTEMD_UNIT"
    sudo_ tee "$SYSTEMD_UNIT" >/dev/null <<EOF
[Unit]
Description=Sorghum webapp (Gunicorn)
After=network.target redis.service docker.service
Wants=redis.service

[Service]
Type=notify
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${FLASK_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${VENV_DIR}/bin/gunicorn \\
    --workers ${GUNICORN_WORKERS} \\
    --threads ${GUNICORN_THREADS} \\
    --bind ${GUNICORN_BIND} \\
    --access-logfile ${LOG_DIR}/access.log \\
    --error-logfile ${LOG_DIR}/error.log \\
    --capture-output \\
    --timeout 60 \\
    --graceful-timeout 30 \\
    --forwarded-allow-ips '${FORWARDED_ALLOW_IPS}' \\
    wsgi:app
ExecReload=/bin/kill -s HUP \$MAINPID
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
# Hardening: write only to its own dirs.
ProtectSystem=full
PrivateTmp=true
NoNewPrivileges=true
ReadWritePaths=${LOG_DIR} ${APP_DIR}/.parcel-cache ${APP_DIR}/search_app/.parcel-cache

[Install]
WantedBy=multi-user.target
EOF

    sudo_ mkdir -p "$LOG_DIR"
    sudo_ chown "$APP_USER:$APP_USER" "$LOG_DIR"
    sudo_ systemctl daemon-reload
    sudo_ systemctl enable "$SERVICE_NAME"
}

# ---------------------------------------------------------------------------
# 9. Cron: hourly wp_cache warm
# ---------------------------------------------------------------------------
install_cron() {
    log "writing $CRON_FILE"
    sudo_ tee "$CRON_FILE" >/dev/null <<EOF
# Refill wp_cache + sync Typesense. See sorghum_webapp/scripts/warm_wp_cache.sh.
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${WARM_SCHEDULE} ${APP_USER} ${FLASK_DIR}/scripts/warm_wp_cache.sh http://${GUNICORN_BIND} 2>&1 | logger -t wp_cache_warm
EOF
    sudo_ chmod 644 "$CRON_FILE"
}

# ---------------------------------------------------------------------------
# 10. Restart service + initial warm
# ---------------------------------------------------------------------------
restart_service() {
    log "(re)starting $SERVICE_NAME"
    sudo_ systemctl restart "$SERVICE_NAME"
    sleep 2
    sudo_ systemctl --no-pager --quiet is-active "$SERVICE_NAME" \
        || die "service failed to start; see: journalctl -u $SERVICE_NAME"
}

warm_initial() {
    log "warming wp_cache (also populates Typesense collections)"
    sleep 3  # give gunicorn a moment to settle
    sudo_ -u "$APP_USER" "${FLASK_DIR}/scripts/warm_wp_cache.sh" "http://${GUNICORN_BIND}" || \
        warn "initial warm reported errors; check logs and re-run manually"
}

verify() {
    log "smoke checks:"
    printf '  /api/typeahead/_status   -> '
    curl -fsS "http://${GUNICORN_BIND}/api/typeahead/_status" | head -c 200
    printf '\n  /api/wp_cache/_timestamps -> '
    curl -fsS "http://${GUNICORN_BIND}/api/wp_cache/_timestamps" | head -c 400
    printf '\n'
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
log "starting deploy (user=${APP_USER}, dir=${APP_DIR}, branch=${GIT_BRANCH})"
check_distro
install_packages
install_node
install_docker
create_user_and_dirs
clone_or_pull
setup_venv
build_search_app
write_env_file
write_systemd_unit
install_cron
start_typesense
restart_service
warm_initial
verify
log "done."
