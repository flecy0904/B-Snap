import React, { createContext, useContext } from 'react';
import type { DesktopNotesViewProps } from '../layout/desktop-notes-view';

type GlobalContextType = any; // Fallback

const NotesGlobalContext = createContext<GlobalContextType>(null);

export function NotesGlobalProvider({ value, children }: { value: GlobalContextType; children: React.ReactNode }) {
  return <NotesGlobalContext.Provider value={value}>{children}</NotesGlobalContext.Provider>;
}

export function useNotesGlobalContext(): GlobalContextType {
  const context = useContext(NotesGlobalContext);
  if (!context) {
    throw new Error('useNotesGlobalContext must be used within a NotesGlobalProvider');
  }
  return context;
}
