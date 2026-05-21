import React, { createContext, useContext } from 'react';
import type { useStudyWorkspace } from '../../../hooks/notes/use-study-workspace';
import type { InkStroke } from '../../../ui-types';
import type { DesktopNotesViewProps } from '../layout/desktop-notes-view';
import type { DesktopNotesWorkspaceContextValue } from './notes-workspace-context';

type StudyWorkspaceResult = ReturnType<typeof useStudyWorkspace>;
type GlobalContextExtras = {
  redoInkByDocument: Record<number, InkStroke[]>;
  currentDocumentHasBackendPages: boolean;
  noteId: number | null;
  deletedNoteIds: number[];
  deletedStudyDocumentIds: number[];
  onChangeNoteTab: (tab: 'original' | 'summary') => void;
  onBackToSubjectList: () => void;
  onBackToNoteList: () => void;
};
type GlobalContextType = StudyWorkspaceResult & DesktopNotesViewProps & DesktopNotesWorkspaceContextValue & GlobalContextExtras;

const NotesGlobalContext = createContext<Partial<GlobalContextType> | null>(null);

export function NotesGlobalProvider({ value, children }: { value: Partial<GlobalContextType>; children: React.ReactNode }) {
  return <NotesGlobalContext.Provider value={value}>{children}</NotesGlobalContext.Provider>;
}

export function useNotesGlobalContext(): GlobalContextType {
  const context = useContext(NotesGlobalContext);
  if (!context) {
    throw new Error('useNotesGlobalContext must be used within a NotesGlobalProvider');
  }
  return context as GlobalContextType;
}
