import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDocumentContext } from './document-context';
import { useCanvasContext } from '../canvas/canvas-context';
import { NotebookPage } from '../../../types';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';

export function NotesPageListOverlay() {
  const workspaceContext = useDesktopNotesWorkspaceContext();
  const documentContext = useDocumentContext();
  
  if (!workspaceContext.pageListOpen) return null;

  const getNotebookPageIcon = (page: NotebookPage): React.ComponentProps<typeof MaterialCommunityIcons>['name'] => {
    if (page.kind === 'blank') return 'note-edit-outline';
    if (page.kind === 'summary') return 'star-four-points-outline';
    return 'file-pdf-box';
  };

  const getNotebookPageMeta = (page: NotebookPage) => {
    if (page.kind === 'blank') return '빈 페이지';
    if (page.kind === 'summary') return 'AI 정리';
    return '원본 PDF';
  };

  const isActiveNotebookPage = (page: NotebookPage) => {
    const current = documentContext.currentDocumentPage;
    if (!current) return false;
    if (page.kind === 'pdf' && current.kind === 'pdf') return page.pageNumber === current.pageNumber;
    if (page.generatedPageId && current.kind === 'generated') return page.generatedPageId === current.pageId;
    return false;
  };

  const notebookPages = documentContext.notebookPages.length ? documentContext.notebookPages : [];

  const navigateToPage = (page: NotebookPage) => {
    if (page.kind === 'pdf' && page.pageNumber) documentContext.onSetCurrentPdfPage(page.pageNumber);
    else if (page.generatedPageId) documentContext.onOpenGeneratedPage(page.generatedPageId);
    workspaceContext.setPageListOpen(false);
  };

  return (
    <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 9999, elevation: 99 }}>
      <Pressable style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.1)' }} onPress={() => workspaceContext.setPageListOpen(false)} />
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 74, left: 30, width: 260, bottom: 0 }}>
        <View style={{ width: 260, maxHeight: 460, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E6EAF2', shadowColor: '#9098A8', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
          <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#EEF1F6' }}>
            <Text style={{ fontSize: 12, fontWeight: '900', color: '#303744' }}>페이지</Text>
            <Text style={{ marginTop: 2, fontSize: 11, fontWeight: '700', color: '#8A93A3' }}>{notebookPages.length}개 페이지 블록</Text>
          </View>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true} style={{ padding: 8, maxHeight: 380 }}>
            {notebookPages.map((page, index) => {
              const isActive = isActiveNotebookPage(page);
              const bookmarked = page.sourcePage
                ? documentContext.currentDocumentBookmarks.some((bookmark) => {
                    if (!page.sourcePage || bookmark.page.kind !== page.sourcePage.kind) return false;
                    if (bookmark.page.kind === 'pdf' && page.sourcePage.kind === 'pdf') return bookmark.page.pageNumber === page.sourcePage.pageNumber;
                    if (bookmark.page.kind === 'generated' && page.sourcePage.kind === 'generated') return bookmark.page.pageId === page.sourcePage.pageId;
                    return false;
                  })
                : false;
              return (
                <Pressable 
                  key={page.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8, backgroundColor: isActive ? '#F0F4FF' : 'transparent' }}
                  onPress={() => navigateToPage(page)}
                >
                  <View style={{ width: 30, height: 38, borderRadius: 6, backgroundColor: page.kind === 'pdf' ? '#F8FAFD' : '#FFFDF7', borderWidth: 1, borderColor: isActive ? '#C8D4FF' : '#E7ECF4', alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialCommunityIcons name={getNotebookPageIcon(page)} size={16} color={isActive ? '#4F68D2' : '#7B8494'} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13, fontWeight: isActive ? '900' : '700', color: isActive ? '#4F68D2' : '#414B5D' }} numberOfLines={1}>
                      {bookmarked ? '★ ' : ''}{page.label || `${index + 1} 페이지`}
                    </Text>
                    <Text style={{ marginTop: 2, fontSize: 10, fontWeight: '800', color: '#9AA3B2' }}>{getNotebookPageMeta(page)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

export const NotesWorkspaceToolbar = React.memo(function NotesWorkspaceToolbar() {
  const workspaceContext = useDesktopNotesWorkspaceContext();
  const documentContext = useDocumentContext();
  const canvasContext = useCanvasContext();

  return (
    <View style={workspaceContext.styles.inkToolbarWrap}>
      <View style={workspaceContext.styles.inkToolbar}>
        <View style={[workspaceContext.styles.documentPageNavigator, { position: 'relative' }]}>
          <Pressable
            style={{ height: 34, minWidth: 92, paddingHorizontal: 10, borderRadius: 10, backgroundColor: workspaceContext.pageListOpen ? '#F0F4FF' : '#F8FAFD', borderWidth: 1, borderColor: workspaceContext.pageListOpen ? '#DCE4FF' : '#EEF1F6', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }}
            onPress={() => {
              workspaceContext.setPageListOpen(!workspaceContext.pageListOpen);
            }}
          >
            <Text style={workspaceContext.styles.documentPageLabel}>
              {workspaceContext.currentPageLabel}
            </Text>
            <MaterialCommunityIcons name={workspaceContext.pageListOpen ? "menu-up" : "menu-down"} size={14} color="#5B6474" />
          </Pressable>
          
          <Pressable 
            style={workspaceContext.styles.inkActionButton}
            onPress={documentContext.onCreateMemoPage}
          >
            <MaterialCommunityIcons name="note-plus-outline" size={18} color="#4F68D2" />
          </Pressable>
          <Pressable
            style={[workspaceContext.styles.inkActionButton, documentContext.currentPageBookmarked && workspaceContext.styles.inkToolButtonActive]}
            onPress={documentContext.onToggleBookmarkCurrentPage}
          >
            <MaterialCommunityIcons name={documentContext.currentPageBookmarked ? 'star' : 'star-outline'} size={18} color={documentContext.currentPageBookmarked ? '#F59E0B' : '#556070'} />
          </Pressable>
          <Pressable style={workspaceContext.styles.inkActionButton} onPress={documentContext.onExportCurrentDocument}>
            <MaterialCommunityIcons name="share-variant-outline" size={18} color="#556070" />
          </Pressable>
        </View>

        <View style={workspaceContext.styles.inkToolbarTools}>
          <View style={workspaceContext.styles.inkSecondaryCluster}>
            {canvasContext.selectionRect ? (
              <>
                <Pressable style={workspaceContext.styles.inkActionButton} onPress={canvasContext.duplicateSelectedStrokes}>
                  <MaterialCommunityIcons name="content-copy" size={18} color="#556070" />
                </Pressable>
                <Pressable style={workspaceContext.styles.inkActionButton} onPress={canvasContext.deleteSelectedStrokes}>
                  <MaterialCommunityIcons name="delete-outline" size={18} color="#EF4444" />
                </Pressable>
              </>
            ) : (
              <>
                <Pressable style={workspaceContext.styles.inkActionButton} onPress={canvasContext.undoInk}>
                  <MaterialCommunityIcons name="undo-variant" size={18} color="#556070" />
                </Pressable>
                <Pressable style={workspaceContext.styles.inkActionButton} onPress={canvasContext.redoInk}>
                  <MaterialCommunityIcons name="redo-variant" size={18} color="#556070" />
                </Pressable>
                <Pressable style={workspaceContext.styles.inkActionButton} onPress={canvasContext.clearInk}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color="#556070" />
                </Pressable>
              </>
            )}
          </View>

          <View style={workspaceContext.styles.inkToolbarDivider} />

          <View style={workspaceContext.styles.inkSecondaryCluster}>
            {/* 자료 및 독(Dock) 열기 버튼 */}
            <Pressable
              style={[workspaceContext.styles.inkActionButton, workspaceContext.styles.workspaceDockButton, workspaceContext.showWorkspaceDock && workspaceContext.styles.workspaceDockButtonActive]}
              onPress={workspaceContext.onToggleWorkspaceDock}
            >
              <MaterialCommunityIcons
                name="image-multiple-outline"
                size={18}
                color={workspaceContext.showWorkspaceDock ? '#5A74E8' : workspaceContext.hasWorkspaceDockContent ? '#556EDB' : '#77839A'}
              />
              {workspaceContext.hasWorkspaceDockContent ? <View style={workspaceContext.styles.workspaceDockBadge} /> : null}
            </Pressable>
            <Pressable
              style={[workspaceContext.styles.inkActionButton, workspaceContext.styles.aiIconButton, workspaceContext.aiPanelOpen && workspaceContext.styles.aiIconButtonActive]}
              onPress={workspaceContext.onToggleAiPanel}
            >
              <MaterialCommunityIcons name="star-four-points" size={18} color={workspaceContext.aiPanelOpen ? '#5A74E8' : '#7786D8'} />
            </Pressable>
            <Pressable
              style={[workspaceContext.styles.inkActionButton, workspaceContext.styles.aiCanvasToolbarButton, workspaceContext.aiCanvas.isOpen && workspaceContext.styles.aiCanvasToolbarButtonActive]}
              onPress={workspaceContext.aiCanvas.toggle}
            >
              <MaterialCommunityIcons name="note-edit-outline" size={18} color={workspaceContext.aiCanvas.isOpen ? '#5A74E8' : '#77839A'} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
});
