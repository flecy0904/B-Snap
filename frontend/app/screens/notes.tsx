import React from 'react';
import { MobileNotesView } from '../components/notes/layout/mobile-notes-view';
import { DesktopNotesView } from '../components/notes/layout/desktop-notes-view';
import { NotesGlobalProvider } from '../components/notes/workspace/notes-global-context';
import { AiChatProvider } from '../components/notes/ai/ai-chat-context';
import { CanvasProvider } from '../components/notes/canvas/canvas-context';
import { NavigationProvider } from '../components/notes/workspace/navigation-context';
import { DocumentProvider } from '../components/notes/workspace/document-context';

export function MobileNotes(props: any) {
  return (
    <NotesGlobalProvider value={props}>
      <NavigationProvider>
        <DocumentProvider>
          <AiChatProvider>
            <CanvasProvider>
              <MobileNotesView {...props} />
            </CanvasProvider>
          </AiChatProvider>
        </DocumentProvider>
      </NavigationProvider>
    </NotesGlobalProvider>
  );
}

export function DesktopNotes(props: any) {
  return (
    <NotesGlobalProvider value={props}>
      <NavigationProvider>
        <DocumentProvider>
          <AiChatProvider>
            <CanvasProvider>
              <DesktopNotesView {...props} />
            </CanvasProvider>
          </AiChatProvider>
        </DocumentProvider>
      </NavigationProvider>
    </NotesGlobalProvider>
  );
}
