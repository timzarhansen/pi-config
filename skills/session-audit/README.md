# Session Audit SKILL

Analyze pi agent sessions to find mistakes preventable by better AGENTS.md information.

## Usage

The SKILL.md contains the full analysis specification. Use it by loading it as a pi skill:

```bash
pi --skill ~/.pi/agent/skills/session-audit/SKILL.md "Audit this session"
```

Or reference it when creating a new session: the skill will automatically discover and analyze the current session.

## Files

- `SKILL.md` — Main skill definition (analysis categories, execution steps, output format)
- `example-audit-report.md` — Example output from auditing the session that created this skill

## How It Works

1. Discovers the current session JSONL file from `~/.pi/agent/sessions/`
2. Parses JSONL entries (user messages, assistant tool calls, results)
3. Checks for:
   - **Tool Misuse** — wrong tool, wrong params, inefficient approaches
   - **Missing Context** — didn't verify files exist, assumed wrong structure
   - **Rule Violations** — broke AGENTS.md rules
4. Generates markdown report with severity levels and copy-paste AGENTS.md suggestions

## Session Location

Sessions are stored in `~/.pi/agent/sessions/` organized by working directory:

```
~/.pi/agent/sessions/
├── --home-user-projects-myapp--/
│   ├── 2026-06-03T15-54-24-614Z_019e8e31-....jsonl
│   └── 2026-06-02T10-30-00-000Z_019e8d00-....jsonl
└── --pi-agent--/
    └── ...
```

Find the most recent: `ls -t ~/.pi/agent/sessions/--<hyphenated-cwd>--/ | head -1`
