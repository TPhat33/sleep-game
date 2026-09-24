// Ring-buffer event log for the M0 platform spike, persisted to localStorage
// so it survives an app kill (spec §5.C.7). Raw timers/Date.now are allowed
// in src/spike/** (see eslint.config.ts) — this is diagnostic tooling, not
// production gameplay logic.

export type LogSource =
  'lifecycle' | 'ctx' | 'element' | 'mediaSession' | 'wakeLock' | 'platform' | 'brightness' | 'hb';

export interface LogEntry {
  t: number;
  source: LogSource;
  message: string;
}

const STORAGE_KEY = 'spike.log';
const MAX_ENTRIES = 500;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function formatTime(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`;
}

class DiagLog {
  private entries: LogEntry[] = [];
  private readonly listeners = new Set<(entries: readonly LogEntry[]) => void>();

  constructor() {
    this.entries = this.load();
  }

  private load(): LogEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as LogEntry[]) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Private browsing / quota exceeded — the in-memory log still works.
    }
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.entries);
  }

  log(source: LogSource, message: string): void {
    this.entries.push({ t: Date.now(), source, message });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    this.persist();
    this.notify();
  }

  getAll(): readonly LogEntry[] {
    return this.entries;
  }

  formatAll(): string {
    return this.entries.map((e) => `${formatTime(e.t)} [${e.source}] ${e.message}`).join('\n');
  }

  clear(): void {
    this.entries = [];
    this.persist();
    this.notify();
  }

  onChange(fn: (entries: readonly LogEntry[]) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

/** Singleton — the whole spike page shares one log. */
export const diagLog = new DiagLog();
