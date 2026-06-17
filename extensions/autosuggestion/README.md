# Autosuggestion Extension

Background LLM predicts next words while you type. Ghost text (dimmed) appears after your cursor. Press `Tab` to accept one word at a time.

## Quick Start

1. Ensure autosuggestion is enabled in `~/.pi/agent/autosuggestion.json`:
   ```json
   { "enabled": true }
   ```
2. Toggle on/off during a session: `/autosuggest`
3. Start typing — after ≥3 chars of a word, ghost text appears
4. `Tab` — accept next word | `Escape` — dismiss

## Config File

**Location**: `~/.pi/agent/autosuggestion.json`

All options with defaults:

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Master on/off |
| `baseUrl` | string | `http://localhost:11434/v1` | OpenAI-compatible completions endpoint |
| `model` | string | `qwen2.5:1.5b` | Model name |
| `debounceMs` | number | `300` | Debounce delay before API call after typing |
| `maxTokens` | number | `50` | Max tokens per LLM completion |
| `contextTokens` | number | `1000` | Session history context length (≈4 chars/token) |
| `enableClassicalCompletion` | boolean | `true` | Enable instant prefix-based word completion |
| `classicalMinChars` | number | `3` | Min prefix length to trigger classical completion |
| `workspaceScanDepth` | number | `3` | Directory depth for scanning filenames into dictionary |
| `maxVisibleWords` | number | `10` | Max ghost text words displayed |
| `repredictThreshold` | number | `3` | Words remaining before triggering next prediction |
| `llmClassicalMode` | string | `frequency` | How classical single-word completion is chosen |

### `llmClassicalMode` Options

Controls how the first word of ghost text is selected when you're mid-word:

| Mode | Behavior | Latency |
|---|---|---|
| `frequency` | Pick most frequent dictionary match (current default) | Instant (0ms) |
| `hybrid` | Show frequency-based word instantly, then let LLM refine in background | Instant → may update |
| `llm` | Wait for LLM to choose from dictionary candidates before showing anything | ~200-500ms |

**Recommendation**: Start with `hybrid` for the experiment. It gives instant feedback with LLM refinement. Switch to `frequency` if you notice flickering or wrong picks.

## Two Completion Sources

The ghost text is composed of two independent systems:

1. **Classical (dictionary-based)** — Instant. Completes the word you're currently typing using a local dictionary built from session history and workspace filenames. Up to 10,000 words, ranked by frequency.

2. **LLM (contextual)** — Async. Predicts the next several words based on full session context. Fires after each keystroke (debounced 300ms).

`Tab` accepts the classical suffix first, then LLM words one by one.

## Example Config

```json
{
  "enabled": true,
  "baseUrl": "http://localhost:11434/v1",
  "model": "qwen2.5:1.5b",
  "debounceMs": 300,
  "maxTokens": 50,
  "contextTokens": 1000,
  "enableClassicalCompletion": true,
  "classicalMinChars": 3,
  "workspaceScanDepth": 3,
  "maxVisibleWords": 10,
  "repredictThreshold": 3,
  "llmClassicalMode": "hybrid"
}
```

## Keybindings

| Key | Action |
|---|---|
| `Tab` | Accept next word from ghost text |
| `Escape` | Dismiss ghost text, cancel prediction |
| Arrow keys / Backspace | Dismiss ghost text |
| Continue typing | Replace ghost text with new prediction |

## Troubleshooting

| Problem | Check |
|---|---|
| No ghost text appears | `enabled: true` in config? LLM endpoint reachable? |
| Classical completion not working | `enableClassicalCompletion: true`? Prefix ≥ `classicalMinChars`? |
| Ghost text flickers in hybrid mode | LLM picked different word — expected. Switch to `frequency` if distracting. |
| "pick not in dict" warnings | LLM returned word not in dictionary candidates. May improve with larger model. |
| API errors | Verify `baseUrl` is reachable. Check model name exists on server. |

## Files

- `index.ts` — Extension implementation
- `BEHAVIOR.md` — Detailed behavior specification and edge cases
- `README.md` — This file
