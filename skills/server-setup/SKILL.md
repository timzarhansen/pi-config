---
name: server-setup
description: >
  Overview of the server_setup_home project: a home lab server management system
  using MASH-playbook with custom Docker services. Provides architecture context,
  key constraints, and pointers to detailed documentation.
  Read llm_instructions/README.md before implementing changes.
---

# Server Setup PI

## Project Overview

A **home lab server management system** for deploying and managing self-hosted services on a remote VPS (`161.13.12.139`, user `zarbokk`). Uses **Ansible** as the automation engine, built on top of MASH-playbook.

**Key Principles:**
- Each service = separate Git repo + separate Ansible role
- Secrets never committed to Git
- Version pinning for stability
- Single root secret, all others derived
- MASH-playbook remains independent/unchanged (git submodule)

## Architecture

```
server_setup_home/
├── deploy.sh              ← Master deploy script (single entry point)
├── matrix_deploy.sh       ← Matrix-specific deploy
├── ansible.cfg            ← Ansible config (role paths)
├── roles/                 ← Custom Ansible roles
│   ├── weather_mcp_server/
│   ├── openwebui/
│   ├── homepage/
│   ├── seafile/
│   ├── authentik_outpost/
│   ├── searxng/
│   └── galaxy/            ← Ansible Galaxy roles (~20 services)
├── inventory/
│   ├── hosts              ← Server definitions (public)
│   │   ├── [mash_servers]           ← Main server: zarbokk.me
│   │   ├── [mash_servers_immich_deps] ← Dedicated deps for Immich
│   │   └── [matrix_servers]         ← Matrix servers
│   └── host_vars/
│       ├── zarbokk.me/
│       │   └── vars.yml   ← SECRET (gitignored)
│       └── zarbokk.me-immich-deps/
│           └── vars.yml   ← SECRET (gitignored, for Immich's dedicated DB/Redis)
├── deploy_repos/          ← Local repo cache (gitignored)
├── mash-playbook/         ← MASH-playbook (git submodule — NEVER MODIFY)
│   ├── templates/setup.yml   ← Source template (never run directly)
│   ├── setup.yml             ← Generated at runtime (gitignored)
│   └── roles/                ← MASH roles (galaxy + mash/)
└── matrix_playbook/       ← Matrix playbook (git submodule)
```

### Key Principle: MASH is Untouched

- `mash-playbook/` is a **git submodule** — never modify files inside it
- Custom roles live in `roles/` at the root level
- `deploy.sh` generates `mash-playbook/setup.yml` at runtime by copying the template
  and injecting custom role entries via `sed`
- All roles (MASH + custom) run in **one single Ansible play** — this is critical for
  variable scope sharing

### Host Groups

- `mash_servers` — Main server (`zarbokk.me`, IP `161.13.12.139`, user `zarbokk`)
- `mash_servers_immich_deps` — Dedicated host for Immich's Valkey + Postgres
  (Immich requires separate database/redis instances, deployed on this host group)
- `matrix_servers` — Matrix server hosts (`zarbokk.me`)

## Deploy Workflow (`deploy.sh install-all`)

### The Flow

```
./deploy.sh install-all
  → sync_repos()        # Clone/fetch repos, create tarballs
  → prepare_playbook()  # Copy templates, inject custom roles
  → run_ansible()       # Run single-play Ansible
```

### `sync_repos()` — Clone + Tarball

**Only services that need source code sync are handled here.** Currently: `weather-mcp` and `openwebui`.

For each synced service, this function:
1. Clones or fetches the repo into `deploy_repos/SERVICE_NAME/`
2. Checks out the desired branch/tag
3. Creates a tarball: `deploy_repos/SERVICE_NAME.tar.gz` (`.git` excluded)

**Why tarballs?** `ansible.builtin.synchronize` (rsync) is unreliable for this
use case — it may report "no changes" while not actually transferring files.
Tarballs are deterministic and work every time.

**Services that do NOT need sync:** `searxng`, `homepage`, `seafile`, `authentik_outpost` — these use pre-built Docker images and have no repo sync block in `deploy.sh`.

### `prepare_playbook()` — Inject Custom Roles

1. Copies `mash-playbook/templates/setup.yml` → `mash-playbook/setup.yml`
2. Copies `mash-playbook/templates/group_vars_mash_servers` → `inventory/group_vars/mash_servers`
3. Calls `inject_custom_roles()` which uses `sed` to insert role entries before
   the `# role-specific:auxiliary` marker in setup.yml

**Why injection?** MASH's `setup.yml` is a single play with a `roles:` block.
By injecting our roles into that block, all roles share the same variable scope.
This is what makes `mash_playbook_service_identifier_prefix`, `traefik_identifier`,
and other MASH variables available to custom roles.

### `run_ansible()` — Run the Playbook

Runs `ansible-playbook mash-playbook/setup.yml --tags=...` with extra vars
(`-e`) that pass absolute paths to the local repo directories.

**Why extra vars?** `playbook_dir` resolves to `mash-playbook/` (where setup.yml lives).
Custom role defaults can't reliably compute the path to `deploy_repos/` at the root.
Extra vars override defaults with absolute paths.

**Current extra vars passed:** Only `weather_mcp_server_local_repo_path` (for the weather-mcp service).
Add more with `-e "<service>_local_repo_path=$SCRIPT_DIR/deploy_repos/<service>"` when adding new services that need repo sync.

**Note:** `run_ansible_no_repos()` runs Ansible without syncing repos — used by services that only need playbook preparation (no source code transfer).

**Note:** `install_galaxy_roles()` in `deploy.sh` installs MASH's galaxy roles using either `agru` (faster) or `ansible-galaxy` (fallback). Galaxy roles are installed into `mash-playbook/roles/galaxy/`.

### On Server

Each role: extract tarball → build Docker image → generate systemd unit → start container

## Deploy Commands

### Main Deploy (`deploy.sh`)

```bash
./deploy.sh install-all          # Full install (MASH + custom roles)
./deploy.sh setup-all            # Full setup with uninstall tasks
./deploy.sh start-all            # Start all services
./deploy.sh stop-all             # Stop all services
./deploy.sh install <service>    # Install a single service
./deploy.sh start <service>      # Start a single service
./deploy.sh stop <service>       # Stop a single service
./deploy.sh status               # Check service status on server
./deploy.sh update               # Update MASH, roles, and sync repos
./deploy.sh update-mash          # Update MASH submodule only
./deploy.sh update-roles         # Update galaxy roles only
./deploy.sh sync-repos           # Sync local repositories only
./deploy.sh weather-mcp-server   # Run only weather-mcp-server role
```

### Matrix Deploy (`matrix_deploy.sh`)

```bash
./matrix_deploy.sh install-all   # Full Matrix install
./matrix_deploy.sh start-all     # Start all Matrix services
./matrix_deploy.sh stop-all      # Stop all Matrix services
./matrix_deploy.sh setup-all     # Setup + start
./matrix_deploy.sh status        # Check Matrix service status
```

### Extra Args

All commands accept Ansible arguments:
```bash
./deploy.sh install-all --limit zarbokk.me
./deploy.sh weather-mcp-server --diff
```

## Role Structure

### Custom Roles (`roles/<name>/`)

Each custom role follows this structure:

```
roles/<service>/
├── defaults/main.yml    # Variables, enable/disable, ports, hostnames, Traefik config
├── tasks/
│   ├── main.yml         # Entry: validate → install → uninstall → stop
│   ├── validate_config.yml
│   ├── install.yml      # Copy tarball → build image → deploy systemd
│   └── uninstall.yml
├── handlers/main.yml    # Restart/rebuild handlers
├── templates/
│   ├── env.j2           # Container environment variables
│   ├── labels.j2        # Docker/Traefik labels
│   └── systemd/<name>.service.j2  # Systemd unit file
└── meta/main.yml        # Galaxy metadata
```

### Galaxy Roles (`roles/galaxy/`)

Pre-built roles from Ansible Galaxy. Same structure as custom roles but more feature-complete. Includes validation, install, uninstall, and systemd templates.

### Key Role Variables Pattern

```yaml
# Identifier (auto-prefixed by MASH)
<service>_identifier: "{{ mash_playbook_service_identifier_prefix }}service-name"

# Enable/disable
<service>_enabled: false

# Local repo path — OVERRIDE via -e extra var in deploy.sh
<service>_local_repo_path: "{{ playbook_dir | dirname }}/deploy_repos/service-name"

# Network
<service>_hostname: ''
<service>_path_prefix: /service-name
<service>_container_port: 8000

# Paths on the server — TWO patterns:
# Custom roles (in roles/): /opt/<service>/
# MASH native (vars.yml):   /mash/<service>/
#
# Custom role example:
weather_mcp_server_base_path: "/opt/weather-mcp-server"
weather_mcp_server_source_path: "{{ weather_mcp_server_base_path }}/source"
# MASH native example:
# postgres_base_path: "/mash/postgres"

# Docker
<service>_docker_image: "{{ <service>_identifier }}"
<service>_docker_tag: "latest"
<service>_container_network: "{{ <service>_identifier }}"
<service>_container_network_deletion_enabled: true

# Volumes & extra arguments
<service>_container_additional_volumes: "{{ <service>_container_additional_volumes_auto + <service>_container_additional_volumes_custom }}"
<service>_container_additional_volumes_auto: []
<service>_container_additional_volumes_custom: []
<service>_container_extra_arguments: "{{ <service>_container_extra_arguments_auto + <service>_container_extra_arguments_custom }}"
<service>_container_extra_arguments_auto: []
<service>_container_extra_arguments_custom: []

# Health check
<service>_container_health_interval: "{{ '5s' if <service>_container_labels_traefik_enabled else '30s' }}"

# Traefik integration (auto-detected from MASH config)
<service>_container_labels_traefik_enabled: "{{ mash_playbook_traefik_labels_enabled }}"
<service>_container_labels_traefik_docker_network: "{{ mash_playbook_reverse_proxyable_services_additional_network }}"
<service>_container_labels_traefik_hostname: "{{ <service>_hostname }}"
<service>_container_labels_traefik_path_prefix: "{{ <service>_path_prefix }}"
<service>_container_labels_traefik_rule: "Host(`{{ <service>_container_labels_traefik_hostname }}`){% if <service>_container_labels_traefik_path_prefix != '/' %} && PathPrefix(`{{ <service>_container_labels_traefik_path_prefix }}`){% endif %}"
<service>_container_labels_traefik_priority: 0
<service>_container_labels_traefik_entrypoints: web-secure
<service>_container_labels_traefik_tls: "{{ <service>_container_labels_traefik_entrypoints != 'web' }}"
<service>_container_labels_traefik_tls_certResolver: default
<service>_container_labels_traefik_middleware_basic_auth_enabled: false
<service>_container_labels_traefik_middleware_basic_auth_users: ''

# Custom Traefik middleware names (e.g., ["global-ratelimit@file", "authentik-forward-auth@file"])
<service>_container_labels_traefik_middleware_custom_names: []

# API Key authentication (set to enable X-API-Key header auth)
<service>_api_key: ''

# Additional labels
<service>_container_labels_additional_labels: "{{ <service>_container_labels_additional_labels_auto + <service>_container_labels_additional_labels_custom }}"
<service>_container_labels_additional_labels_auto: []
<service>_container_labels_additional_labels_custom: []

# Additional networks — INLINE JINJA2, NOT multiline YAML block
<service>_container_additional_networks: "{{ <service>_container_additional_networks_auto + <service>_container_additional_networks_custom }}"
<service>_container_additional_networks_auto: "{{ [mash_playbook_reverse_proxyable_services_additional_network] if mash_playbook_traefik_labels_enabled and <service>_hostname else [] }}"
<service>_container_additional_networks_custom: []

# Systemd dependencies — INLINE JINJA2, NOT multiline YAML block
<service>_systemd_required_services_list: "{{ <service>_systemd_required_services_list_auto + <service>_systemd_required_services_list_custom }}"
<service>_systemd_required_services_list_auto: "{{ ([container_socket_proxy_identifier ~ '.service'] if container_socket_proxy_enabled | default(false) else []) + ([traefik_identifier ~ '.service'] if traefik_enabled | default(false) and <service>_hostname else []) }}"
<service>_systemd_required_services_list_custom: []
```

## Adding a New Service

### Service Type Decision

Before modifying `deploy.sh`, determine your service type:

| Type | Examples | Needs `sync_repos()`? | Needs `-e` extra var? |
|------|----------|----------------------|----------------------|
| **Source-code** — repo with Dockerfile, built on server | `weather-mcp`, `openwebui` | ✅ Yes | ✅ Yes |
| **Pre-built image** — uses published Docker image | `searxng`, `homepage`, `seafile`, `authentik-outpost` | ❌ No | ❌ No |

**Source-code services** need all 4 deploy.sh modifications (A–G).
**Pre-built image services** only need modifications B (injection) and D–G (case blocks).

For detailed step-by-step instructions and copy-paste templates, see `llm_instructions/README.md`.

## Critical Gotchas (Pitfalls We Learned the Hard Way)

### G1: `when:` Conditions Must Be Proper Booleans

```yaml
# WRONG — Ansible 2.20+ rejects string-as-boolean:
when: weather_mcp_server_container_network | bool

# WRONG — | bool on a non-empty string returns False in newer Ansible:
when: weather_mcp_server_container_network | bool

# CORRECT — use | length > 0 for strings:
when: weather_mcp_server_container_network | length > 0
```

### G2: Docker Commands Must Use `ansible.builtin.command`

```yaml
# WRONG — runs on your MacBook, not the server:
community.docker.docker_network:
  name: "my-network"
  state: present

community.docker.docker_image:
  name: "my-image"
  source: build
  build:
    path: "/opt/my-service"

# CORRECT — runs on the server:
ansible.builtin.command:
  cmd: "docker network create my-network"

ansible.builtin.command:
  cmd: "docker build -t my-image:latest /opt/my-service"

ansible.builtin.command:
  cmd: "docker rmi -f my-image:latest"
```

**Why?** `community.docker.*` modules connect to the Docker daemon on the
**control machine** (your MacBook), not the remote host.

### G3: Never Use `synchronize` for Repo Transfer

```yaml
# WRONG — unreliable, may report "no changes" without transferring:
ansible.builtin.synchronize:
  src: "{{ local_repo_path }}"
  dest: "{{ remote_path }}"
  delete: yes

# CORRECT — tarball + copy + unarchive:
# In deploy.sh: tar -czf repo.tar.gz -C repo/ --exclude='.git' .
# In install.yml:
- name: Copy archive
  ansible.builtin.copy:
    src: "{{ local_repo_path }}.tar.gz"
    dest: "/tmp/service.tar.gz"

- name: Extract archive
  ansible.builtin.unarchive:
    src: "/tmp/service.tar.gz"
    dest: "{{ remote_path }}"
    remote_src: yes
```

### G4: Role Defaults — Use Inline Jinja2, Not Multiline YAML Blocks

```yaml
# WRONG — produces a YAML string, can't concatenate with Python lists:
my_service_container_additional_networks_auto: |
  {{
    ([something] if condition else [])
  }}

# CORRECT — produces a native Python list:
my_service_container_additional_networks_auto: "{{ [something] if condition else [] }}"
```

### G5: `playbook_dir` Resolves to `mash-playbook/`

```yaml
# WRONG — resolves to mash-playbook/deploy_repos/ (doesn't exist):
my_service_local_repo_path: "{{ playbook_dir }}/deploy_repos/my-service"

# CORRECT — override via -e extra var in deploy.sh:
# -e "my_service_local_repo_path=$SCRIPT_DIR/deploy_repos/my-service"
```

### G6: Docker Builds Need DNS on the Server

If `docker build` fails with `Temporary failure in name resolution`, the server's
Docker daemon has broken DNS. Fix on the server:

```bash
echo '{"dns": ["8.8.8.8", "8.8.4.4"]}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

### G7: `git clone` Mode Parameter

```yaml
# WRONG — 'mode' is not a valid parameter for ansible.builtin.git:
ansible.builtin.git:
  repo: "..."
  dest: "..."
  mode: "0755"

# CORRECT — remove mode, set permissions with ansible.builtin.file:
ansible.builtin.git:
  repo: "..."
  dest: "..."
```

### G8: Sed Injection Indentation

The `sed` command in `inject_custom_roles()` must use **4-space indentation**
to match the MASH `setup.yml` `roles:` block:

```bash
sed -i '' '/# role-specific:auxiliary/i\
    # role-specific:my_service\
    - role: roles/my_service\
      when: my_service_enabled | bool\
      tags:\
        - my-service\
        - install-all\
        - setup-all\
    # /role-specific:my_service\
' "$MASH_DIR/setup.yml"
```

Note: `sed -i ''` is macOS syntax. On Linux use `sed -i`.

## Ansible Version Compatibility

- **Ansible 2.20+** enforces strict boolean types on `when:` conditions
- **Deprecation warnings** about `to_text`, `to_bytes`, `collections_compat` are
  from Ansible internals and can be safely ignored
- **Bcrypt/passlib warnings** are harmless (from password_hash filter)
- Use `ansible.builtin.command` for Docker, not `community.docker.*` modules

## Security Model

- **Single root secret** (`mash_playbook_generic_secret_key`) — generate with `pwgen -s 64 1`
- **Derived secrets** — deterministic pattern:
  ```yaml
  {{ 'username:' + (mash_playbook_generic_secret_key + ':service.suffix') | hash('sha512') | password_hash('bcrypt') }}
  ```
- **HTTPS/TLS** — via Traefik reverse proxy
- **Basic Auth** — via Traefik middleware for sensitive services
- **API Key auth** — for MCP services (instead of basic auth)
- **Secrets never committed** — `inventory/host_vars/*/vars.yml` is gitignored

## Service Inventory

### Custom Roles (7)

Custom roles live in `roles/` at the root level. They are injected into the MASH playbook at runtime by `deploy.sh`. Each custom role manages a single service.

| Role | Source | Port | Description |
|------|--------|------|-------------|
| `weather_mcp_server` | `github.com/timzarhansen/weather-mcp` | 8001 | Weather MCP API server (custom repo, built from source) |
| `openwebui` | `github.com/open-webui/open-webui` | — | Open WebUI (LLM chat interface) (custom repo, built from source) |
| `searxng` | `searxng/searxng` | 8080 | Metasearch engine (pre-built Docker image) |
| `homepage` | — | — | Dashboard/homepage (pre-built Docker image) |
| `seafile` | — | — | File sync/sharing platform (pre-built Docker image) |
| `authentik_outpost` | `goauthentik` | — | Auth outpost for Authentik SSO (pre-built Docker image) |

**Note:** `galaxy` is NOT a custom role — it contains Ansible Galaxy roles (~20 services) installed by `install_galaxy_roles()` in `deploy.sh`.

### MASH Native Services

These are built-in MASH-playbook services (not custom roles). They are configured in `vars.yml` and deployed via MASH's own roles. They do NOT have entries in `roles/`.

**Currently configured in vars.yml:**

| Service | Status | Hostname | Data Path |
|---------|--------|----------|-----------|
| `postgres` | enabled | — | `/mash/postgres/data` |
| `memos` | enabled | memos.zarbokk.me | `/mash/memos/data` |
| `headscale` | enabled | headscale.zarbokk.me | `/mash/headscale/data` |
| `headplane` | enabled | headplane.zarbokk.me | `/mash/headplane/data` |
| `authentik` | enabled | authentik.zarbokk.me | `/mash/authentik/data` |
| `wg-easy` | enabled | vpn.zarbokk.me | `/mash/wg-easy/data` |
| `ddclient` | enabled | zarbokk.me (DDNS) | `/mash/ddclient/` |
| `adguard-home` | enabled | adguard.zarbokk.me | `/mash/adguard-home/data` |
| `traefik` | enabled | zarbokk.me | `/mash/traefik/` |
| `immich` | disabled | immich.zarbokk.me | `/mash/immich/` |
| `exim_relay` | disabled | zarbokk.me (email relay) | — |
| `miniflux` | disabled | mash.example.com (example) | — |
| `uptime-kuma` | disabled | uptime-kuma.example.com (example) | — |

**Key distinction:** Custom roles (in `roles/`) = your code, injected at runtime. MASH native services = MASH's built-in roles, configured in vars.yml.

### Galaxy Roles (~20)

`wikimore`, `woodpecker_ci_server`, `woodpecker_ci_agent`, `wordpress`, `writefreely`, `yacy`, `yggstack`, `yourls`, and more.

### Key Galaxy Roles (use these before proposing new ones)

| Role | Purpose |
|------|---------|
| `backup_borg` | BorgBackup + borgmatic encrypted dedup backups |
| `borg_ui` | Web UI for browsing/restoring Borg archives |
| `postgres` | PostgreSQL database server |
| `traefik` | Reverse proxy / TLS termination |
| `memos` | Memo/note taking |
| `headscale` | Headscale (Tailscale control server) |
| `wg-easy` | WireGuard VPN |
| `adguard_home` | DNS ad blocking |
| `authentik` | SSO / identity provider |
| `ddclient` | DDNS updater |
| `immich` | Photo/video management |

## Data Paths Reference

All service data lives in two locations depending on service type:

| Path | Contents | Managed by |
|------|----------|------------|
| `/opt/<service>/` | Custom role data (bind mounts) | Custom roles in `roles/` |
| `/mash/<service>/` | MASH native service data | MASH playbook roles |
| `/mash/postgres/data` | PostgreSQL databases | MASH postgres role |
| `/mash/traefik/ssl/acme.json` | TLS certificates (DNS challenge) | MASH traefik role |
| `/mash/traefik/certs/` | TLS certificate cache | MASH traefik role |
| `/home/zarbokk/` | User home (minimal on server) | System |
| `/etc/` | System configs | System |

**Critical:** When planning backups, monitor, or migrations, always check which pattern applies:
- Custom roles → `/opt/`
- MASH native (configured in vars.yml) → `/mash/`

## Backup

MASH provides built-in `galaxy/backup_borg` role for BorgBackup + borgmatic. Already in `setup.yml` (injected by deploy.sh).

### Enabling backup_borg

Add to `inventory/host_vars/zarbokk.me/vars.yml`:

```yaml
backup_borg_enabled: true
backup_borg_schedule: "*-*-* 03:02:00"
backup_borg_location_source_directories_custom:
  - /mash
  - /opt
  - /etc
backup_borg_location_exclude_patterns_custom:
  - /opt/*/source
  - /proc
  - /sys
  - /dev
  - /tmp
  - /var/lib/docker/overlay2
  - /swap*
backup_borg_location_repositories:
  - /mnt/nas-backup/borg
backup_borg_storage_encryption_passphrase: "<independent passphrase>"
backup_borg_postgresql_enabled: true
backup_borg_container_extra_arguments_custom:
  - "--mount"
  - "type=bind,src=/mnt/nas-backup/borg,dst=/mnt/nas-backup/borg,rw"
```

### Key backup considerations

- **Use `/mash` not `/opt`** — MASH native services store data at `/mash/<service>/`. `/opt/` only covers custom roles.
- **Enable Postgres** — `backup_borg_postgresql_enabled: true` auto-dumps all managed databases.
- **Separate passphrase** — Never derive borg passphrase from `mash_playbook_generic_secret_key`. Rotate independently.
- **NFS mount** — Use `nofail` in fstab so server boots if NAS unavailable.
- **Daily schedule** — `backup_borg_schedule: "*-*-* 03:02:00"` matches retention (7 daily + 4 weekly + 12 monthly).
- **Exclude build sources** — `/opt/*/source` is rebuildable from git/tarballs.
- **Borg Web UI** — Optional `galaxy/borg_ui` role for browser-based restore.
- **Verify backups** — Periodic restore tests. A backup you can't restore is useless.

### Deploy

```bash
./deploy.sh install-all --tags=backup-borg
./deploy.sh start-all --tags=backup-borg
```

### Verify

```bash
systemctl list-timers mash-backup-borg.timer
journalctl -u mash-backup-borg.service -f
```

### Restore

```bash
# Full restore
borgmatic restore /mnt/nas-backup/borg --target /tmp/restore/

# Single path
borgmatic restore /mnt/nas-backup/borg --target /tmp/restore/ --source /mash/authentik

# Single file
borgmatic restore /mnt/nas-backup/borg --target /tmp/ --source /mash/traefik/ssl/acme.json
```

## Troubleshooting

```bash
# Check service status
sudo systemctl status mash-<service>.service
docker ps | grep <service>

# View logs
sudo journalctl -u mash-<service>.service -f
docker logs mash-<service>

# Verify port usage
sudo lsof -i :<port>

# Check Traefik routing
docker logs mash-traefik
dig <hostname>

# Rebuild specific service
./deploy.sh install <service>
```

## Gitignore Rules

```
inventory/host_vars/*/vars.yml          # Secrets
inventory/group_vars/*/vars.yml         # Secrets
mash-playbook/setup.yml                 # Generated
mash-playbook/requirements.yml          # Generated
inventory/group_vars/                   # Generated
roles/galaxy                            # Installed roles
deploy_repos/                           # Local repo cache
```

## Ansible Config

`ansible.cfg` sets `roles_path = mash-playbook/roles:roles` so both upstream and custom roles are discoverable. Pipelining enabled for performance.

## Where to Find Details

| Topic | File |
|-------|------|
| **Detailed templates & step-by-step instructions** | `llm_instructions/README.md` |
| **Deploy script logic** | `deploy.sh` |
| **Role variable defaults** | `roles/*/defaults/main.yml` |
| **Install/uninstall logic** | `roles/*/tasks/*.yml` |
| **Service templates** | `roles/*/templates/` |
| **Server configuration** | `inventory/host_vars/zarbokk.me/vars.yml` |
| **Matrix playbook** | `matrix_deploy.sh`, `matrix_playbook/` |
| **Bootstrap script** | `setup-scripts/bootstrap.sh` |
