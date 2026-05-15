# Deployment

A single shell script — [`scripts/deploy.sh`](sorghum_webapp/scripts/deploy.sh) — provisions a fresh Debian/Ubuntu host with the Flask app, Redis, Typesense, the cron warm, and a systemd unit running Gunicorn. The script is idempotent: re-running it deploys a new commit and reloads the service.

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

- Target host: Debian 11+ or Ubuntu 22.04+
- Root or passwordless `sudo` on the host
- Outbound HTTPS to `github.com`, `content.sorghumbase.org`, `pypi.org`, `registry.npmjs.org`, and Docker Hub
- An SSH key on the host that can clone the repo (if `REPO_URL` uses SSH)
- The four secrets below in your local environment when you invoke the script

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

1. `apt install` python3, venv, build-essential, redis-server, cron, git
2. Installs Node 20 LTS (needed by Parcel to build `search_app/`)
3. Installs Docker (for Typesense)
4. Creates the `sorghum` system user; adds it to the `docker` group
5. Clones the repo to `/opt/sorghum-webapp` (or `git pull` if it's already there)
6. Creates a Python venv and installs `requirements.txt` + `gunicorn`
7. `npm ci && npm run build` in `search_app/` — produces the bundle at `sorghum_webapp/sorghum_webapp/static/search/`
8. Writes `/etc/sorghum-webapp/sorghum.env` (mode 640, `root:sorghum`) containing the secrets
9. Writes `/etc/systemd/system/sorghum-webapp.service` and enables it
10. Writes `/etc/cron.d/sorghum-webapp-warm` with the 30-min warm
11. Starts Typesense via `docker compose up -d typesense`
12. Starts the Gunicorn service
13. Runs `warm_wp_cache.sh` once to populate Redis and Typesense
14. Smoke-checks `/api/typeahead/_status` and `/api/typesense/counts`

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

Almost always a transient WordPress / DNS issue. The wp_cache layer already retries 5x on connect errors. If it persists, hit WordPress directly to confirm it's reachable:

```sh
curl -sI 'https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/tags?per_page=1'
```

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
