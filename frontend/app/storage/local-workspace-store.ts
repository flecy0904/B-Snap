import * as SQLite from 'expo-sqlite';
import type { BookmarkedPage, CaptureAsset, DocumentPageView, GeneratedWorkspacePage, SemesterSchedule, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../types';
import type { InkStroke, InkTextAnnotation } from '../ui-types';

const DATABASE_NAME = 'bsnap-local-workspace.db';
const TABLE_NAME = 'kv_store';
const STUDY_WORKSPACE_KEY = 'study-workspace-state';
const SCHEDULE_WORKSPACE_KEY = 'schedule-workspace-state';

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
};

export type PersistedScheduleWorkspaceState = {
  version: 1;
  userSubjects: Subject[];
  userSchedules: SemesterSchedule[];
};

let db: ReturnType<typeof SQLite.openDatabaseSync> | null | undefined;
const memoryStore = new Map<string, string>();

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
  };
}

export async function loadStudyWorkspaceState() {
  const database = getDatabase();

  if (!database) {
    const value = memoryStore.get(STUDY_WORKSPACE_KEY);
    return value ? (JSON.parse(value) as PersistedStudyWorkspaceState) : null;
  }

  const row = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM ${TABLE_NAME} WHERE key = ?`,
    STUDY_WORKSPACE_KEY,
  );

  return row?.value ? (JSON.parse(row.value) as PersistedStudyWorkspaceState) : null;
}

export async function saveStudyWorkspaceState(state: PersistedStudyWorkspaceState) {
  const value = JSON.stringify(state);
  const database = getDatabase();

  if (!database) {
    memoryStore.set(STUDY_WORKSPACE_KEY, value);
    return;
  }

  await database.runAsync(
    `INSERT OR REPLACE INTO ${TABLE_NAME} (key, value, updated_at) VALUES (?, ?, ?)`,
    STUDY_WORKSPACE_KEY,
    value,
    new Date().toISOString(),
  );
}

export async function clearStudyWorkspaceState() {
  const database = getDatabase();
  memoryStore.delete(STUDY_WORKSPACE_KEY);

  if (!database) return;

  await database.runAsync(`DELETE FROM ${TABLE_NAME} WHERE key = ?`, STUDY_WORKSPACE_KEY);
}

export async function loadScheduleWorkspaceState() {
  const database = getDatabase();

  if (!database) {
    const value = memoryStore.get(SCHEDULE_WORKSPACE_KEY);
    return value ? (JSON.parse(value) as PersistedScheduleWorkspaceState) : null;
  }

  const row = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM ${TABLE_NAME} WHERE key = ?`,
    SCHEDULE_WORKSPACE_KEY,
  );

  return row?.value ? (JSON.parse(row.value) as PersistedScheduleWorkspaceState) : null;
}

export async function saveScheduleWorkspaceState(state: PersistedScheduleWorkspaceState) {
  const value = JSON.stringify(state);
  const database = getDatabase();

  if (!database) {
    memoryStore.set(SCHEDULE_WORKSPACE_KEY, value);
    return;
  }

  await database.runAsync(
    `INSERT OR REPLACE INTO ${TABLE_NAME} (key, value, updated_at) VALUES (?, ?, ?)`,
    SCHEDULE_WORKSPACE_KEY,
    value,
    new Date().toISOString(),
  );
}

export async function clearScheduleWorkspaceState() {
  const database = getDatabase();
  memoryStore.delete(SCHEDULE_WORKSPACE_KEY);

  if (!database) return;

  await database.runAsync(`DELETE FROM ${TABLE_NAME} WHERE key = ?`, SCHEDULE_WORKSPACE_KEY);
}
