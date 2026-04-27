import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';

export function NotesWorkspaceDock() {
  const workspace = useDesktopNotesWorkspaceContext();
  const headerIconName = 'image-multiple-outline';

  return (
    <View style={[workspace.styles.workspaceDock, workspace.aiPanelOpen && workspace.styles.workspaceDockShifted]}>
      <View style={workspace.styles.workspaceDockTop}>
        <MaterialCommunityIcons name={headerIconName} size={20} color="#5F79FF" />
        <Pressable style={workspace.styles.workspaceDockClose} onPress={workspace.onCloseWorkspaceDock}>
          <MaterialCommunityIcons name="close" size={18} color="#7A8394" />
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={workspace.styles.workspaceDockContent}>
        <View style={workspace.styles.workspaceDockSection}>
          <View style={workspace.styles.workspaceDockSectionHeader}>
            <Text style={workspace.styles.workspaceDockSectionTitle}>중요 페이지</Text>
            <Text style={workspace.styles.workspaceDockSectionMeta}>{workspace.bookmarks.length}</Text>
          </View>
          {workspace.bookmarks.length ? workspace.bookmarks.map((bookmark) => (
            <View key={bookmark.id} style={workspace.styles.workspaceDockRow}>
              <Pressable style={workspace.styles.workspaceDockRowMeta} onPress={() => workspace.onOpenBookmarkedPage(bookmark.id)}>
                <Text style={workspace.styles.workspaceDockRowTitle} numberOfLines={1}>{bookmark.label}</Text>
                <Text style={workspace.styles.workspaceDockRowBody} numberOfLines={1}>중요 표시한 페이지</Text>
              </Pressable>
              <View style={workspace.styles.workspaceDockRowButtons}>
                <Pressable style={workspace.styles.workspaceDockInlineAction} onPress={() => workspace.onOpenBookmarkedPage(bookmark.id)}>
                  <Text style={workspace.styles.workspaceDockInlineActionText}>열기</Text>
                </Pressable>
                <Pressable style={workspace.styles.workspaceDockDeleteAction} onPress={() => workspace.onRemoveBookmark(bookmark.id)}>
                  <Text style={workspace.styles.workspaceDockDeleteActionText}>삭제</Text>
                </Pressable>
              </View>
            </View>
          )) : (
            <Text style={workspace.styles.workspaceDockRowBody}>별표를 눌러 시험/복습 페이지를 저장하세요.</Text>
          )}
        </View>
        {workspace.studyDocument.type === 'pdf' ? (
          <View style={workspace.styles.workspaceDockSection}>
            <View style={workspace.styles.workspaceDockSectionHeader}>
              <Text style={workspace.styles.workspaceDockSectionTitle}>페이지 삽입</Text>
            </View>
            <Pressable style={workspace.styles.workspacePrimaryAction} onPress={workspace.onCreateMemoPage}>
              <Text style={workspace.styles.workspacePrimaryActionText}>현재 페이지 뒤에 빈 메모 페이지 추가</Text>
            </Pressable>
            {workspace.memoPages.length ? workspace.memoPages.map((page) => (
              <View key={page.id} style={workspace.styles.workspaceDockRow}>
                <Pressable style={workspace.styles.workspaceDockRowMeta} onPress={() => workspace.onOpenGeneratedPage(page.id)}>
                  <Text style={workspace.styles.workspaceDockRowTitle} numberOfLines={1}>{page.title}</Text>
                  <Text style={workspace.styles.workspaceDockRowBody} numberOfLines={1}>{page.insertAfterPage}페이지 뒤 메모</Text>
                </Pressable>
                <View style={workspace.styles.workspaceDockRowButtons}>
                  <Pressable style={workspace.styles.workspaceDockInlineAction} onPress={() => workspace.onOpenGeneratedPage(page.id)}>
                    <Text style={workspace.styles.workspaceDockInlineActionText}>열기</Text>
                  </Pressable>
                  <Pressable style={workspace.styles.workspaceDockDeleteAction} onPress={() => workspace.onRemoveGeneratedPage(page.id)}>
                    <Text style={workspace.styles.workspaceDockDeleteActionText}>삭제</Text>
                  </Pressable>
                </View>
              </View>
            )) : null}
          </View>
        ) : null}
        {workspace.previewTitle ? (
          <View style={workspace.styles.workspaceDockCard}>
            <Text style={workspace.styles.workspaceDockLabel}>
              {workspace.previewedIncoming ? '새 자료' : workspace.previewedAttachment ? '삽입 미리보기' : 'Inbox 미리보기'}
            </Text>
            {workspace.previewImage ? (
              <View style={workspace.styles.workspaceDockPreviewFrame}>
                <Image source={workspace.previewImage} style={workspace.styles.workspaceDockPreviewImage} resizeMode="cover" />
              </View>
            ) : (
              <View style={workspace.styles.workspaceDockPreviewFallback}>
                <MaterialCommunityIcons name="image-outline" size={24} color="#6D7BD9" />
              </View>
            )}
            <Text style={workspace.styles.workspaceDockTitle}>
              {workspace.previewedIncoming ? '사진 1장 도착' : workspace.previewedAttachment ? '삽입된 정리본 미리보기' : 'Inbox 사진 미리보기'}
            </Text>
            <Text style={workspace.styles.workspaceDockMeta}>{workspace.previewTitle}</Text>
            {workspace.previewMeta ? <Text style={workspace.styles.workspaceDockMetaMuted}>{workspace.previewMeta}</Text> : null}
            <View style={workspace.styles.workspaceDockActions}>
              {workspace.previewedIncoming ? (
                <>
                  <Pressable style={workspace.styles.workspacePrimaryAction} onPress={workspace.onAcceptIncomingAsset}><Text style={workspace.styles.workspacePrimaryActionText}>삽입</Text></Pressable>
                  <Pressable style={workspace.styles.workspaceGhostAction} onPress={workspace.onDismissIncomingAsset}><Text style={workspace.styles.workspaceGhostActionText}>무시</Text></Pressable>
                </>
              ) : null}
              {workspace.previewedAttachment ? (
                <>
                  <Pressable style={workspace.styles.workspacePrimaryAction} onPress={() => workspace.onOpenWorkspaceAttachment(workspace.previewedAttachment!.id)}><Text style={workspace.styles.workspacePrimaryActionText}>열기</Text></Pressable>
                  <Pressable style={workspace.styles.workspaceDockDeleteAction} onPress={() => workspace.onRemoveWorkspaceAttachment(workspace.previewedAttachment!.id)}><Text style={workspace.styles.workspaceDockDeleteActionText}>삭제</Text></Pressable>
                </>
              ) : null}
              {workspace.previewedInbox ? (
                <>
                  <Pressable style={workspace.styles.workspacePrimaryAction} onPress={() => workspace.onInsertInboxAsset(workspace.previewedInbox!.id)}><Text style={workspace.styles.workspacePrimaryActionText}>삽입</Text></Pressable>
                  <Pressable style={workspace.styles.workspaceDockDeleteAction} onPress={() => workspace.onRemoveInboxAsset(workspace.previewedInbox!.id)}><Text style={workspace.styles.workspaceDockDeleteActionText}>삭제</Text></Pressable>
                </>
              ) : null}
            </View>
          </View>
        ) : null}
        {workspace.workspaceAttachments.length ? (
          <View style={workspace.styles.workspaceDockSection}>
            <View style={workspace.styles.workspaceDockSectionHeader}>
              <Text style={workspace.styles.workspaceDockSectionTitle}>추가한 정리 페이지</Text>
              <Text style={workspace.styles.workspaceDockSectionMeta}>{workspace.workspaceAttachments.length}</Text>
            </View>
            {workspace.workspaceAttachments.map((asset, index) => (
              <View key={`${asset.id}-${asset.generatedPageId ?? asset.assetId}-${index}`} style={workspace.styles.workspaceDockRow}>
                <Pressable style={workspace.styles.workspaceDockRowMeta} onPress={() => workspace.onPreviewAttachment(asset.assetId, asset.id)}>
                  <Text style={workspace.styles.workspaceDockRowTitle} numberOfLines={1}>{asset.title}</Text>
                  <Text style={workspace.styles.workspaceDockRowBody} numberOfLines={2}>{asset.type === 'image' ? '다음 정리 페이지' : 'PDF 참고자료'}</Text>
                </Pressable>
                <Pressable style={workspace.styles.workspaceDockInlineAction} onPress={() => workspace.onRemoveWorkspaceAttachment(asset.id)}><Text style={workspace.styles.workspaceDockInlineActionText}>삭제</Text></Pressable>
              </View>
            ))}
          </View>
        ) : null}
        {workspace.captureInbox.length ? (
          <View style={workspace.styles.workspaceDockSection}>
            <View style={workspace.styles.workspaceDockSectionHeader}>
              <Text style={workspace.styles.workspaceDockSectionTitle}>Inbox</Text>
              <Pressable style={workspace.styles.workspaceDockToggle} onPress={workspace.onToggleInboxPanel}>
                <Text style={workspace.styles.workspaceDockToggleText}>{workspace.inboxPanelOpen ? '접기' : `${workspace.captureInbox.length}건`}</Text>
              </Pressable>
            </View>
            {workspace.inboxPanelOpen ? workspace.captureInbox.map((asset) => (
              <View key={asset.id} style={workspace.styles.workspaceDockRow}>
                <Pressable style={workspace.styles.workspaceDockRowMeta} onPress={() => workspace.onPreviewInboxAsset(asset.id)}>
                  <Text style={workspace.styles.workspaceDockRowTitle} numberOfLines={1}>{asset.title}</Text>
                  <Text style={workspace.styles.workspaceDockRowBody} numberOfLines={2}>{asset.sourceDeviceLabel}</Text>
                </Pressable>
                {asset.status !== 'accepted' ? (
                  <View style={workspace.styles.workspaceDockRowButtons}>
                    <Pressable style={workspace.styles.workspaceDockInlineAction} onPress={() => workspace.onInsertInboxAsset(asset.id)}><Text style={workspace.styles.workspaceDockInlineActionText}>삽입</Text></Pressable>
                    <Pressable style={workspace.styles.workspaceDockDeleteAction} onPress={() => workspace.onRemoveInboxAsset(asset.id)}><Text style={workspace.styles.workspaceDockDeleteActionText}>삭제</Text></Pressable>
                  </View>
                ) : (
                  <Pressable style={workspace.styles.workspaceDockDeleteAction} onPress={() => workspace.onRemoveInboxAsset(asset.id)}><Text style={workspace.styles.workspaceDockDeleteActionText}>삭제</Text></Pressable>
                )}
              </View>
            )) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
