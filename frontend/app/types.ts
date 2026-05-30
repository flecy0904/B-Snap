export type TabKey = 'schedule' | 'notes' | 'capture' | 'profile';

export interface Subject {
  id: number;
  name: string;
  color: string;
  bgColor: string;
  textColor: string;
  noteCount: number;
}

export interface NoteEntry {
  id: number;
  subjectId: number;
  date: string;
  title: string;
  image: number;
  preview: string;
  body: string[];
  keywords: string[];
  summarySections?: NoteSummarySection[];
}

export interface NoteSummarySection {
  title: string;
  body: string;
  tone?: 'default' | 'highlight' | 'formula';
}

export interface AiAnswer {
  question: string;
  response: string;
  sections: NoteSummarySection[];
  createdAt: string;
}

export type NoteWorkspaceMode = 'photo' | 'note';
export type StudyDocumentType = 'pdf' | 'blank' | 'image';
export type StudyDocumentBackendSyncStatus = 'local' | 'syncing' | 'synced' | 'failed';
export type CaptureAssetType = 'image' | 'pdf';
export type CaptureAssetStatus = 'uploaded' | 'suggested' | 'accepted' | 'archived' | 'dismissed';
export type CaptureSource = 'camera' | 'library' | 'document';
export type WorkspaceAttachmentPlacement = 'next_page_insert' | 'side_reference' | 'library_only';
export type SyncBridgeMode = 'local' | 'websocket';
export type SyncBridgeStatus = 'local' | 'connecting' | 'connected' | 'reconnecting' | 'offline';
export type GeneratedPageStatus = 'generating' | 'ready';
export type GeneratedPageKind = 'summary' | 'memo';
export type DocumentPageView =
  | { kind: 'pdf'; pageNumber: number }
  | { kind: 'generated'; pageId: string };
export type NotebookPageKind = 'pdf' | 'blank' | 'summary';
export type NotebookPageTemplate = 'plain' | 'ruled' | 'grid';

export interface NotebookPage {
  id: string;
  documentId: number;
  kind: NotebookPageKind;
  label: string;
  sourcePage?: DocumentPageView;
  pageNumber?: number;
  generatedPageId?: string;
  insertAfterPage?: number;
  template?: NotebookPageTemplate;
}

export interface BookmarkedPage {
  id: string;
  documentId: number;
  page: DocumentPageView;
  label: string;
  createdAt: string;
}

export interface StudyDocumentEntry {
  id: number;
  backendNoteId?: number;
  subjectId: number;
  title: string;
  type: StudyDocumentType;
  updatedAt: string;
  pageCount: number;
  preview: string;
  file?: number | string | { uri: string };
  localFileUri?: string;
  remoteFileUrl?: string;
  thumbnailUrl?: string;
  backendSyncStatus?: StudyDocumentBackendSyncStatus;
  backendSyncError?: string;
}

export interface CaptureAsset {
  id: string;
  subjectId: number;
  type: CaptureAssetType;
  status: CaptureAssetStatus;
  title: string;
  summary: string;
  createdAt: string;
  sourceDeviceLabel: string;
  previewImageKey?: string;
  previewImage?: number;
  fileUrl?: string;
  thumbnailUrl?: string;
  processedUrl?: string;
  pageCount?: number;
  analysisStatus?: 'pending' | 'ready' | 'failed';
  analysisSummary?: string;
  analysisKeywords?: string[];
}

export interface CaptureAssetEvent {
  event: 'asset.created';
  asset: CaptureAsset;
  receivedAt: string;
}

export interface PublishAssetResult {
  delivery: 'remote' | 'local';
}

export interface CaptureSyncBridge {
  mode: SyncBridgeMode;
  getStatus: () => SyncBridgeStatus;
  subscribeToStatus: (listener: (status: SyncBridgeStatus) => void) => () => void;
  publishAsset: (asset: CaptureAsset) => PublishAssetResult | Promise<PublishAssetResult>;
  subscribeToAssets: (listener: (event: CaptureAssetEvent) => void) => () => void;
}

export interface WorkspaceAttachment {
  id: string;
  assetId: string;
  generatedPageId?: string;
  type: CaptureAssetType;
  title: string;
  summary: string;
  createdAt: string;
  placementType: WorkspaceAttachmentPlacement;
  previewImageKey?: string;
  previewImage?: number;
  fileUrl?: string;
  thumbnailUrl?: string;
  processedUrl?: string;
  pageCount?: number;
}

export interface PageCaptureReference {
  id: string;
  documentId: number;
  assetId: string;
  subjectId: number;
  page: DocumentPageView;
  pageLabel: string;
  type: CaptureAssetType;
  title: string;
  summary: string;
  aiSummary: string;
  keywords: string[];
  createdAt: string;
  sourceDeviceLabel: string;
  previewImageKey?: string;
  previewImage?: number;
  fileUrl?: string;
  thumbnailUrl?: string;
  processedUrl?: string;
  pageCount?: number;
}

export interface GeneratedWorkspacePage {
  id: string;
  documentId: number;
  sourceAssetId: string;
  pageKind: GeneratedPageKind;
  title: string;
  createdAt: string;
  insertAfterPage: number;
  status: GeneratedPageStatus;
  summaryTitle: string;
  summaryIntro: string;
  summarySections: NoteSummarySection[];
  formulaText?: string;
  previewImageKey?: string;
  previewImage?: number;
  fileUrl?: string;
  thumbnailUrl?: string;
  processedUrl?: string;
}

export type TimetableDay = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI';

export interface TimetableSlotInput {
  day: TimetableDay;
  start: string;
  end: string;
  location: string;
}

export interface TimetableEntry {
  id: number;
  subjectId: number;
  day: TimetableDay;
  subject: string;
  startHour: number;
  duration: number;
  location: string;
}

export interface SemesterSchedule {
  id: string;
  label: string;
  entries: TimetableEntry[];
}

export interface UserProfile {
  name: string;
  studentId: string;
  department: string;
  semester: string;
}
