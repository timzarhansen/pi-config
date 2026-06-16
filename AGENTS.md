# Global Agent Instructions

## General Rules
- When planning an extension, the main repo of the agent is in /pi-agent


**Plan → Verify → Execute → Commit → Report**

## Plan Mode Discipline
- Plan mode is STRICTLY READ-ONLY. No file writes, no edits, no bash that modifies files.
- Forbidden: `cat >`, `tee`, `echo >>`, `mv`, `cp`,`ssh`, and any command that creates/modifies/deletes files.
- Allowed: `read`, `grep`, `find`, `ls`, `bash` (read-only operations only: `ls`, `grep`, `find`, `cat`, `echo`, etc.), `plan_read`, `plan_list`, `plan_question`, `plan_write`.
- If you need to write files, exit plan mode first (`/plan`), then execute.
- Plan mode ≠ implementation mode. They are distinct phases.
- When in plan mode, if you catch yourself about to write a file — STOP.
- NEVER delete files without asking. This applies in plan mode and implementation mode.

## Context Gathering

- Read documentation first as an overview, then dive into source files. Docs tell you what to look for; source files tell you the actual implementation.
- Use `read` on directories to list contents — do NOT use `bash ls -la` or similar. `read` returns the same listing with lower overhead.
- Batch reads by type: read all source files first, then all target files. Don't interleave reads with bash commands or doc searches.
- After reading all key files from both source and target, stop exploring. You have enough context to plan.
- Don't re-read files you've already read. If you need more info, it should be from a different file.
- If a doc or file lookup fails, try once with a corrected path. If it fails again, move on — don't chain multiple failed lookups.
- Aim for ≤15 total tool calls in plan mode before asking clarifying questions.
- Ask questions instead of continuing to explore when you have enough context to make a solid plan.
- Pi extensions live in `~/.pi/agent/extensions/`, NOT `/pi-agent/extensions/` or `~/.pi/extensions/`. When searching for agent extensions, start with `~/.pi/agent/extensions/`.
- Pi sessions are in `~/.pi/agent/sessions/` (NOT `~/.pi/` root). Use `find ~/.pi/agent/sessions -name "*.jsonl"` not `find ~/.pi -name "*.jsonl"`.
- Before searching for a file, check if a skill or AGENTS.md section already documents its location.
- `plan_question` headers are limited to 12 characters. Keep headers short and descriptive.
- When a search in one directory returns nothing, immediately check if the file might be in a related directory (e.g., `/pi-agent` vs `~/.pi/agent/` vs project-local `.pi/`).

## Reading Order

Follow this order when gathering context for a task:

1. **List directories** — read both source and target directories
2. **Read docs** — any relevant documentation for overview (not deep dive)
3. **Read source files** — establish the pattern/behavior you're copying or matching
4. **Read target files** — identify what exists and what gaps remain
5. **Ask questions** — clarify ambiguities before planning
6. **Write plan** — with full context gathered

- When exploring a project's `.pi/` directory, read the top-level `ls` output first to discover `extensions/`, `skills/`, `themes/`, etc. before guessing paths.

Complete each phase before moving to the next. Don't switch back and forth between phases.

## Pre-Plan Verification
Before writing a plan:
1. List all target files and their key contents
2. List all source files and their key contents
3. Identify what already exists in the target that matches the source
4. Only propose changes for actual gaps
5. Explicitly list preserved items
- Read all relevant files in both source and target before proposing changes. "Relevant" = files containing setup logic, configuration, or build instructions for what you're working on. Skip README, .dockerignore, and similar files unless they directly affect the task.
- Verify existing infrastructure: bind mounts, installed packages, configured services. Don't assume nothing exists.
- Check file contents, not just names.
- Before writing documentation, verify: file existence, counts, ports, tags, function signatures.
- Before proposing a new tool, role, or service, check if one already exists:
  - Search the project for existing implementations (`grep`, `find`)
  - Check dependency lists (package.json, requirements.txt, ansible roles, etc.)
  - Check for built-in/official modules or plugins
  - Compare: "am I building what already exists?"
- Before proposing a new configuration pattern, check defaults/config files for existing settings.
- Assume nothing is missing — verify what's already there before suggesting additions.
- Verify where data actually lives — don't assume a single pattern:
  - Check defaults/config files for path variables
  - Look for multiple storage patterns (e.g., custom paths vs. framework defaults)
  - Verify against actual instance files, not just documentation
- When planning backups, migrations, or monitoring: enumerate ALL data locations across all patterns.
- Before deriving new secrets from existing ones, verify rotation policies:
  - If a master secret is rotated, derived secrets become unusable
  - Independent secrets (encryption keys, backup passphrases) must survive master secret rotation
  - Ask: "if I rotate X, will Y break?"

## Planning Behavior
- Always create a plan before making changes.
- Break tasks into steps before execution.
- When the plan is finalized, add a summary for the user how the plan looks like.
- Also add a Risk/ Notes section, to include potential problems and important notes for the user

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
- When extractin
- g templates, diff against actual instances. Report deltas.

<!-- context7 -->
Use Context7 MCP to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer -- your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

## Steps

1. Always start with `resolve-library-id` using the library name and the user's question, unless the user provides an exact library ID in `/org/project` format
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries (e.g., "next.js" not "nextjs", or rephrase the question). Use version-specific IDs when the user mentions a version
3. `query-docs` with the selected library ID and the user's full question (not single words)
4. Answer using the fetched docs
<!-- context7 -->