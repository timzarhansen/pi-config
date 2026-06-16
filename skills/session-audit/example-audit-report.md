# Session Audit Report

## Summary
- Session: `2026-06-03T15-54-24-614Z_019e8e31-6de6-7af2-a6b1-8b8f02ed310e.jsonl`
- Total messages analyzed: 18 (assistant turns)
- Total tool calls: 11
- Mistakes found: 6
- Severity: Critical: 0 | Warning: 4 | Info: 2

## Mistakes Found

### Missing Context — Searched for session files in project directory
**Severity:** Warning
**Session:** Turn 2 (lines 12-14)
**Tool:** `find`
**What happened:** Agent ran `find **/*session*` and `find **/*.session*` in the project directory, expecting to find session files there.
**What should have happened:** Agent should have known pi stores sessions in `~/.pi/agent/sessions/` organized by working directory, not in the project.
**AGENTS.md gap:** No mention of pi session storage location or format.
**Suggestion:** `Pi sessions are JSONL files in ~/.pi/agent/sessions//, organized by working directory (path with / → -, wrapped in --). Never search for session files in the project.`

---

### Missing Context — ls on non-existent path without verification
**Severity:** Warning
**Session:** Turn 2 (lines 15-16)
**Tool:** `ls`
**What happened:** Agent ran `ls /home/zarbokk_opencode/.pi/agent/skills/server-setup/llm_instructions` which returned "Path not found".
**What should have happened:** Agent should have verified the path exists first, or known that `llm_instructions/` is referenced in the SKILL.md but doesn't actually exist on disk.
**AGENTS.md gap:** No guidance on verifying paths before operating on them.
**Suggestion:** `Before operating on a file or directory, verify it exists first with ls or read. Don't assume paths referenced in documentation actually exist on disk.`

---

### Tool Misuse — Read full pi README instead of grepping
**Severity:** Info
**Session:** Turn 4 (lines 29-30)
**Tool:** `read`
**What happened:** Agent read the entire pi README (~50KB) to find session-related information.
**What should have happened:** Agent should have used `grep -r "session" /pi-agent/packages/coding-agent/README.md` or read only the Sessions section.
**AGENTS.md gap:** No guidance on efficient file reading (grep vs read).
**Suggestion:** `Use grep -r to search file contents before reading entire files. Read full files only when you need the complete content.`

---

### Missing Context — Assumed llm_instructions/ directory exists
**Severity:** Warning
**Session:** Turn 2 (lines 15-16)
**Tool:** `ls`
**What happened:** Agent tried to list `llm_instructions/` directory, which doesn't exist. The server-setup SKILL.md references it as a pointer to detailed docs, but the directory is absent.
**What should have happened:** Agent should have discovered the directory was missing and noted the documentation gap, rather than just getting an error.
**AGENTS.md gap:** No rule about flagging documentation that references non-existent files.
**Suggestion:** `When documentation references a path that doesn't exist, flag it as a documentation gap (⚠️). Don't just report the error — note what's missing.`

---

### Missing Context — Didn't use /session command to find session
**Severity:** Info
**Session:** Turn 1 (throughout)
**Tool:** N/A (approach)
**What happened:** Agent manually searched for session files instead of using pi's built-in `/session` command or known session location.
**What should have happened:** Agent could have used `pi --session` or known the session storage pattern directly.
**AGENTS.md gap:** No mention of pi session management commands or storage pattern.
**Suggestion:** `Pi provides /session command to show current session info. Sessions are in ~/.pi/agent/sessions/ organized by working directory. Use ls -t to find the most recent.`

---

### Missing Context — Over-structured with plan_question
**Severity:** Warning
**Session:** Turn 5 (lines 36-38)
**Tool:** `plan_question`
**What happened:** Agent asked 4 plan_question questions (Input, Mistakes, Output, Scope) before doing any analysis. The user's request was simple enough that the agent could have made reasonable defaults and proceeded.
**What should have happened:** Agent should have made reasonable assumptions (current session, all categories, markdown report, AGENTS.md scope) based on the user's context and proceeded directly.
**AGENTS.md gap:** No guidance on when to ask questions vs. make assumptions.
**Suggestion:** `Don't over-structure simple requests. Make reasonable defaults based on context and proceed. Only ask questions when the ambiguity would significantly impact the outcome.`

---

## AGENTS.md Patch Suggestions

### Add to "Important rules/General guidelines":

```markdown
- Pi sessions are JSONL files in ~/.pi/agent/sessions/, organized by working directory (path with / → -, wrapped in --). Never search for session files in the project.
- Before operating on a file or directory, verify it exists first with ls or read. Don't assume paths referenced in documentation actually exist.
- Use grep -r to search file contents before reading entire files. Read full files only when you need the complete content.
- When documentation references a path that doesn't exist, flag it as a documentation gap (⚠️). Don't just report the error.
- Don't over-structure simple requests with too many clarification questions. Make reasonable defaults based on context and proceed.
```

## Patterns

1. **Location assumption errors** — Agent repeatedly searched in wrong places (project dir for sessions, non-existent subdirectories). AGENTS.md should include common pi paths and patterns.
2. **Inefficient file access** — Agent read entire files when grepping would suffice. AGENTS.md should specify grep-first approach.
3. **Missing verification step** — Agent operated on paths without checking existence. AGENTS.md should mandate verification before file operations.
