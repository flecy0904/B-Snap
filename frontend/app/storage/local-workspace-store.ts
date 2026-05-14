import * as SQLite from 'expo-sqlite';
import type { BookmarkedPage, CaptureAsset, DocumentPageView, GeneratedWorkspacePage, SemesterSchedule, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../types';
import type { InkStroke, InkTextAnnotation } from '../ui-types';

const DATABASE_NAME = 'bsnap-local-workspace.db';
const TABLE_NAME = 'kv_store';
const STUDY_WORKSPACE_KEY = 'study-workspace-state';
const SCHEDULE_WORKSPACE_KEY = 'schedule-workspace-state';
let workspaceOwnerKey = 'anonymous';

export type PersistedStudyWorkspaceState = {
  version: 1;
  userStudyDocuments: StudyDocumentEntry[];
  deletedNoteIds: number[];
  deletedStudyDocumentIds: number[];
  captureAssetsBySubject: Record<number, CaptureAsset[]>;
  attachmentsByDocument: Record<number, WorkspaceAttachment[]>;
  generatedPagesByDocument: Record<number, GeneratedWorkspacePage[]>;
  inkByDocument: Record<number, InkStroke[]>;
  textAnnotationsByDocument: Record<number, InkTextAnnotation[]>;
  currentPdfPageByDocument: Record<number, number>;
  activePageByDocument: Record<number, DocumentPageView>;
  bookmarksByDocument: Record<number, BookmarkedPage[]>;
  lastChatSessionByDocument?: Record<number, number>;
  aiPanelMode?: 'floating' | 'sidebar';
};

export type PersistedScheduleWorkspaceState = {
  version: 1;
  userSubjects: Subject[];
  userSchedules: SemesterSchedule[];
};

let db: ReturnType<typeof SQLite.openDatabaseSync> | null | undefined;
const memoryStore = new Map<string, string>();

function scopedKey(key: string) {
  return `${key}:${workspaceOwnerKey}`;
}

export function setLocalWorkspaceOwner(ownerId: string | number | null) {
  workspaceOwnerKey = ownerId === null ? 'anonymous' : String(ownerId);
}

function getDatabase() {
  if (db !== undefined) return db;

  try {
    db = SQLite.openDatabaseSync(DATABASE_NAME);
    db.execSync(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } catch {
    db = null;
  }

  return db;
}

export function buildEmptyStudyWorkspaceState(): PersistedStudyWorkspaceState {
  return {
    version: 1,
    userStudyDocuments: [],
    deletedNoteIds: [],
    deletedStudyDocumentIds: [],
    captureAssetsBySubject: {},
    attachmentsByDocument: {},
    generatedPagesByDocument: {},
    inkByDocument: {},
    textAnnotationsByDocument: {},
    currentPdfPageByDocument: {},
    activePageByDocument: {},
    bookmarksByDocument: {},
    lastChatSessionByDocument: {},
    aiPanelMode: 'floating',
  };
}

export async function loadStudyWorkspaceState() {
  const database = getDatabase();

  if (!database) {
    const value = memoryStore.get(scopedKey(STUDY_WORKSPACE_KEY));
    return value ? (JSON.parse(value) as PersistedStudyWorkspaceState) : null;
  }

  const row = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM ${TABLE_NAME} WHERE key = ?`,
    scopedKey(STUDY_WORKSPACE_KEY),
  );

  return row?.value ? (JSON.parse(row.value) as PersistedStudyWorkspaceState) : null;
}

export async function saveStudyWorkspaceState(state: PersistedStudyWorkspaceState) {
  const value = JSON.stringify(state);
  const database = getDatabase();

  if (!database) {
    memoryStore.set(scopedKey(STUDY_WORKSPACE_KEY), value);
    return;
  }

  await database.runAsync(
    `INSERT OR REPLACE INTO ${TABLE_NAME} (key, value, updated_at) VALUES (?, ?, ?)`,
    scopedKey(STUDY_WORKSPACE_KEY),
    value,
    new Date().toISOString(),
  );
}

export async function clearStudyWorkspaceState() {
  const database = getDatabase();
  memoryStore.delete(scopedKey(STUDY_WORKSPACE_KEY));

  if (!database) return;

  await database.runAsync(`DELETE FROM ${TABLE_NAME} WHERE key = ?`, scopedKey(STUDY_WORKSPACE_KEY));
}

export async function loadScheduleWorkspaceState() {
  const database = getDatabase();

  if (!database) {
    const value = memoryStore.get(scopedKey(SCHEDULE_WORKSPACE_KEY));
    return value ? (JSON.parse(value) as PersistedScheduleWorkspaceState) : null;
  }

  const row = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM ${TABLE_NAME} WHERE key = ?`,
    scopedKey(SCHEDULE_WORKSPACE_KEY),
  );

  return row?.value ? (JSON.parse(row.value) as PersistedScheduleWorkspaceState) : null;
}

export async function saveScheduleWorkspaceState(state: PersistedScheduleWorkspaceState) {
  const value = JSON.stringify(state);
  const database = getDatabase();

  if (!database) {
    memoryStore.set(scopedKey(SCHEDULE_WORKSPACE_KEY), value);
    return;
  }

  await database.runAsync(
    `INSERT OR REPLACE INTO ${TABLE_NAME} (key, value, updated_at) VALUES (?, ?, ?)`,
    scopedKey(SCHEDULE_WORKSPACE_KEY),
    value,
    new Date().toISOString(),
  );
}

export async function clearScheduleWorkspaceState() {
  const database = getDatabase();
  memoryStore.delete(scopedKey(SCHEDULE_WORKSPACE_KEY));

  if (!database) return;

  await database.runAsync(`DELETE FROM ${TABLE_NAME} WHERE key = ?`, scopedKey(SCHEDULE_WORKSPACE_KEY));
}
