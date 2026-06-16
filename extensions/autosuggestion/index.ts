/**
 * Autosuggestion Extension — Word-by-Word Ghost Text Completion
 *
 * A small background LLM predicts the next words while you type.
 * Ghost text appears dimmed after your cursor. Press Tab to accept one word at a time.
 * After each word, the model predicts the next words automatically.
 *
 * Config: ~/.pi/agent/autosuggestion.json
 *   {
 *     "enabled": false,
 *     "baseUrl": "http://localhost:11434/v1",
 *     "model": "qwen2.5:1.5b",
 *     "debounceMs": 300,
 *     "maxTokens": 50
 *   }
 *
 * Usage:
 *   - Type a message, press space or newline → prediction starts
 *   - Press Tab → accept next word (ghost text shrinks)
 *   - Keep pressing Tab → words get inserted one by one
 *   - Model re-predicts automatically when buffer gets low (≤3 words)
 *   - Continue typing / arrow keys / backspace → dismiss suggestion
 *   - Press Escape → dismiss suggestion
 *
 * Toggle: /autosuggest
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, Key, visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";

// ============================================================================
// Config
// ============================================================================

interface Config {
  enabled: boolean;
  baseUrl: string;
  model: string;
  debounceMs: number;
  maxTokens: number;
  contextTokens: number;
  enableClassicalCompletion: boolean;
  classicalMinChars: number;
  workspaceScanDepth: number;
  maxVisibleWords: number;
  repredictThreshold: number;
}

const CONFIG_PATH = join(
  process.env.HOME ?? "/home/tim-external",
  ".pi/agent/autosuggestion.json",
);

function loadConfig(): Config {
  const defaults: Config = {
    enabled: false,
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:1.5b",
    debounceMs: 300,
    maxTokens: 50,
    contextTokens: 1000,
    enableClassicalCompletion: true,
    classicalMinChars: 3,
    workspaceScanDepth: 3,
    maxVisibleWords: 10,
    repredictThreshold: 3,
  };
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

// ============================================================================
// PredictionService
// ============================================================================
// Manages a word buffer. Each Tab consumes one word; when the buffer runs
// low the model is called again to refill it.

class PredictionService {
  private baseUrl: string;
  private model: string;
  private debounceMs: number;
  private maxTokens: number;
  private sessionManager: any;
  private pending: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private onPrediction?: (ghost: string) => void;
  private onError?: (msg: string) => void;
  public enabled: boolean = false;

  // Word buffer — holds words to be inserted one by one
  private wordBuffer: string[] = [];
  // Guard against concurrent predictions
  private isPredicting: boolean = false;
  // Generation counter to invalidate stale responses
  private generation: number = 0;
  // Cached session context — extracted once per turn, reused for all predictions
  private contextText: string = "";
  private contextTokens: number;
  private repredictThreshold: number;
  // Queue for prediction when API call is in-flight. Stores text + merge intent
  private predictionQueue: { text: string; merge: boolean } | null = null;
  // Raw completion text with newlines preserved for multi-line ghost text
  private rawCompletion: string = "";
  private paragraphWords: string[][] = [];

  constructor(
    baseUrl: string,
    model: string,
    debounceMs: number,
    maxTokens: number,
    contextTokens: number,
    repredictThreshold: number,
  ) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.debounceMs = debounceMs;
    this.maxTokens = maxTokens;
    this.contextTokens = contextTokens;
    this.repredictThreshold = repredictThreshold;
  }

  setSessionManager(sm: any) {
    this.sessionManager = sm;
  }

  setOnPrediction(callback: (ghost: string) => void) {
    this.onPrediction = callback;
  }

  setOnError(callback: (msg: string) => void) {
    this.onError = callback;
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.cancel();
      this.wordBuffer = [];
    }
    return this.enabled;
  }

  async predict(text: string, skipDebounce?: boolean, doMerge?: boolean) {
    if (!this.enabled) return;

    // Cancel previous debounce
    clearTimeout(this.debounceTimer!);

    // Increment generation to invalidate any in-flight prediction
    this.generation++;
    const currentGen = this.generation;

    // If already fetching, queue the latest prediction (latest wins, preserves merge intent)
    if (this.isPredicting) {
      this.predictionQueue = { text, merge: doMerge ?? (skipDebounce === true) };
      return;
    }

    // Debounce — wait before starting prediction (skip for Tab reprediction)
    if (!skipDebounce) {
      await new Promise<void>((resolve) => {
        this.debounceTimer = setTimeout(resolve, this.debounceMs);
      });
    }

    // After debounce: if a newer prediction was triggered, bail
    if (currentGen !== this.generation) return;

    // Now it's safe to start predicting
    this.isPredicting = true;
    this.pending = new AbortController();

    // Snapshot paragraphs before the API call for consumed-count calculation in merge path
    const savedParagraphs = this.paragraphWords.map(p => [...p]);
    // Determine merge vs replace based on doMerge param or skipDebounce
    const shouldMerge = doMerge ?? (skipDebounce === true);

    try {
      // Build full prompt: cached session context + current editor text
      const fullPrompt = this.contextText + text;

      const response = await fetch(`${this.baseUrl}/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: fullPrompt,
          max_tokens: this.maxTokens,
          temperature: 0.7,
          stream: false,
          stop: ["\n\n", "\n\n\n"],
        }),
        signal: this.pending.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        this.onError?.(`Autosuggest API error (${response.status}): ${errorBody}`);
        this.wordBuffer = [];
        this.paragraphWords = [];
        this.onPrediction?.("");
        return;
      }

      const data = await response.json();
      const completion = data.choices?.[0]?.text ?? "";

      // Check generation again — a newer prediction may have replaced us
      if (currentGen !== this.generation) return;

      // Store raw completion with newlines for multi-line ghost text
      this.rawCompletion = completion;

      // Parse completion into paragraphs:
      // - \n{2,} = paragraph break (2+ newlines)
      // - single \n within a paragraph → normalized to space
      const newParagraphWords = completion
        .split(/\n{2,}/)
        .map((p) => p.replace(/\n/g, ' ').trim())
        .filter((p) => p.length > 0)
        .map((p) => p.split(/\s+/).filter((w) => w.length > 0));

      const newWords = newParagraphWords.flat();

      if (shouldMerge) {
        // REPREDICTION: append new words to existing buffer. Don't replace —
        // the user may have tabbed through some words during the API call.
        this.wordBuffer.push(...newWords);
        // Flatten all words (old remaining + new) into a single paragraph.
        // Prevents paragraph boundary accumulation that forces artificial line breaks.
        const allWords = savedParagraphs.flat().concat(newWords);
        const consumed = allWords.length - this.wordBuffer.length;
        if (this.wordBuffer.length > 0) {
          this.paragraphWords = [allWords.slice(consumed)];
          this.onPrediction?.(this.buildGhostText());
        } else {
          this.wordBuffer = [];
          this.paragraphWords = [];
          this.onPrediction?.("");
        }
      } else {
        // NEW PREDICTION (user typing): replace buffer entirely.
        // Old predictions are stale — discard them.
        if (newWords.length > 0) {
          this.wordBuffer = newWords;
          this.paragraphWords = newParagraphWords;
          this.onPrediction?.(this.buildGhostText());
        } else {
          this.wordBuffer = [];
          this.paragraphWords = [];
          this.onPrediction?.("");
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        this.onError?.(`autosuggest: ${err.message}`);
        // Clear ghost text on error (fixes staleness)
        this.wordBuffer = [];
        this.paragraphWords = [];
        this.onPrediction?.("");
      }
    } finally {
      this.isPredicting = false;
      // Fire queued prediction (skip debounce + preserve merge intent from queue)
      if (this.predictionQueue !== null) {
        const { text: queuedText, merge: queuedMerge } = this.predictionQueue;
        this.predictionQueue = null;
        this.predict(queuedText, true, queuedMerge);
      }
    }
  }

  cancel() {
    this.pending?.abort();
    this.pending = null;
    clearTimeout(this.debounceTimer!);
    this.generation++; // invalidate any in-flight prediction
    this.wordBuffer = [];
    this.predictionQueue = null;
    this.rawCompletion = "";
    this.paragraphWords = [];
  }

  /** Refresh cached session context from the session manager. */
  updateContext(sessionManager: any) {
    if (this.contextTokens === 0) {
      this.contextText = "";
      return;
    }
    this.contextText = buildSessionContextText(sessionManager, this.contextTokens);
  }

  /** Get and remove the next word from the buffer. */
  nextWord(): string | null {
    if (this.wordBuffer.length === 0) return null;
    return this.wordBuffer.shift() || null;
  }

  /** Build ghost text preserving paragraph structure from raw completion. */
  buildGhostText(): string {
    if (this.paragraphWords.length === 0) return "";
    const consumedCount = this.paragraphWords.flat().length - this.wordBuffer.length;
    let skip = consumedCount;
    const remainingParagraphs: string[] = [];
    for (const paragraph of this.paragraphWords) {
      if (skip >= paragraph.length) {
        skip -= paragraph.length;
        continue; // skip fully consumed paragraph
      }
      remainingParagraphs.push(paragraph.slice(skip).join(" "));
      skip = 0;
    }
    return remainingParagraphs.join("\n");
  }

  /** Number of words remaining in the buffer. */
  remainingCount(): number {
    return this.wordBuffer.length;
  }

  /** Whether we should trigger a new prediction. Returns true when buffer is low. */
  shouldRepredict(): boolean {
    return this.wordBuffer.length <= this.repredictThreshold;
  }
}

// ============================================================================
// GhostEditor
// ============================================================================
// Extends CustomEditor to render ghost text after the cursor.
// Tab consumes one word at a time; ghost text shrinks with each press.

class GhostEditor extends CustomEditor {
  private ghostText: string = "";
  private onCancelPredict?: () => void;
  private onPredict?: (text: string, skipDebounce?: boolean) => void;
  private predictionService: PredictionService;
  private tui: any;
  // Classical word completion
  private wordDict: WordDictionary;
  private classicalMinChars: number;
  private classicalWordSuffix: string = ""; // cached suffix for current word completion
  private classicalWordFull: string = ""; // full completed word for reference

  constructor(
    tui: any,
    theme: any,
    keybindings: any,
    predictionService: PredictionService,
    wordDict: WordDictionary,
    classicalMinChars: number,
    maxVisibleWords: number,
    repredictThreshold: number,
  ) {
    super(tui, theme, keybindings);
    this.predictionService = predictionService;
    this.tui = tui;
    this.wordDict = wordDict;
    this.classicalMinChars = classicalMinChars;
    this.maxVisibleWords = maxVisibleWords;
    this.repredictThreshold = repredictThreshold;
  }

  /** Try to find a classical completion for the current word. Returns the suffix or null. */
  private tryClassicalCompletion(): { suffix: string; full: string } | null {
    const text = this.getText();
    const lastChar = text[text.length - 1];
    // Only for mid-word (not after space or newline)
    if (!lastChar || lastChar === ' ' || lastChar === '\n') return null;

    // Extract current word prefix
    const match = text.match(/([a-zA-Z][a-zA-Z0-9_-]*)$/);
    if (!match) return null;
    const prefix = match[1];
    if (prefix.length < this.classicalMinChars) return null;

    const completions = this.wordDict.complete(prefix, 1);
    if (completions.length === 0) return null;

    const full = completions[0];
    const suffix = full.slice(prefix.length);
    return { suffix, full };
  }

  /** Update ghost text with classical completion + LLM buffer if applicable. */
  private updateGhostWithClassical(): void {
    if (!this.predictionService.enabled) return;
    const classical = this.tryClassicalCompletion();

    if (classical) {
      this.classicalWordSuffix = classical.suffix;
      this.classicalWordFull = classical.full;
      let llmRemaining = this.predictionService.buildGhostText();

      // Deduplication: if LLM first word matches classical full word, strip it
      if (llmRemaining) {
        const firstLlmWord = llmRemaining.split(/\s+/)[0];
        if (firstLlmWord && firstLlmWord.toLowerCase() === classical.full.toLowerCase()) {
          llmRemaining = llmRemaining.slice(firstLlmWord.length).trim();
        }
      }

      const ghost = llmRemaining ? `${classical.suffix} ${llmRemaining}` : classical.suffix;
      this.setGhostText(ghost);
    } else {
      this.classicalWordSuffix = "";
      this.classicalWordFull = "";
      this.setGhostText(this.predictionService.buildGhostText());
    }
  }

  setOnCancelPredict(callback: () => void) {
    this.onCancelPredict = callback;
  }

  setOnPredict(callback: (text: string, skipDebounce?: boolean) => void) {
    this.onPredict = callback;
  }

  setGhostText(ghost: string) {
    if (ghost !== this.ghostText) {
      this.ghostText = ghost;
      this.invalidate();
      this.tui.requestRender();
    }
  }

  handleInput(data: string): void {
    // Tab: accept next word from buffer or classical completion suffix
    if (matchesKey(data, Key.tab)) {
      if (!this.predictionService.enabled) {
        super.handleInput(data);
        return;
      }
      // First: try classical word suffix completion
      if (this.classicalWordSuffix) {
        this.insertTextAtCursor(this.classicalWordSuffix);
        this.classicalWordSuffix = "";
        this.classicalWordFull = "";
        const remaining = this.predictionService.buildGhostText();
        this.setGhostText(remaining || "");
        if (this.predictionService.shouldRepredict()) {
          this.onPredict?.(this.getText(), true);
        }
        return;
      }

      // Then: try LLM word buffer
      const word = this.predictionService.nextWord();
      if (word) {
        const text = this.getText();
        const needsSpace = text.length > 0 && text[text.length - 1] !== " ";
        const wordToInsert = needsSpace ? " " + word : word;
        this.insertTextAtCursor(wordToInsert);
        const remaining = this.predictionService.buildGhostText();
        this.setGhostText(remaining || "");
        if (this.predictionService.shouldRepredict()) {
          this.onPredict?.(this.getText(), true);
        }
        return;
      }
    }

    // Dismiss ghost text on non-printable keys (arrows, escape, etc.)
    const isPrintable = data.length === 1 && data.charCodeAt(0) >= 32;
    if (!isPrintable && this.ghostText) {
      this.ghostText = "";
      this.classicalWordSuffix = "";
      this.classicalWordFull = "";
      this.onCancelPredict?.();
      this.invalidate();
    }

    // Let parent handle the input first so getText() reflects the new state
    super.handleInput(data);

    // After input is processed, trigger prediction and classical completion
    if (isPrintable && this.predictionService.enabled) {
      const classical = this.tryClassicalCompletion();
      if (classical) {
        this.classicalWordSuffix = classical.suffix;
        this.classicalWordFull = classical.full;
        // Pass augmented text to LLM: current text + full classical word
        this.onPredict?.(this.getText() + classical.full);
        this.updateGhostWithClassical(); // Show classical immediately
      } else {
        this.classicalWordSuffix = "";
        this.classicalWordFull = "";
        this.onPredict?.(this.getText());
      }
    }
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length === 0 || !this.ghostText) {
      return lines;
    }

    // Find cursor highlight in rendered output to get visual position
    // Cursor is rendered as: \x1b[7m<char>\x1b[0m
    const ESC = "\x1b";
    const highlightStart = `${ESC}[7m`;
    const highlightEnd = `${ESC}[0m`;

    let cursorRenderLine = -1;
    let visualCursorPos = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const startIdx = line.indexOf(highlightStart);
      if (startIdx === -1) continue;
      const endIdx = line.indexOf(highlightEnd, startIdx);
      if (endIdx === -1) continue;
      cursorRenderLine = i;
      // Count visible chars before the cursor highlight on this rendered line
      for (let c = 0; c < startIdx;) {
        if (line[c] === ESC) {
          let j = c;
          while (j < startIdx && line[j] !== 'm') j++;
          c = j + 1;
        } else {
          visualCursorPos += visibleWidth(line[c]);
          c++;
        }
      }
      break;
    }

    // Calculate available width from visual cursor position, accounting for right padding
    const paddingX = this.getPaddingX();
    const availableWidth = Math.max(1, width - visualCursorPos - paddingX);
    if (availableWidth <= 0) return lines;

    // Split ghost text into paragraphs (preserve forced newlines from multi-line predictions)
    const paragraphs = this.ghostText.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);

    // Wrap a single paragraph by visible width, respecting a global word budget.
    // firstLineWidth: width for the cursor line (constrained by cursor position).
    // continuationWidth: width for all subsequent wrapped lines (full content width).
    const wrapParagraph = (text: string, firstLineWidth: number, continuationWidth: number, wordBudget: number): string[] => {
      const words = text.split(/\s+/).slice(0, wordBudget);
      const wrapped: string[] = [];
      let currentLine = "";
      let currentWidth = 0;

      for (const word of words) {
        const maxWidth = wrapped.length === 0 ? firstLineWidth : continuationWidth;
        const wordWidth = visibleWidth(word);
        const spaceWidth = currentLine.length > 0 ? 1 : 0;

        if (currentWidth + spaceWidth + wordWidth <= maxWidth) {
          currentLine += (currentLine.length > 0 ? " " : "") + word;
          currentWidth += spaceWidth + wordWidth;
        } else {
          if (currentLine.length > 0) {
            wrapped.push(currentLine);
          }
          currentLine = word;
          currentWidth = wordWidth;
        }
      }
      if (currentLine.length > 0) {
        wrapped.push(currentLine);
      }
      return wrapped;
    };

    // Build wrapped lines: wrap each paragraph with a global word budget
    const continuationWidth = Math.max(1, width - paddingX * 2);
    const allWrapped: string[] = [];
    let remainingWordBudget = this.maxVisibleWords;
    for (const para of paragraphs) {
      if (remainingWordBudget <= 0) break;
      const isFirstParagraph = allWrapped.length === 0;
      const wrapped = wrapParagraph(
        para,
        isFirstParagraph ? availableWidth : continuationWidth,
        continuationWidth,
        remainingWordBudget,
      );
      // Count actual words in wrapped lines, not number of lines
      const wordsInWrapped = wrapped.reduce((count, line) => count + line.split(/\s+/).length, 0);
      remainingWordBudget -= wordsInWrapped;
      allWrapped.push(...wrapped);
    }

    // Cap wrapped lines to prevent jumping
    const wrappedLines = allWrapped.slice(0, 6);
    if (wrappedLines.length === 0) return lines;

    let ghostInserted = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const startIdx = line.indexOf(highlightStart);
      if (startIdx === -1) continue;

      const hEndIdx = line.indexOf(highlightEnd, startIdx);
      if (hEndIdx === -1) continue;

      // Strictly truncate to prevent terminal width overflow
      const before = line.slice(0, hEndIdx + highlightEnd.length);
      const firstGhostLine = `\x1b[2m${wrappedLines[0]}\x1b[22m`;
      lines[i] = truncateToWidth(before + firstGhostLine, width);
      ghostInserted = true;

      // Insert subsequent wrapped lines, strictly truncated
      if (wrappedLines.length > 1) {
        const insertLines = wrappedLines.slice(1).map((wLine) => {
          return truncateToWidth(`\x1b[2m${wLine}\x1b[22m`, width);
        });
        lines.splice(i + 1, 0, ...insertLines);
      }
      break;
    }

    // Fallback: if cursor highlight not found, append to the last content line
    if (!ghostInserted) {
      const lastContentLine = lines.length - 2;
      if (lastContentLine > 0 && lastContentLine < lines.length) {
        const line = lines[lastContentLine];
        if (line) {
          const firstGhostLine = `\x1b[2m${wrappedLines[0]}\x1b[22m`;
          // Strictly truncate to prevent terminal width overflow
          lines[lastContentLine] = truncateToWidth(line + firstGhostLine, width);

          if (wrappedLines.length > 1) {
            const insertLines = wrappedLines.slice(1).map((wLine) => {
              return truncateToWidth(`\x1b[2m${wLine}\x1b[22m`, width);
            });
            lines.splice(lastContentLine + 1, 0, ...insertLines);
          }
        }
      }
    }

    return lines;
  }
}

// ============================================================================
// Word Dictionary — Classical Prefix Completion
// ============================================================================

class WordDictionary {
  private words: Set<string> = new Set();
  private frequency: Map<string, number> = new Map();

  private static readonly MAX_SIZE = 10000;

  addWord(word: string) {
    const lower = word.toLowerCase();
    if (lower.length < 2) return;
    this.words.add(lower);
    this.frequency.set(lower, (this.frequency.get(lower) || 0) + 1);
    // Cap dictionary size — evict lowest-frequency word
    if (this.words.size > WordDictionary.MAX_SIZE) {
      let minWord = "";
      let minFreq = Infinity;
      for (const [w, f] of this.frequency) {
        if (f < minFreq) {
          minFreq = f;
          minWord = w;
        }
      }
      if (minWord) {
        this.words.delete(minWord);
        this.frequency.delete(minWord);
      }
    }
  }

  /** Clear all words and frequency data. Used for full rebuild. */
  clear() {
    this.words.clear();
    this.frequency.clear();
  }

  addWordsFromText(text: string) {
    const matches = text.match(/[a-zA-Z][a-zA-Z0-9_-]{1,}/g);
    if (matches) {
      for (const word of matches) {
        this.addWord(word);
      }
    }
  }

  addPathsFromWorkspace(rootPath: string, maxDepth: number) {
    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          // Add filename without extension
          const nameWithoutExt = entry.name.replace(/\.[^.]+$/, '');
          if (nameWithoutExt.length >= 2) {
            this.addWord(nameWithoutExt);
          }
          if (entry.isDirectory()) {
            walk(join(dir, entry.name), depth + 1);
          }
        }
      } catch { /* skip unreadable dirs */ }
    };
    walk(rootPath, 0);
  }

  complete(prefix: string, maxResults = 5): string[] {
    const lower = prefix.toLowerCase();
    const matches: string[] = [];
    for (const word of this.words) {
      if (word.startsWith(lower) && word !== lower) {
        matches.push(word);
      }
    }
    // Sort by frequency (most common first), then length (shorter first)
    matches.sort((a, b) => {
      const freqDiff = (this.frequency.get(b) || 0) - (this.frequency.get(a) || 0);
      if (freqDiff !== 0) return freqDiff;
      return a.length - b.length;
    });
    return matches.slice(0, maxResults);
  }
}

// ============================================================================
// Session Context Extraction
// ============================================================================

function buildSessionContextText(
  sessionManager: any,
  maxTokens: number,
): string {
  const entries = sessionManager.getEntries();
  const maxChars = maxTokens * 4; // rough char-to-token estimate

  // Collect message entries in order
  const messages: Array<{ role: string; text: string }> = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg || typeof msg.role !== "string") continue;
    if (msg.role !== "user" && msg.role !== "assistant" && msg.role !== "toolResult") continue;

    const text = extractText(msg);
    if (!text) continue;

    const prefix = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "Tool";
    messages.push({ role: prefix, text });
  }

  // Walk backwards, accumulate until budget exhausted
  let totalChars = 0;
  const result: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = `${messages[i]!.role}: ${messages[i]!.text}\n`;
    if (totalChars + line.length > maxChars && totalChars > 0) break;
    totalChars += line.length;
    result.unshift(line);
  }

  return result.join("");
}

function extractText(msg: any): string {
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join(" ");
  }
  return "";
}

// ============================================================================
// Extension Entry Point
// ============================================================================

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  pi.on("session_start", async (_event, ctx) => {
    const predictionService = new PredictionService(
      config.baseUrl,
      config.model,
      config.debounceMs,
      config.maxTokens,
      config.contextTokens ?? 1000,
      config.repredictThreshold ?? 3,
    );
    predictionService.enabled = config.enabled;
    predictionService.setSessionManager(ctx.sessionManager);

    let ghostEditor: GhostEditor | null = null;

    // Build classical word dictionary
    const wordDict = new WordDictionary();
    if (config.enableClassicalCompletion) {
      // Add words from session messages
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type === "message") {
          const text = extractText(entry.message);
          if (text) wordDict.addWordsFromText(text);
        }
      }
      // Add words from workspace
      wordDict.addPathsFromWorkspace(ctx.cwd, config.workspaceScanDepth ?? 3);
    }

    // Only set custom editor in TUI mode
    if (ctx.mode === "tui") {
      ctx.ui.setEditorComponent((tui, theme, kb) => {
        ghostEditor = new GhostEditor(tui, theme, kb, predictionService, wordDict, config.classicalMinChars ?? 3, config.maxVisibleWords ?? 10, config.repredictThreshold ?? 3);
        ghostEditor.setOnPredict((text: string, skipDebounce?: boolean) => {
          predictionService.predict(text, skipDebounce);
        });
        ghostEditor.setOnCancelPredict(() => {
          predictionService.cancel();
        });

        // Wire prediction result to editor (combines with classical completion)
        predictionService.setOnPrediction(() => {
          ghostEditor!.updateGhostWithClassical();
        });

        // Wire error handler to notify user of API failures
        predictionService.setOnError((msg: string) => {
          ctx.ui.notify(ctx.ui.theme.fg("error", msg), "error");
          ghostEditor?.setGhostText("");
        });

        // Preprocess session context immediately (ready when user starts typing)
        predictionService.updateContext(ctx.sessionManager);

        return ghostEditor;
      });
    }

    // Toggle autosuggestion on/off (persists to config)
    pi.registerCommand("autosuggest", {
      description: "Toggle autosuggestion on/off",
      handler: async (_args, ctx) => {
        const isOn = predictionService.toggle();

        // Persist to config file
        try {
          const raw = readFileSync(CONFIG_PATH, "utf-8");
          const cfg = JSON.parse(raw) as Config;
          cfg.enabled = isOn;
          writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
        } catch {
          // Config write failure is non-fatal
        }

        ctx.ui.notify(
          isOn
            ? ctx.ui.theme.fg("success", "Autosuggestion enabled")
            : ctx.ui.theme.fg("muted", "Autosuggestion disabled"),
          "info",
        );
      },
    });

    // Clear ghost text on submission
    pi.on("input", async (event, _ctx) => {
      if (event.source === "interactive") {
        ghostEditor?.setGhostText("");
      }
    });

    // Refresh context when a new turn starts (new input field appears)
    pi.on("turn_end", async (_event, ctx) => {
      predictionService.updateContext(ctx.sessionManager);
      // Rebuild classical dictionary from scratch to avoid frequency inflation
      if (config.enableClassicalCompletion) {
        wordDict.clear();
        for (const entry of ctx.sessionManager.getEntries()) {
          if (entry.type === "message") {
            const text = extractText(entry.message);
            if (text) wordDict.addWordsFromText(text);
          }
        }
        wordDict.addPathsFromWorkspace(ctx.cwd, config.workspaceScanDepth ?? 3);
      }
    });

    // Cancel prediction on session shutdown
    pi.on("session_shutdown", async (_event, _ctx) => {
      predictionService.cancel();
    });
  });
}
