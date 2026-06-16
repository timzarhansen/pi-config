# Autosuggestion Extension — Behavior Specification

> Target file: `~/.pi/agent/extensions/autosuggestion/BEHAVIOR.md`
> Purpose: Single source of truth for what the extension does, how it does it, and what edge cases must be handled.

---

## 1. Overview

Background LLM predicts next words while the user types in the interactive input. Ghost text (dimmed, `\x1b[2m`) appears after the cursor. `Tab` accepts one word at a time. The model re-predicts when the word buffer runs low. Two completion sources compose: **classical prefix completion** (instant, local word dictionary) and **LLM prediction** (async, contextual).

### Config (`~/.pi/agent/autosuggestion.json`)

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Master on/off |
| `baseUrl` | string | `http://localhost:11434/v1` | OpenAI-compatible completions endpoint |
| `model` | string | `qwen2.5:1.5b` | Model name |
| `debounceMs` | number | `300` | Debounce for typing-triggered predictions |
| `maxTokens` | number | `50` | Max completion tokens per request |
| `contextTokens` | number | `1000` | Session context tokens (≈4 chars/token) |
| `enableClassicalCompletion` | boolean | `true` | Enable instant prefix completion |
| `classicalMinChars` | number | `3` | Min prefix length for classical completion |
| `workspaceScanDepth` | number | `3` | Directory depth for workspace word scanning |
| `maxVisibleWords` | number | `10` | Max ghost text words shown per paragraph |
| `repredictThreshold` | number | `3` | Words remaining before reprediction triggers |

---

## 2. Core Components

### 2.1 PredictionService

Manages the word buffer and LLM API calls.

**State:**
- `wordBuffer: string[]` — words to be consumed by Tab
- `isPredicting: boolean` — guard against concurrent API calls
- `generation: number` — monotonically increasing counter to invalidate stale responses
- `contextText: string` — cached session context (refreshed on `turn_end`)
- `pending: AbortController | null` — for aborting in-flight requests
- `repredictThreshold: number` — config-driven reprediction threshold
- `predictionQueue: string | null` — queued prediction text when API call in-flight
- `rawCompletion: string` — full LLM completion with newlines preserved
- `paragraphWords: string[][]` — words grouped by paragraph for multi-line ghost text

**Methods:**

| Method | Behavior |
|---|---|
| `predict(text, skipDebounce?)` | Debounce (unless `skipDebounce`), queue if API in-flight, call `/completions`, parse paragraphs into `wordBuffer` + `paragraphWords`, fire `onPrediction`, fire queued prediction in `finally` |
| `nextWord()` | Shift and return first word from buffer, or `null` |
| `buildGhostText()` | Rebuild ghost text from `paragraphWords`, skipping consumed words, preserving `\n` between paragraphs |
| `shouldRepredict()` | `wordBuffer.length <= repredictThreshold` (no param, uses config) |
| `cancel()` | Abort in-flight, clear debounce, increment generation, clear buffer + queue + raw completion |
| `updateContext(sm)` | Rebuild `contextText` from session entries (most recent first, up to `contextTokens * 4` chars) |

**API request format:**
```json
{
  "model": "<model>",
  "prompt": "<contextText><currentEditorText>",
  "max_tokens": <maxTokens>,
  "temperature": 0.7,
  "stream": false,
  "stop": ["\n\n", "\n\n\n"]
}
```

### 2.2 GhostEditor

Extends `CustomEditor`. Overrides `handleInput` and `render`.

**State:**
- `ghostText: string` — full ghost text (may span multiple lines after wrapping)
- `classicalWordSuffix: string` — cached suffix for current classical completion
- `classicalWordFull: string` — full completed word (for LLM prompt augmentation)

**Key behaviors:**

| Event | Action |
|---|---|
| Printable char typed | `super.handleInput()` → check classical completion → call `onPredict(text)` with debounce |
| Tab + classical suffix active | Insert suffix → show remaining LLM buffer → repredict if `shouldRepredict` |
| Tab + LLM word in buffer | Insert word (with leading space if needed) → update ghost → repredict if `shouldRepredict` |
| Tab + nothing to accept | Fall through to `super.handleInput(data)` (default Tab = autocomplete) |
| Non-printable key (arrows, escape, etc.) | Clear ghost text, clear classical state, cancel prediction |
| Escape | Clear ghost + cancel (same as non-printable path) |

### 2.3 WordDictionary

Local prefix completion from session words + workspace file paths.

- `addWord(word)` — stores lowercase, tracks frequency
- `addWordsFromText(text)` — regex `[a-zA-Z][a-zA-Z0-9_-]{1,}` extraction
- `addPathsFromWorkspace(root, depth)` — recursive walk, skips dotfiles, strips extensions
- `complete(prefix, maxResults)` — prefix match, sorted by frequency desc then length asc

### 2.4 Session Context

`buildSessionContextText(sessionManager, maxTokens)`:
- Collects `user`, `assistant`, `toolResult` messages
- Walks backwards from most recent
- Accumulates until `maxTokens * 4` chars
- Format: `Role: text\n`

---

## 3. Ghost Text Rendering

### 3.1 Single-line ghost text

When ghost text fits on the current line after the cursor:
1. Find cursor highlight (`\x1b[7m...\x1b[0m`) in rendered lines
2. Calculate `visualCursorPos` = visible chars before highlight (stripping ANSI)
3. `availableWidth = width - visualCursorPos - paddingX`
4. Append `\x1b[2m<ghost>\x1b[22m` after cursor highlight's `\x1b[0m`
5. `truncateToWidth(line, width)` to prevent overflow

### 3.2 Multi-line ghost text (wrapping)

When ghost text exceeds `availableWidth`:
1. Split ghost text into words, limit to `maxVisibleWords`
2. Wrap words by `availableWidth` using word-boundary wrapping (greedy, no hyphenation)
3. Cap to 3 wrapped lines maximum
4. First wrapped line → appended to cursor line
5. Subsequent wrapped lines → `lines.splice(i + 1, 0, ...)` inserted after cursor line
6. Each line truncated to `width`
7. All ghost lines styled `\x1b[2m...\x1b[22m` (dim)

### 3.3 Fallback (cursor highlight not found)

If cursor highlight not found in rendered output:
- Append to `lines[lines.length - 2]` (second-to-last line, assuming last is bottom border)
- Same wrapping/truncation logic

---

## 4. Classical + LLM Composition

When user is mid-word (prefix ≥ `classicalMinChars`):

1. Classical completion runs synchronously → returns `{suffix, full}` or `null`
2. If match found:
   - Ghost text shows: `<classical_suffix> <llm_remaining_words>`
   - LLM prompt augmented with full classical word: `getText() + classical.full`
   - **Deduplication**: if LLM's first word matches classical full word (case-insensitive), strip it from ghost text
3. If no match:
   - Ghost text shows LLM buffer only
   - LLM prompt is raw `getText()`

**Tab acceptance priority:** classical suffix first, then LLM words.

---

## 5. Lifecycle

| Event | Action |
|---|---|
| `session_start` | Create `PredictionService`, build `WordDict`, set editor component, wire callbacks, preload context |
| `turn_end` | Refresh session context, add new session words to dictionary |
| `input` (source=interactive) | Clear ghost text (submit happened) |
| `session_shutdown` | Cancel in-flight prediction |
| `/autosuggest` command | Toggle `enabled`, persist to config, notify user |

---

## 6. Edge Cases — Current Behavior

### 6.1 Empty buffer + Tab
- If `classicalWordSuffix` exists → insert suffix
- If `wordBuffer` has words → insert next word
- If both empty → fall through to parent `handleInput` (default Tab = autocomplete trigger)

### 6.2 Rapid Tab presses
- Each Tab consumes one word, updates ghost, checks `shouldRepredict`
- `shouldRepredict` fires when `buffer.length <= repredictThreshold` (default: 3)
- With `skipDebounce=true`, reprediction starts immediately (no 300ms wait)
- **New words are appended** to existing buffer (`.push()`), not replaced — preserves words user hasn't reached yet
- **All words merged into a single paragraph** — no artificial line breaks from paragraph boundaries
- If API call in-flight, prediction is **queued** with merge intent preserved (latest wins). Fired in `finally` block after current call completes.

### 6.3 Typing during active ghost text
- Printable char → `super.handleInput()` processes char → new prediction triggered
- **Buffer is replaced** (not merged) — old predictions are stale, new context requires fresh prediction
- Ghost text is NOT cleared on printable input — it gets replaced by new prediction result
- Classical completion re-evaluated on each keystroke

### 6.4 Arrow keys / Escape during ghost text
- Ghost text cleared, classical state cleared, prediction cancelled
- Parent handles the key normally

### 6.5 Multi-line editor content
- Ghost text renders relative to cursor position in rendered output
- Wrapping accounts for `availableWidth` on the cursor's visual line
- If cursor is on a wrapped continuation line, ghost text still appends to that line

### 6.6 LLM returns empty / whitespace-only completion
- `words.filter(w => w.length > 0)` → empty array
- `wordBuffer` cleared, `onPrediction("")` fired → ghost text cleared

### 6.7 LLM returns text with single newlines
- `stop` sequences are `\n\n` and `\n\n\n` — single `\n` allowed in completion
- **Single `\n` within a paragraph → normalized to space** (prevents 1-word-per-line rendering)
- **`\n\n+` = paragraph break** (2+ newlines create paragraph boundaries)
- Newlines preserved in `rawCompletion` and `paragraphWords`
- `buildGhostText()` reconstructs multi-line ghost text with `\n` between paragraphs
- Tab consumes words sequentially across paragraphs; empty paragraphs skipped in display

### 6.8 Terminal resize during ghost text display
- `render(width)` called with new width on next frame
- `availableWidth` recalculated → wrapping adjusts
- No explicit resize handler — relies on TUI re-render cycle

### 6.9 Cursor at end of line (no char to highlight)
- Editor renders `\x1b[7m \x1b[0m` (highlighted space) for end-of-line cursor
- `visualCursorPos` counts chars before this highlight
- Ghost text appended after the highlighted space

### 6.10 Very long single word in ghost text
- `wrapGhostText` does NOT break words — a word wider than `availableWidth` goes on its own line
- `truncateToWidth` then clips it to `width`

### 6.11 Session context exceeds token budget
- `buildSessionContextText` walks backwards, stops when budget exhausted
- Oldest messages dropped, most recent kept
- If first message already exceeds budget → only that message included (partial)

### 6.12 Config file missing / invalid JSON
- `loadConfig()` catches all errors → returns defaults
- No user notification

### 6.13 API error / network failure
- Non-200 response → `onError` fires → `ctx.ui.notify(..., "error")` + ghost text cleared
- `AbortError` silently ignored (expected on cancel)
- Other errors → `onError` fires + `wordBuffer` cleared + `onPrediction("")` fired + ghost text cleared in handler

### 6.14 Classical completion prefix regex
- Only matches words starting with `[a-zA-Z]` followed by `[a-zA-Z0-9_-]*`
- Words starting with numbers, underscores, or special chars → no classical completion
- Path-like prefixes (`/path/to`) → no classical completion

### 6.15 Word dictionary growth
- `turn_end` **rebuilds** dictionary from scratch (clear + re-add all session words + workspace paths)
- This prevents frequency inflation from repeated incremental adds
- Dictionary capped at **10,000 unique words** (`WordDictionary.MAX_SIZE`)
- When cap reached, lowest-frequency word evicted on next `addWord`

---

## 7. Improvements

### 7.1 Reprediction Queue ✅ Implemented

When `isPredicting` is true, prediction text is **queued** (latest wins). After the current API call completes, the queued prediction fires immediately (skipDebounce). `cancel()` clears the queue.

### 7.2 Multi-line Ghost Text ✅ Implemented

Newlines in LLM completions are preserved. `rawCompletion` stores the full text, `paragraphWords` groups words by paragraph. `buildGhostText()` reconstructs multi-line ghost text, skipping consumed words and empty paragraphs. `render()` wraps each paragraph independently, using `availableWidth` for the cursor line and full content width for continuation lines. Cap: 6 wrapped lines total. `maxVisibleWords` is a **global** budget across all paragraphs.

### 7.3 Reprediction Threshold Tuning ✅ Implemented

New config key `repredictThreshold` (default: 3) decouples reprediction timing from display width. `shouldRepredict()` uses this value (no parameters).

### 7.4 Dictionary Size Cap ✅ Implemented

`WordDictionary.MAX_SIZE = 10000`. When cap reached, `addWord` evicts the lowest-frequency word.

### 7.5 Classical Completion for More Prefix Types ⏳ Not Implemented

Only `[a-zA-Z]` starting words get classical completion. Paths, numbers, and special prefixes are excluded. Future: add secondary regex for path-like prefixes with filesystem lookup.

### 7.6 Ghost Text Staleness on Error ✅ Implemented

On empty completion: `wordBuffer` cleared, `onPrediction("")` fired → ghost text cleared.
On API error: `wordBuffer` cleared, `onPrediction("")` fired + `onError` fires + `setGhostText("")` in error handler.

---

## 8. Verification Matrix

| Scenario | Expected Behavior |
|---|---|
| Type "hello " → ghost appears | Prediction fires after 300ms debounce, ghost shows predicted words |
| Press Tab 15x rapidly | Each Tab inserts one word. Reprediction fires immediately (skipDebounce). If API in-flight, text queued. Buffer refills mid-way. |
| Press Tab with empty buffer | Falls through to default Tab (autocomplete) |
| Type new text while ghost active | Ghost replaced with new prediction. If API in-flight, text queued. Classical completion re-evaluated. |
| Arrow key while ghost active | Ghost cleared. Prediction cancelled. Cursor moves. |
| Escape while ghost active | Ghost cleared. Prediction cancelled. |
| LLM returns empty | Ghost text cleared (buffer emptied, `onPrediction("")` fired) |
| LLM errors | Error notification + ghost text cleared (buffer emptied, `onPrediction("")` fired, `setGhostText("")` in handler) |
| Terminal resize | Ghost text re-wraps on next render |
| Multi-line editor content | Ghost text renders at cursor position, wraps within available width |
| Cursor at line end | Ghost text after highlighted space cursor |
| LLM returns multi-line text | Paragraphs preserved in ghost text. Tab consumes words across paragraphs. Empty paragraphs skipped. |
| Classical + LLM both active | Ghost: `<suffix> <llm_words>`. Tab: suffix first, then LLM words. |
| Classical dedup with LLM | If LLM first word == classical suffix, LLM word stripped from ghost |
| Config missing | Defaults used, no error |
| API down | Error notification, ghost cleared, no crash |
| `/autosuggest` toggle | State persisted to config file |
| Session turn end | Context refreshed, dictionary updated (capped at 10000 words) |
| Dictionary exceeds 10000 words | Lowest-frequency word evicted on next `addWord` |
