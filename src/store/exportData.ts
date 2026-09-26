// M5 opt-in JSON export (spec §12: "Export JSON แบบ opt-in (ไม่มีข้อความขวดโหล)").
// Deliberately excludes the `jar` store entirely — jar text must never
// leave the device (spec §11) — so this only reads settings, progress and
// sessions. No network call; the caller hands the JSON string to
// Platform.shareFile(), which is either a local Blob download (web) or the
// OS share sheet (native).

import type { SessionSummary } from '../core/types';
import type { ProgressRecord, SettingsRecord } from './db';

export interface ExportPayload {
  exportedAt: number;
  settings: SettingsRecord;
  progress: ProgressRecord;
  sessions: SessionSummary[];
}

export function buildExportPayload(
  now: number,
  settings: SettingsRecord,
  progress: ProgressRecord,
  sessions: readonly SessionSummary[],
): ExportPayload {
  return {
    exportedAt: now,
    settings,
    progress,
    sessions: [...sessions],
  };
}
