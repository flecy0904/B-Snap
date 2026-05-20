import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDocumentContext } from './document-context';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';

export function NotebookThumbnailSidebar() {
  const workspaceContext = useDesktopNotesWorkspaceContext();
  const documentContext = useDocumentContext();
  const totalPageCount = documentContext.totalDocumentPageCount || documentContext.notebookPages.length;

  return (
    <View style={workspaceContext.styles.thumbnailSidebarCollapsed}>
      <Pressable
        style={[
          workspaceContext.styles.thumbnailSidebarToggle,
          workspaceContext.pageListOpen && workspaceContext.styles.thumbnailSidebarToggleActive,
        ]}
        onPress={() => workspaceContext.setPageListOpen(true)}
      >
        <MaterialCommunityIcons name="view-grid-outline" size={19} color={workspaceContext.pageListOpen ? '#4F68D2' : '#5E6A7D'} />
      </Pressable>
      <Text style={workspaceContext.styles.thumbnailSidebarCollapsedCount}>{totalPageCount}</Text>
    </View>
  );
}
