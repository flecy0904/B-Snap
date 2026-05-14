import React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NotebookPage } from '../../../types';
import { useDocumentContext } from './document-context';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';

export function NotebookThumbnailSidebar() {
  const workspaceContext = useDesktopNotesWorkspaceContext();
  const documentContext = useDocumentContext();
  const [open, setOpen] = React.useState(false);
  const scrollRef = React.useRef<ScrollView | null>(null);
  const pages = documentContext.notebookPages;

  const isActivePage = (page: NotebookPage) => {
    const current = documentContext.currentDocumentPage;
    if (!current) return false;
    if (page.kind === 'pdf' && current.kind === 'pdf') return page.pageNumber === current.pageNumber;
    return Boolean(page.generatedPageId && current.kind === 'generated' && current.pageId === page.generatedPageId);
  };
  const activeIndex = pages.findIndex((page) => isActivePage(page));

  React.useEffect(() => {
    if (!open || activeIndex < 0) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, activeIndex * 132 - 80), animated: true });
  }, [activeIndex, open]);

  const openPage = (page: NotebookPage) => {
    if (page.kind === 'pdf' && page.pageNumber) {
      documentContext.onSetCurrentPdfPage(page.pageNumber);
      return;
    }
    if (page.generatedPageId) documentContext.onOpenGeneratedPage(page.generatedPageId);
  };

  const getPageIcon = (page: NotebookPage): React.ComponentProps<typeof MaterialCommunityIcons>['name'] => {
    if (page.kind === 'pdf') return 'file-pdf-box';
    if (page.kind === 'summary') return 'star-four-points-outline';
    return 'note-edit-outline';
  };

  const getInsertAfterPage = (page: NotebookPage) => page.pageNumber ?? page.insertAfterPage ?? documentContext.currentPdfPage;

  if (!open) {
    return (
      <View style={workspaceContext.styles.thumbnailSidebarCollapsed}>
        <Pressable style={workspaceContext.styles.thumbnailSidebarToggle} onPress={() => setOpen(true)}>
          <MaterialCommunityIcons name="view-grid-outline" size={18} color="#5E6A7D" />
        </Pressable>
        <Text style={workspaceContext.styles.thumbnailSidebarCollapsedCount}>{pages.length}</Text>
      </View>
    );
  }

  return (
    <View style={workspaceContext.styles.thumbnailSidebar}>
      <View style={workspaceContext.styles.thumbnailSidebarHeader}>
        <View style={workspaceContext.styles.thumbnailSidebarHeaderTitle}>
          <MaterialCommunityIcons name="view-grid-outline" size={16} color="#5E6A7D" />
          <Text style={workspaceContext.styles.thumbnailSidebarTitle}>{pages.length}</Text>
        </View>
        <Pressable style={workspaceContext.styles.thumbnailSidebarClose} onPress={() => setOpen(false)}>
          <MaterialCommunityIcons name="chevron-left" size={16} color="#5E6A7D" />
        </Pressable>
      </View>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={workspaceContext.styles.thumbnailSidebarContent}
      >
        {pages.map((page, index) => {
          const active = isActivePage(page);
          const imageUrl = page.kind === 'pdf' && page.pageNumber ? documentContext.studyDocument?.pageImageUrls?.[page.pageNumber] : null;
          return (
            <Pressable
              key={page.id}
              style={[workspaceContext.styles.thumbnailCard, active && workspaceContext.styles.thumbnailCardActive]}
              onPress={() => openPage(page)}
            >
              <View style={workspaceContext.styles.thumbnailPreview}>
                {imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={workspaceContext.styles.thumbnailPreviewImage} resizeMode="cover" />
                ) : (
                  <View style={[workspaceContext.styles.thumbnailPreviewFallback, page.kind !== 'pdf' && workspaceContext.styles.thumbnailPreviewFallbackMemo]}>
                    <MaterialCommunityIcons name={getPageIcon(page)} size={18} color={active ? '#4F68D2' : '#7F8999'} />
                  </View>
                )}
                {page.kind === 'pdf' ? (
                  <View style={[workspaceContext.styles.thumbnailCacheBadge, imageUrl && workspaceContext.styles.thumbnailCacheBadgeReady]}>
                    <Text style={[workspaceContext.styles.thumbnailCacheBadgeText, imageUrl && workspaceContext.styles.thumbnailCacheBadgeTextReady]}>
                      {imageUrl ? '캐시' : '원본'}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={[workspaceContext.styles.thumbnailLabel, active && workspaceContext.styles.thumbnailLabelActive]} numberOfLines={1}>
                {page.label || `${index + 1}`}
              </Text>
              <View style={workspaceContext.styles.thumbnailActionRow}>
                <Pressable
                  style={workspaceContext.styles.thumbnailActionButton}
                  onPress={(event) => {
                    event.stopPropagation();
                    documentContext.onCreateMemoPage(getInsertAfterPage(page));
                  }}
                >
                  <MaterialCommunityIcons name="note-plus-outline" size={12} color="#4F68D2" />
                </Pressable>
                {page.generatedPageId ? (
                  <>
                    <Pressable
                      style={workspaceContext.styles.thumbnailActionButton}
                      onPress={(event) => {
                        event.stopPropagation();
                        documentContext.onMoveGeneratedPage(page.generatedPageId!, -1);
                      }}
                    >
                      <MaterialCommunityIcons name="arrow-up" size={12} color="#667085" />
                    </Pressable>
                    <Pressable
                      style={workspaceContext.styles.thumbnailActionButton}
                      onPress={(event) => {
                        event.stopPropagation();
                        documentContext.onMoveGeneratedPage(page.generatedPageId!, 1);
                      }}
                    >
                      <MaterialCommunityIcons name="arrow-down" size={12} color="#667085" />
                    </Pressable>
                    <Pressable
                      style={workspaceContext.styles.thumbnailActionButton}
                      onPress={(event) => {
                        event.stopPropagation();
                        documentContext.onDuplicateGeneratedPage(page.generatedPageId!);
                      }}
                    >
                      <MaterialCommunityIcons name="content-copy" size={12} color="#667085" />
                    </Pressable>
                    <Pressable
                      style={[workspaceContext.styles.thumbnailActionButton, workspaceContext.styles.thumbnailActionButtonDanger]}
                      onPress={(event) => {
                        event.stopPropagation();
                        documentContext.onRemoveGeneratedPage(page.generatedPageId!);
                      }}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={12} color="#D05252" />
                    </Pressable>
                  </>
                ) : null}
                {page.kind === 'pdf' && page.pageNumber ? (
                  <>
                    <Pressable
                      style={workspaceContext.styles.thumbnailActionButton}
                      onPress={(event) => {
                        event.stopPropagation();
                        documentContext.onMovePdfPage(page.pageNumber, -1);
                      }}
                    >
                      <MaterialCommunityIcons name="arrow-up" size={12} color="#667085" />
                    </Pressable>
                    <Pressable
                      style={workspaceContext.styles.thumbnailActionButton}
                      onPress={(event) => {
                        event.stopPropagation();
                        documentContext.onMovePdfPage(page.pageNumber, 1);
                      }}
                    >
                      <MaterialCommunityIcons name="arrow-down" size={12} color="#667085" />
                    </Pressable>
                    <Pressable
                      style={workspaceContext.styles.thumbnailActionButton}
                      onPress={(event) => {
                        event.stopPropagation();
                        documentContext.onDuplicatePdfPage(page.pageNumber);
                      }}
                    >
                      <MaterialCommunityIcons name="content-copy" size={12} color="#667085" />
                    </Pressable>
                    <Pressable
                      style={[workspaceContext.styles.thumbnailActionButton, workspaceContext.styles.thumbnailActionButtonDanger]}
                      onPress={(event) => {
                        event.stopPropagation();
                        documentContext.onRemovePdfPage(page.pageNumber);
                      }}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={12} color="#D05252" />
                    </Pressable>
                  </>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
