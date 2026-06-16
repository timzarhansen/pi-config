---
name: session-audit
description: >
  Analyze pi agent sessions to find mistakes that could have been prevented
  by better information in AGENTS.md, skills, or extensions. Supports single-session
  analysis and batch mode (last 24h across all working directories). Produces
  structured markdown reports with AGENTS.md improvement suggestions and
  generates actionable improvement plans via plan_write.
---

# Session Audit SKILL

## Purpose

Analyze pi agent sessions (JSONL) to find mistakes the agent made that could have been prevented by better information in AGENTS.md, skills, or extensions. Supports two modes:
- **Single mode** — analyze the current or most recent session
- **Batch mode** — scan all sessions from the last 24 hours across all working directories, identify recurring patterns, and generate an improvement plan

## When to Use

Use this skill when you want to:
- Review a past session for workflow improvement opportunities
- Identify gaps in AGENTS.md that caused agent mistakes
- Improve agent behavior through better documentation
- Run a retrospective on the last 24 hours of sessions
- Find recurring mistakes across multiple sessions
- Generate an improvement plan for AGENTS.md, skills, or extensions

## Input

**Single mode:** Analyzes the current session automatically. No file path argument needed.
**Batch mode:** Scans `~/.pi/agent/sessions/` for all sessions modified in the last 24 hours.

## Session Discovery

Pi stores sessions as JSONL files in `~/.pi/agent/sessions/`, organized by working directory. The directory name is the working directory path with `/` replaced by `-`, wrapped in `--`.

**Pattern:** `~/.pi/agent/sessions/--<cwd-with-hyphens>--/<timestamp>_<uuid>.jsonl`

**Example:**
```
CWD: /home/user/projects/myapp
Session dir: ~/.pi/agent/sessions/--home-user-projects-myapp--/
```

**Find the most recent session:**
```bash
ls -t ~/.pi/agent/sessions/--<hyphenated-cwd>--/ | head -1
```

**Env var override:** `PI_CODING_AGENT_SESSION_DIR` can override the session storage location.

## Batch Mode

Scan all sessions from the last 24 hours across all working directories.

**Find recent sessions:**
```bash
find ~/.pi/agent/sessions -name "*.jsonl" -mtime -1 | sort
```

**Find recent sessions in a specific directory:**
```bash
find ~/.pi/agent/sessions/--<hyphenated-cwd>--/ -name "*.jsonl" -mtime -1 | sort
```

**Batch Analysis Workflow:**
1. **Discover** — Find all sessions from last 24h across all directories
2. **Parse** — For each session, read JSONL entries; extract user messages, assistant tool calls, tool results, and thinking blocks
3. **Analyze tool calls** — Check each tool call for misuse patterns (wrong tool, wrong params, inefficiency)
4. **Analyze logic** — Evaluate reasoning quality, assumption accuracy, path efficiency, and pattern recognition
5. **Check rule compliance** — Verify AGENTS.md rules were followed (planning, confirmation, commits)
6. **Identify context gaps** — Flag places where the agent should have read/verified but didn't
7. **Aggregate** — Group findings by category; count occurrences across sessions; identify top recurring patterns
8. **Summarize** — Produce a concise error summary with counts by category and severity
9. **Generate plan** — Use `plan_write` to create an improvement plan with specific changes to AGENTS.md, skills, or extensions
10. **Report** — Output structured markdown with findings and the generated plan

## Session Format

Sessions are JSONL files. Each line is a JSON object. Key entry types:
- `"type":"session"` — header with version, id, cwd
- `"type":"message"` — user/assistant messages with tool calls
- `"type":"toolCall"` — embedded in assistant messages
- `"type":"toolResult"` — tool output
- `"type":"thinking"` — agent reasoning (in assistant messages)
- `"type":"custom"` — plan mode, UI state changes

Parse line-by-line. Skip non-message entries for analysis.

## Analysis Categories

### 1. Tool Misuse
- Wrong tool chosen (e.g., `write` instead of `edit` for partial changes)
- Wrong parameters or flags
- Inefficient approach (e.g., `find` + `grep` when `grep -r` suffices)
- Dangerous operations without confirmation
- Operations that should have been read-only but weren't
- Using `find` for known paths (e.g., searching for session files when location is standard)

### 2. Missing Context
- Didn't check if files/directories exist before operating on them
- Didn't read existing docs before writing new ones
- Assumed wrong project structure or file locations
- Ignored existing patterns/conventions in the codebase
- Didn't verify assumptions before acting
- Operated on wrong files/directories
- Read full files when grepping would have sufficed
- Didn't use `ls` to discover what's available before making assumptions

### 3. Rule Violations
- Violated AGENTS.md rules (deleted without asking, didn't create a plan, etc.)
- Skipped steps the agent was supposed to follow
- Made changes without user confirmation
- Didn't provide testing instructions after implementation
- Didn't commit changes
- Exceeded plan mode boundaries (did write/edit during plan phase)

### 4. Logic Errors
- **Wrong assumptions** — Agent assumed X but Y was true (wrong file location, wrong API behavior, wrong project structure, wrong dependency state)
- **Inefficient paths** — Agent took N steps when M would suffice (wrong order of operations, missing shortcuts, redundant reads, re-reading files already in context)
- **Missed patterns** — Agent didn't recognize existing patterns in codebase that could be reused (existing functions, conventions, infrastructure, similar files)
- **Reasoning gaps** — Agent's reasoning led to suboptimal decisions (didn't consider alternatives, jumped to conclusions without verification, didn't cross-reference tool results)
- **Context blindness** — Agent ignored relevant context (user hints, previous tool results, error messages, plan mode constraints)

### 5. Workflow Bottlenecks
- **Token waste** — Excessive reads, redundant tool calls, verbose outputs that could be concise, reading full files when grep would suffice
- **Missing verification** — Didn't verify assumptions before acting (file existence, service status, dependency versions, build state)
- **Premature action** — Acted before gathering enough context (wrote code before understanding the problem, edited before reading, planned before exploring)

## Execution Steps

### Single Mode
1. **Discover session** — Find the most recent session JSONL for the current working directory using the pattern above
2. **Parse session** — Read and parse JSONL entries, extract user messages, assistant tool calls, and results
3. **Analyze tool calls** — Check each tool call for misuse patterns (wrong tool, wrong params, inefficiency)
4. **Analyze logic** — Evaluate reasoning quality, assumption accuracy, path efficiency, and pattern recognition
5. **Check rule compliance** — Verify AGENTS.md rules were followed (planning, confirmation, commits)
6. **Identify context gaps** — Flag places where the agent should have read/verified but didn't
7. **Generate report** — Output structured markdown with findings and AGENTS.md suggestions

### Batch Mode
See `## Batch Mode` workflow above (10 steps).

## Severity Levels

- **Critical** — Could cause data loss, security issues, or broken state
- **Warning** — Suboptimal approach, wasted tokens, missed opportunity, or minor rule violation
- **Info** — Good practice improvement, documentation gap, efficiency gain

## Output Format

### Single Session Report

```markdown
# Session Audit Report

## Summary
- Session: <filename>
- Total messages analyzed: N
- Total tool calls: N
- Mistakes found: N
- Severity: Critical: N | Warning: N | Info: N

## Mistakes Found

### [Category] — [Brief Description]
**Severity:** Critical/Warning/Info
**Session:** Line N → Line M
**Tool:** <tool_name> (if applicable)
**What happened:** [Description of the mistake]
**What should have happened:** [Correct behavior]
**AGENTS.md gap:** [What info was missing from AGENTS.md]
**Suggestion:** [Exact text to add to AGENTS.md]

---

## AGENTS.md Patch Suggestions

[Concrete, copy-paste-ready additions organized by section]

## Patterns

[Recurring patterns across multiple mistakes — e.g., "Agent consistently searched for X when Y would be faster"]
```

### Batch Report Format

```markdown
# Session Audit Report (Batch)

## Summary
- Time range: [start] → [end]
- Sessions analyzed: N
- Total tool calls: N
- Total mistakes: N
- Severity: Critical: N | Warning: N | Info: N

## Errors by Category
- Tool Misuse: N
- Missing Context: N
- Rule Violations: N
- Logic Errors: N
- Workflow Bottlenecks: N

## Top Recurring Patterns
1. [Pattern] — appeared in N sessions (severity: X)
2. [Pattern] — appeared in N sessions (severity: X)
3. [Pattern] — appeared in N sessions (severity: X)

## Error Summary

### Critical Errors
[Brief list of critical errors, one per session]

### Logic Errors
[Brief list of logic errors with root cause]

### Workflow Bottlenecks
[Brief list of bottlenecks with estimated token/time waste]

## Detailed Findings

### Session: <filename>
- Tool Misuse: N
- Logic Errors: N
- [Key findings, 2-3 bullet points]

[Repeat per session]

## Improvement Plan
- Plan file: <plan_filename>
- Summary: [What the plan addresses]
- Key changes: [Top 3 changes proposed]
```

## AGENTS.md Suggestion Format

Each suggestion must be:
- **Exact text** that can be copied directly into AGENTS.md
- **Categorized** under the appropriate AGENTS.md section
- **Concise** — one line or bullet point
- **Actionable** — tells the agent what to do, not why
- **Specific** — include exact paths, commands, or patterns when applicable

### Good examples:
```markdown
- Pi sessions are stored in `~/.pi/agent/sessions/` organized by working directory (path with `/` → `-`, wrapped in `--`). Never search for session files in the project.
- Before `ls`-ing a path, verify it exists first. Don't assume directory structures.
- Use `grep -r` instead of `find` + `grep` for searching file contents.
- Use `read` to check file existence and content before operating on files.
```

### Bad examples:
```markdown
- Be more careful about file paths. (Too vague)
- The agent should have known about session locations. (Not actionable)
- Always read the docs. (Too generic)
```

## Plan Generation

After completing a batch analysis, generate an improvement plan using `plan_write`.

**Plan structure:**
```yaml
---
filename: session-improvements-YYYYMMDD
title: Session Improvements - [date]
type: refactor
---
```

**Plan content should include:**
1. **Summary** — Error counts by category, severity breakdown, top recurring patterns
2. **AGENTS.md changes** — Exact text to add or modify, organized by section
3. **Skill changes** — Skills to create, modify, or remove (with descriptions of what each change addresses)
4. **Extension proposals** — If a new extension would prevent recurring issues (describe purpose and scope)
5. **Phased implementation** — Ordered steps for applying changes, with verification criteria per phase
6. **Expected impact** — Which mistakes each change prevents, estimated frequency reduction

**When to propose each type of fix:**
- **AGENTS.md** — For rule violations, context gaps, and patterns that apply to all projects
- **New skill** — For project-specific or domain-specific knowledge that is too detailed for AGENTS.md
- **Extension** — For automated checks, custom tools, or integrations that prevent errors at runtime
- **Skill modification** — For existing skills that have gaps causing recurring mistakes

## ⏸️ Pause Point

Before writing the final report:
1. Confirm the session file(s) were found and parsed correctly
2. Show the mistake count per category
3. For batch mode: show top 3 recurring patterns
4. For batch mode: show proposed plan summary (what changes will be proposed)
5. Ask: "Proceed with full report and plan generation?"
