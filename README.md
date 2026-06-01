# pi-agent Configuration Repository

Portable pi-agent configuration for use in Docker containers across machines.

## Setup

1. Clone this repo on your host machine:

   ```bash
   git clone git@github.com:timzarhansen/pi-config.git ~/pi-agent-config
   ```

2. Bind-mount it into your container as `~/.pi/agent/`:

   ```yaml
   volumes:
     - ~/pi-agent-config:/home/zarbokk_opencode/.pi/agent
   ```

3. Start pi — it will create `sessions/`, `npm/`, and other runtime directories automatically.

## Structure

### Tracked (reusable across machines)

| Path | Description |
|------|-------------|
| `AGENTS.md` | Global agent instructions |
| `settings.json` | Default settings and installed packages |
| `models.json` | Provider/model definitions |
| `skills/` | Custom skills |
| `extensions/` | Custom extensions |
| `prompts/` | Prompt templates |
| `themes/` | Theme configurations |
| `agents/` | Agent definitions |
| `compound-engineering/` | Compound engineering plugin manifest |
| `bin/` | Helper binaries |

### Gitignored (per-machine, transient)

| Path | Description |
|------|-------------|
| `sessions/` | Conversation history (per-project) |
| `auth.json` | API credentials |
| `npm/` | Installed npm packages |
| `git/` | Installed git packages |
| `plans/` | Temporary planning output |
| `run-history.jsonl` | Local run history |

## Notes

- pi creates gitignored directories on first run
- `settings.json` `packages` array controls which npm packages are installed
- Add skills, extensions, prompts, and themes to the tracked directories to share across machines
