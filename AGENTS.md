# Global Agent Instructions

**Plan → Verify → Execute → Commit → Report**

## Plan Mode Discipline
- Plan mode is STRICTLY READ-ONLY. No file writes, no edits, no bash that modifies files.
- Forbidden: `cat >`, `tee`, `echo >>`, `mv`, `cp`, and any command that creates/modifies/deletes files.
- Allowed: `read`, `grep`, `find`, `ls`, `bash` (read-only operations only: `ls`, `grep`, `find`, `cat`, `echo`, etc.), `plan_read`, `plan_list`, `plan_question`, `plan_write`.
- If you need to write files, exit plan mode first (`/plan`), then execute.
- Plan mode ≠ implementation mode. They are distinct phases.
- When in plan mode, if you catch yourself about to write a file — STOP.
- NEVER delete files without asking. This applies in plan mode and implementation mode.

## Pre-Plan Verification
Before writing a plan:
1. List all target files and their key contents
2. List all source files and their key contents
3. Identify what already exists in the target that matches the source
4. Only propose changes for actual gaps
5. Explicitly list preserved items
- Read ALL target files before proposing changes. Check docker-compose.yml, Dockerfile, devcontainer.json, postCreateCommand.sh — don't skip any.
- Verify existing infrastructure: bind mounts, installed packages, configured services. Don't assume nothing exists.
- Run `ls` on the target directory to see all files. Check file contents, not just names.
- Before writing documentation, verify: file existence, counts, ports, tags, function signatures.

## Planning Behavior
- Always create a plan before making changes.
- Break tasks into steps before execution.
- When the plan is finalized, add a summary for the user how the plan looks like.

## Ambiguity Resolution
- When the task could mean "add" or "replace", clarify with the user before planning.
- Example: "You want to add pi-agent to the existing setup, or replace the entire setup?"
- List what will be kept vs changed in the plan before executing.

## Prefer Surgical Edits Over Rewrites
- Before proposing a full file rewrite, ask: "Does the target already have X?"
- Compare source and target to find actual deltas. Propose minimal changes.
- If the goal is "add X" — append, don't replace. If the goal is "replace with X" — confirm explicitly.
- Preserve existing functionality.

## Post-Implementation
- Only execute after plan is complete.
- Prefer minimal diffs.
- Validate changes with tests if available.
- Create a commit after implementing a change.
- After implementation, give the user a few commands to test, and what you implemented, to let the user test if it actually worked.
- The verification of implementations should be done by the user, not the agent. Give tips how to test it.

## Documentation Integrity
- Always diff documentation against actual source code before writing. README ≠ truth.
- Flag files that contradict code. Mark legacy docs ⚠️. Remove stale files from architecture trees.
- When extracting templates, diff against actual instances. Report deltas.
