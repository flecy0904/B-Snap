import React from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDocumentContext } from './document-context';
import { useCanvasContext } from '../canvas/canvas-context';
import { NotebookPage } from '../../../types';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';
import { FloatingToolPalette } from './floating-tool-palette';

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

  const getNotebookPageLabel = (page: NotebookPage, index: number) => {
    if (page.kind === 'pdf' && page.pageNumber) return `${page.pageNumber}`;
    const fallbackLabel = page.label || `${page.insertAfterPage ?? index + 1}-1`;
    return fallbackLabel.replace(/\s*(메모|AI 정리|페이지)$/g, '').trim();
  };

  const getNotebookPageSubLabel = (page: NotebookPage) => {
    if (page.kind === 'pdf') return '원본 페이지';
    if (typeof page.insertAfterPage === 'number') return `${page.insertAfterPage}페이지 뒤 삽입`;
    return '추가 페이지';
  };

  const isActiveNotebookPage = (page: NotebookPage) => {
    const current = documentContext.currentDocumentPage;
    if (!current) return false;
    if (page.kind === 'pdf' && current.kind === 'pdf') return page.pageNumber === current.pageNumber;
    if (page.generatedPageId && current.kind === 'generated') return page.generatedPageId === current.pageId;
    return false;
  };

  const notebookPages = documentContext.notebookPages.length ? documentContext.notebookPages : [];
  const originalPageCount = documentContext.totalDocumentPageCount || notebookPages.filter((page) => page.kind === 'pdf').length || notebookPages.length;

  const navigateToPage = (page: NotebookPage) => {
    if (page.kind === 'pdf' && page.pageNumber) documentContext.onSetCurrentPdfPage(page.pageNumber);
    else if (page.generatedPageId) documentContext.onOpenGeneratedPage(page.generatedPageId);
    workspaceContext.setPageListOpen(false);
  };

  return (
    <View style={workspaceContext.styles.pageDrawerOverlay}>
      <Pressable style={workspaceContext.styles.pageDrawerScrim} onPress={() => workspaceContext.setPageListOpen(false)} />
      <View style={workspaceContext.styles.pageDrawerPanel}>
        <View style={workspaceContext.styles.pageDrawerHeader}>
          <Text style={workspaceContext.styles.pageDrawerMoreText}>•••</Text>
          <Text style={workspaceContext.styles.pageDrawerTitle}>페이지</Text>
          <Pressable style={workspaceContext.styles.pageDrawerClose} onPress={() => workspaceContext.setPageListOpen(false)}>
            <MaterialCommunityIcons name="close" size={22} color="#C9CDD6" />
          </Pressable>
        </View>
        <View style={workspaceContext.styles.pageDrawerTabs}>
          <View style={[workspaceContext.styles.pageDrawerTab, workspaceContext.styles.pageDrawerTabActive]}>
            <MaterialCommunityIcons name="file-document-outline" size={16} color="#FFFFFF" />
          </View>
          <View style={workspaceContext.styles.pageDrawerTab}>
            <MaterialCommunityIcons name="format-list-bulleted" size={16} color="#B9C0CC" />
          </View>
          <View style={workspaceContext.styles.pageDrawerTab}>
            <MaterialCommunityIcons name="bookmark-multiple-outline" size={16} color="#B9C0CC" />
          </View>
        </View>
        <View style={workspaceContext.styles.pageDrawerFilterRow}>
          <View style={workspaceContext.styles.pageDrawerFilterChip}>
            <Text style={workspaceContext.styles.pageDrawerFilterText}>모든 페이지</Text>
            <MaterialCommunityIcons name="chevron-down" size={14} color="#78B8FF" />
          </View>
          <Text style={workspaceContext.styles.pageDrawerTotalText}>원본 {originalPageCount}p</Text>
        </View>
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={workspaceContext.styles.pageDrawerGrid}
        >
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
                style={[workspaceContext.styles.pageDrawerCard, isActive && workspaceContext.styles.pageDrawerCardActive]}
                onPress={() => navigateToPage(page)}
              >
                <View style={[workspaceContext.styles.pageDrawerPreview, page.kind !== 'pdf' && workspaceContext.styles.pageDrawerPreviewGenerated, isActive && workspaceContext.styles.pageDrawerPreviewActive]}>
                  <MaterialCommunityIcons name={getNotebookPageIcon(page)} size={24} color={isActive ? '#82B3FF' : '#8D96A5'} />
                  <Text style={workspaceContext.styles.pageDrawerPreviewLabel}>{getNotebookPageMeta(page)}</Text>
                  {bookmarked ? (
                    <View style={workspaceContext.styles.pageDrawerBookmarkBadge}>
                      <MaterialCommunityIcons name="star" size={12} color="#FBBF24" />
                    </View>
                  ) : null}
                </View>
                <View style={workspaceContext.styles.pageDrawerPageRow}>
                  <View style={workspaceContext.styles.pageDrawerPageTextBox}>
                    <Text style={[workspaceContext.styles.pageDrawerPageNumber, isActive && workspaceContext.styles.pageDrawerPageNumberActive]} numberOfLines={1}>
                      {getNotebookPageLabel(page, index)}
                    </Text>
                    <Text style={workspaceContext.styles.pageDrawerPageMeta} numberOfLines={1}>{getNotebookPageSubLabel(page)}</Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-down" size={16} color="#D7DBE2" />
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

export const NotesWorkspaceToolbar = React.memo(function NotesWorkspaceToolbar() {
  const workspaceContext = useDesktopNotesWorkspaceContext();
  const documentContext = useDocumentContext();
  const canvasContext = useCanvasContext();
  const usesAppAiPanelLayout = Boolean(workspaceContext.usesAppAiPanelLayout);
  const useWebAttachedToolbar = Platform.OS === 'web' && !usesAppAiPanelLayout;
  const chatToolActive = usesAppAiPanelLayout
    ? workspaceContext.appRightSidebarPanel === 'chat' || (workspaceContext.appChatMode === 'floating' && workspaceContext.aiPanelOpen)
    : workspaceContext.aiPanelOpen;
  const canvasToolActive = usesAppAiPanelLayout
    ? workspaceContext.appRightSidebarPanel === 'canvas'
    : workspaceContext.aiCanvas.isOpen;

  return (
    <View style={workspaceContext.styles.inkToolbarWrap}>
      <View style={[workspaceContext.styles.inkToolbar, useWebAttachedToolbar && workspaceContext.styles.inkToolbarWebAttached]}>
        <View style={[workspaceContext.styles.documentPageNavigator, { position: 'relative' }]}>
          <Pressable
            style={[
              workspaceContext.styles.inkActionButton,
              workspaceContext.pageListOpen && workspaceContext.styles.inkToolButtonActive,
            ]}
            onPress={() => {
              workspaceContext.setPageListOpen(!workspaceContext.pageListOpen);
            }}
          >
            <MaterialCommunityIcons name="view-grid-outline" size={18} color={workspaceContext.pageListOpen ? '#4F68D2' : '#556070'} />
          </Pressable>
          
          <Pressable 
            style={workspaceContext.styles.inkActionButton}
            onPress={() => documentContext.onCreateMemoPage()}
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
          {workspaceContext.focusMode ? (
            <Pressable style={workspaceContext.styles.inkActionButton} onPress={workspaceContext.onToggleFocusMode}>
              <MaterialCommunityIcons name="fullscreen-exit" size={18} color="#4F68D2" />
            </Pressable>
          ) : null}
        </View>

        <View style={workspaceContext.styles.inkToolbarTools}>
          <View style={workspaceContext.styles.inkSecondaryCluster}>
            <Pressable
              style={[
                workspaceContext.styles.inkActionButton,
                !workspaceContext.canUndoFocusedWorkspaceAction && workspaceContext.styles.inkActionButtonDisabled,
              ]}
              onPress={workspaceContext.onUndoFocusedWorkspaceAction}
              disabled={!workspaceContext.canUndoFocusedWorkspaceAction}
            >
              <MaterialCommunityIcons name="undo-variant" size={18} color={workspaceContext.canUndoFocusedWorkspaceAction ? '#556070' : '#A8B0BF'} />
            </Pressable>
            <Pressable
              style={[
                workspaceContext.styles.inkActionButton,
                !workspaceContext.canRedoFocusedWorkspaceAction && workspaceContext.styles.inkActionButtonDisabled,
              ]}
              onPress={workspaceContext.onRedoFocusedWorkspaceAction}
              disabled={!workspaceContext.canRedoFocusedWorkspaceAction}
            >
              <MaterialCommunityIcons name="redo-variant" size={18} color={workspaceContext.canRedoFocusedWorkspaceAction ? '#556070' : '#A8B0BF'} />
            </Pressable>
            <Pressable style={workspaceContext.styles.inkActionButton} onPress={canvasContext.clearInk}>
              <MaterialCommunityIcons name="trash-can-outline" size={18} color="#556070" />
            </Pressable>
          </View>

          <View style={workspaceContext.styles.inkToolbarDivider} />

          <View style={workspaceContext.styles.inkSecondaryCluster}>
            <Pressable
              style={[
                workspaceContext.styles.inkActionButton,
                workspaceContext.styles.aiIconButton,
                chatToolActive && workspaceContext.styles.aiIconButtonActive,
              ]}
              onPress={() => {
                if (usesAppAiPanelLayout) {
                  workspaceContext.onOpenAppChatSidebar();
                  return;
                }
                workspaceContext.onToggleAiPanel();
              }}
            >
              <MaterialCommunityIcons name="star-four-points" size={18} color={chatToolActive ? '#5A74E8' : '#7786D8'} />
            </Pressable>
            <Pressable
              style={[
                workspaceContext.styles.inkActionButton,
                workspaceContext.styles.aiCanvasToolbarButton,
                canvasToolActive && workspaceContext.styles.aiCanvasToolbarButtonActive,
              ]}
              onPress={() => {
                if (usesAppAiPanelLayout) {
                  workspaceContext.onOpenAppAiCanvasSidebar();
                  return;
                }
                workspaceContext.aiCanvas.toggle();
              }}
            >
              <MaterialCommunityIcons name="note-text-outline" size={18} color={canvasToolActive ? '#5A74E8' : '#77839A'} />
            </Pressable>
          </View>
        </View>
        <FloatingToolPalette />
      </View>
    </View>
  );
});
