# Deployment

A single shell script — [`scripts/deploy.sh`](sorghum_webapp/scripts/deploy.sh) — provisions a fresh Rocky Linux 9 host (also RHEL 9 / AlmaLinux 9) with the Flask app, Redis, Typesense, the cron warm, and a systemd unit running Gunicorn. The script is idempotent: re-running it deploys a new commit and reloads the service.

## Architecture

```
public Apache host (TLS terminator)         internal app host (this script)
+-------------------------+                 +--------------------------------+
| Apache 2.4              |   HTTP proxy    | Gunicorn :8000 (systemd)       |
|  Let's Encrypt certs    |---------------->|   wsgi:app  -> create_app()    |
|  mod_proxy_http         |                 |                                |
|  serves /static/        |                 | Flask                          |
+-------------------------+                 |   /api/typeahead               |
                                            |   /api/wp_cache/<resource>     |
                                            |   /post/<slug> /paper/...      |
                                            +-------+------+-----------------+
                                                    |      |
                                                    v      v
                                            +--------+    +-------------------+
                                            | Redis  |    | Typesense (Docker)|
                                            | :6379  |    | :8108  127.0.0.1  |
                                            +--------+    +-------------------+
                                                    |
                                                    | cron */30 min
                                                    v
                                            warm_wp_cache.sh
                                                    |
                                                    v
                                            WordPress REST (read-only)
                                            content.sorghumbase.org
```

The deploy script touches only the **internal app host**. The Apache reverse proxy on the public host is configured separately (see [Reverse proxy setup](#reverse-proxy-setup) below).

## Prerequisites

- Target host: Rocky Linux 9 (RHEL 9 and AlmaLinux 9 also supported — anything with `dnf`, `systemd`, and the Docker CE / nodesource RPM repos)
- Root or passwordless `sudo` on the host
- Outbound HTTPS to `github.com`, `content.sorghumbase.org`, `pypi.org`, `registry.npmjs.org`, `download.docker.com`, `rpm.nodesource.com`, and Docker Hub
- EPEL available (the script enables `epel-release` itself)
- An SSH key on the host that can clone the repo (if `REPO_URL` uses SSH)
- The three secrets below in your local environment when you invoke the script

## Required environment variables

| Variable | Purpose |
|---|---|
| `TYPESENSE_API_KEY` | Long random string. Both the Typesense container and the Flask process read this. Generate once with `openssl rand -hex 32`. |
| `SB_WP_USERNAME` | WordPress admin used by `/update_publications` to PUT updates. |
| `SB_WP_PASSWORD` | WordPress admin password. |

## Optional environment variables

| Variable | Default | Purpose |
|---|---|---|
| `APP_USER` | `sorghum` | System user that owns the app and runs Gunicorn |
| `APP_DIR` | `/opt/sorghum-webapp` | Repo checkout location |
| `REPO_URL` | `git@github.com:warelab/sorghum-webapp.git` | Git remote |
| `GIT_BRANCH` | `master` | Branch to deploy |
| `GUNICORN_BIND` | `127.0.0.1:8000` | Bind address. Use a private IP if Apache is on another host. |
| `GUNICORN_WORKERS` | `4` | Worker process count |
| `GUNICORN_THREADS` | `2` | Threads per worker |
| `FORWARDED_ALLOW_IPS` | `*` | IPs trusted to set `X-Forwarded-*`. Set to your Apache host's IP in prod. |
| `WP_BASE_URL` | `https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/` | WordPress REST root |
| `WARM_SCHEDULE` | `*/30 * * * *` | Cron schedule for `warm_wp_cache.sh` |
| `TYPESENSE_PORT` | `8108` | Loopback port for Typesense |

## First-time deploy

```sh
# On the target host:
export TYPESENSE_API_KEY="$(openssl rand -hex 32)"   # store this somewhere safe
export SB_WP_USERNAME='<wordpress admin>'
export SB_WP_PASSWORD='<wordpress admin password>'

# Optional overrides for cross-host proxying:
# export GUNICORN_BIND='10.0.0.5:8000'
# export FORWARDED_ALLOW_IPS='10.0.0.4'    # the Apache host's IP

curl -fsSL https://raw.githubusercontent.com/warelab/sorghum-webapp/master/scripts/deploy.sh \
  | sudo -E bash
```

Or, if you've already cloned the repo:

```sh
sudo -E bash /path/to/sorghum-webapp/scripts/deploy.sh
```

`sudo -E` preserves the env vars you exported.

## What the script does

1. Verifies the host is Rocky / RHEL / AlmaLinux (refuses to run otherwise).
2. `dnf install` python3, python3-pip, python3-devel, gcc, make, git, curl, redis, cronie; enables and starts `redis` and `crond`.
3. Adds the nodesource repo and installs Node 20 LTS (needed by Parcel to build `search_app/`).
4. Adds the Docker CE repo and installs `docker-ce` + the compose plugin; enables and starts `docker`.
5. Creates the `sorghum` system user; adds it to the `docker` group.
6. Clones the repo to `/opt/sorghum-webapp` (or `git pull` if it's already there).
7. Creates a Python venv and installs `requirements.txt` + `gunicorn`.
8. `npm ci && npm run build` in `search_app/` — produces the bundle at `sorghum_webapp/sorghum_webapp/static/search/`.
9. Writes `/etc/sorghum-webapp/sorghum.env` (mode 640, `root:sorghum`) containing the secrets.
10. Writes `/etc/systemd/system/sorghum-webapp.service` and enables it.
11. Writes `/etc/cron.d/sorghum-webapp-warm` with the 30-min warm.
12. Starts Typesense via `docker compose up -d typesense`.
13. Starts the Gunicorn service.
14. Runs `warm_wp_cache.sh` once to populate Redis and Typesense.
15. Smoke-checks `/api/typeahead/_status` and `/api/typesense/counts`.

## Verifying the deploy

```sh
# Service status
systemctl status sorghum-webapp

# Live logs
journalctl -u sorghum-webapp -f

# Application logs
tail -F /var/log/sorghum-webapp/{access,error}.log

# Cache status
curl -s http://127.0.0.1:8000/api/typeahead/_status | python3 -m json.tool
# expect:  "ok": true, "api_key_present": true

curl -s http://127.0.0.1:8000/api/typesense/counts | python3 -m json.tool
# expect:  positive counts for posts, papers, projects, abstracts, ...

# Search end-to-end
curl -s 'http://127.0.0.1:8000/api/typeahead?q=sorghum' | python3 -m json.tool | head -40
```

## Updating to a new commit

Just re-run the script — same env, same command:

```sh
sudo -E bash /opt/sorghum-webapp/scripts/deploy.sh
```

`git pull` brings the new code, `pip install` picks up any new Python deps, `npm run build` rebuilds the bundle, the systemd service restarts. The cron and Typesense container are left alone unless their config changes.

For a hotfix where you only need to restart Gunicorn (e.g. after editing a per-host `.cfg` file):

```sh
sudo systemctl restart sorghum-webapp
```

## Manual cache operations

```sh
# Refill one resource (also re-syncs Typesense)
curl -s "http://127.0.0.1:8000/api/wp_cache/<resource>/meta?force=1"

# Refill everything the cron warms
/opt/sorghum-webapp/sorghum_webapp/scripts/warm_wp_cache.sh http://127.0.0.1:8000

# Drop a Typesense collection (forces re-create with current schema on next warm)
curl -X DELETE "http://localhost:8108/collections/<name>" \
  -H "X-TYPESENSE-API-KEY: $TYPESENSE_API_KEY"
```

Resources are listed at `/api/wp_cache/_resources`.

## Reverse proxy setup

Run on the **public Apache host**, separately from the deploy script. Configures TLS termination and forwards to the internal Gunicorn.

```apache
<VirtualHost *:443>
    ServerName www.sorghumbase.org
    ServerAlias sorghumbase.org

    SSLEngine on
    SSLCertificateFile      /etc/letsencrypt/live/sorghumbase.org/fullchain.pem
    SSLCertificateKeyFile   /etc/letsencrypt/live/sorghumbase.org/privkey.pem
    SSLUseStapling on
    SSLStaplingCache shmcb:/var/run/ocsp(128000)

    Protocols h2 http/1.1
    ProxyPreserveHost On
    ProxyRequests Off
    ProxyTimeout 90

    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port  "443"

    ProxyPass        / http://<internal-app-host>:8000/
    ProxyPassReverse / http://<internal-app-host>:8000/

    ErrorLog  ${APACHE_LOG_DIR}/sorghum_error.log
    CustomLog ${APACHE_LOG_DIR}/sorghum_access.log combined
</VirtualHost>
```

Apache modules needed: `proxy`, `proxy_http`, `headers`, `ssl`, `http2`.

If the internal host is reachable only from the Apache host, set `GUNICORN_BIND` to the private interface IP and `FORWARDED_ALLOW_IPS` to the Apache host's IP when running `deploy.sh`.

## Rocky-specific things to know

### SELinux

Rocky 9 ships with SELinux in **enforcing** mode. The default setup works:

- Gunicorn runs as a normal systemd-managed service and is **not** confined by an SELinux domain unless you give it one, so binding to port 8000 and reading the venv / app code on `/opt/sorghum-webapp` works without extra rules.
- Redis listens on localhost and is reached over loopback — no SELinux interaction.
- Typesense runs inside a Docker container; container-bridge networking is allowed by default.

**If you re-locate the app outside `/opt/`** (e.g. under `/home/sorghum/`), SELinux may refuse systemd's reads. Either move it back under `/opt/`, or relabel:
```sh
semanage fcontext -a -t bin_t '/home/sorghum/sorghum-webapp/venv/bin(/.*)?'
restorecon -Rv /home/sorghum/sorghum-webapp/
```

To temporarily diagnose any SELinux denial, watch the audit log while reproducing:
```sh
ausearch -m AVC -ts recent
```

### firewalld

Rocky 9 starts with firewalld active. By default the script binds Gunicorn to `127.0.0.1:8000`, which doesn't need any port opening. If you set `GUNICORN_BIND=10.0.0.5:8000` so the public Apache box can reach it, open port 8000 to that specific source:

```sh
sudo firewall-cmd --permanent \
  --add-rich-rule='rule family="ipv4" source address="<apache-host-IP>" port port="8000" protocol="tcp" accept'
sudo firewall-cmd --reload
```

### Docker CE vs Podman

Rocky 9 ships Podman, not Docker. The script installs Docker CE from the upstream repo because `docker-compose.yml` uses Docker Compose v2 syntax and our examples assume `docker compose ...`. If your sysadmin prefers Podman, install `podman` + `podman-compose` and swap the `docker compose up -d typesense` call in the script for `podman-compose up -d typesense` — everything else is identical.

## Troubleshooting

### `systemctl status sorghum-webapp` shows the service failed at startup

```sh
journalctl -u sorghum-webapp --no-pager | tail -50
```

Most common cause: `Type=notify` is set in the unit but Gunicorn isn't sending the ready signal. Edit `/etc/systemd/system/sorghum-webapp.service`, change `Type=notify` to `Type=simple`, run `systemctl daemon-reload && systemctl restart sorghum-webapp`.

### `/api/typeahead` returns 503

Hit `/api/typeahead/_status` for the actual reason:

```sh
curl -s http://127.0.0.1:8000/api/typeahead/_status | python3 -m json.tool
```

| `reason` | Fix |
|---|---|
| `TYPESENSE_API_KEY not set in env or configuration_files cfg` | Ensure the env file at `/etc/sorghum-webapp/sorghum.env` has the right key and restart the service |
| `connect to http://localhost:8108 failed: ...` | `docker compose ps typesense` — if it isn't `running`, `docker compose up -d typesense` |
| `typesense python library not installed` | Re-run `deploy.sh`; `pip install typesense` got skipped |

### `warm_wp_cache.sh` reports `FAILED tags` (or similar)

Almost always a transient WordPress / DNS issue. The wp_cache layer already retries 5x on connect errors. If it persists, hit WordPress directly to confirm it's reachable from the box:

```sh
curl -sI 'https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/tags?per_page=1'
```

If that times out from inside the host but works from your laptop, check firewalld and any outbound proxy rules on the box.

### Stale cache after a content update in WordPress

```sh
# Force one resource (also re-syncs Typesense)
curl -s "http://127.0.0.1:8000/api/wp_cache/<resource>/meta?force=1"
```

The default `WP_CACHE_TTL` is 7 days, so the cron warm is what keeps everything fresh. If the cron stopped firing, check `journalctl -t wp_cache_warm`.

### Bumping the React bundle cache

If a frontend behavior change wasn't picked up after a deploy:

1. Confirm the bundle file mtime is newer than the source:
   ```sh
   ls -l /opt/sorghum-webapp/sorghum_webapp/sorghum_webapp/static/search/index.js \
         /opt/sorghum-webapp/search_app/src/index.js
   ```
2. If users still see old behavior, the browser may be holding a stale `money-clip` IndexedDB cache. Bump `version` in [`search_app/src/utils/cache.js`](search_app/src/utils/cache.js) and rebuild.

## File layout reference

| Path | Role |
|---|---|
| `/opt/sorghum-webapp/` | Repo checkout (owned by `sorghum`) |
| `/opt/sorghum-webapp/venv/` | Python virtualenv |
| `/opt/sorghum-webapp/sorghum_webapp/wsgi.py` | Gunicorn entry point |
| `/etc/sorghum-webapp/sorghum.env` | Secrets and per-host config |
| `/etc/systemd/system/sorghum-webapp.service` | Service unit |
| `/etc/cron.d/sorghum-webapp-warm` | Cron entry for `warm_wp_cache.sh` |
| `/var/log/sorghum-webapp/{access,error}.log` | Gunicorn logs |
| Docker volume `typesense_data` | Typesense index on disk |
