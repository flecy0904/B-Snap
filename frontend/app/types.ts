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

export type NoteWorkspaceMode = 'photo' | 'note';
export type StudyDocumentType = 'pdf' | 'blank';
export type CaptureAssetType = 'image' | 'pdf';
export type CaptureAssetStatus = 'uploaded' | 'suggested' | 'accepted' | 'archived' | 'dismissed';
export type CaptureSource = 'camera' | 'library' | 'document' | 'mock';
export type WorkspaceAttachmentPlacement = 'next_page_insert' | 'side_reference' | 'library_only';
export type SyncBridgeMode = 'mock' | 'websocket';
export type GeneratedPageStatus = 'generating' | 'ready';
export type DocumentPageView =
  | { kind: 'pdf'; pageNumber: number }
  | { kind: 'generated'; pageId: string };

export interface StudyDocumentEntry {
  id: number;
  subjectId: number;
  title: string;
  type: StudyDocumentType;
  updatedAt: string;
  pageCount: number;
  preview: string;
  file?: number | { uri: string };
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
  pageCount?: number;
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
  pageCount?: number;
}

export interface GeneratedWorkspacePage {
  id: string;
  documentId: number;
  sourceAssetId: string;
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
}

export interface TimetableEntry {
  id: number;
  subjectId: number;
  day: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI';
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
