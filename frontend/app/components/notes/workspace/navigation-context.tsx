import React, { createContext, useContext } from 'react';
import type { NoteWorkspaceMode, Subject, NoteEntry, StudyDocumentEntry } from '../../../types';
import { useNotesGlobalContext } from './notes-global-context';

export type NavigationState = {
  subjectId: number | null;
  subject: Subject | null;
  noteId: number | null;
  note: NoteEntry | null;
  studyDocumentId: number | null;
  noteWorkspaceMode: NoteWorkspaceMode;
  query: string;
  sort: 'latest' | 'oldest';
  noteDetailTab: 'original' | 'summary';
  subjects: Subject[];
  userStudyDocuments: StudyDocumentEntry[];
  deletedNoteIds: number[];
  deletedStudyDocumentIds: number[];
  workspaceFeedback: string | null;
  workspaceHydrated: boolean;
  localPersistenceError: boolean;
};

export type NavigationActions = {
  onOpenSubject: (id: number) => void;
  onOpenNote: (id: number) => void;
  onOpenStudyDocument: (id: number | null) => void;
  onCreateBlankNote: () => void;
  onUploadPdf: () => void;
  onReset: () => void;
  onDeleteNote: (id: number) => void;
  onDeleteStudyDocument: (id: number) => void;
  onRestoreNote: (id: number) => void;
  onRestoreStudyDocument: (id: number) => void;
  onRenameStudyDocument: (id: number, title: string) => boolean;
  onChangeMode: (mode: NoteWorkspaceMode) => void;
  onQuery: (query: string) => void;
  onSort: () => void;
  onChangeNoteTab: (tab: 'original' | 'summary') => void;
  onBackToSubjectList: () => void;
  onBackToNoteList: () => void;
};

const NavigationContext = createContext<(NavigationState & NavigationActions) | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const global = useNotesGlobalContext();

  const value = {
    subjectId: global.subjectId ?? null,
    subject: global.subject ?? null,
    noteId: global.noteId ?? null,
    note: global.note ?? null,
    studyDocumentId: global.studyDocumentId ?? null,
    noteWorkspaceMode: global.noteWorkspaceMode ?? 'photo',
    query: global.query ?? '',
    sort: global.sort ?? 'latest',
    noteDetailTab: global.noteDetailTab ?? 'original',
    subjects: global.subjects ?? [],
    userStudyDocuments: global.allStudyDocuments ?? [],
    deletedNoteIds: global.deletedNoteIds ?? [],
    deletedStudyDocumentIds: global.deletedStudyDocumentIds ?? [],
    workspaceFeedback: global.workspaceFeedback ?? null,
    workspaceHydrated: global.workspaceHydrated ?? true,
    localPersistenceError: global.localPersistenceError ?? false,

    onOpenSubject: global.onOpenSubject,
    onOpenNote: global.onOpenNote,
    onOpenStudyDocument: global.onOpenStudyDocument,
    onCreateBlankNote: global.onCreateBlankNote,
    onUploadPdf: global.onUploadPdf,
    onReset: global.onReset,
    onDeleteNote: global.onDeleteNote,
    onDeleteStudyDocument: global.onDeleteStudyDocument,
    onRestoreNote: global.onRestoreNote,
    onRestoreStudyDocument: global.onRestoreStudyDocument,
    onRenameStudyDocument: global.onRenameStudyDocument,
    onChangeMode: global.onChangeMode,
    onQuery: global.onQuery,
    onSort: global.onSort,
    onChangeNoteTab: global.onChangeNoteTab,
    onBackToSubjectList: global.onBackToSubjectList,
    onBackToNoteList: global.onBackToNoteList,
  };

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigationContext() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigationContext must be used within a NavigationProvider');
  }
  return context;
}
