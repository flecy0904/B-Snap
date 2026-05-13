import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useNotesGlobalContext } from './notes-global-context';
import { useDocumentContext } from './document-context';
import { useNavigationContext } from './navigation-context';

export function NotesWorkspaceDock() {
  const globalContext = useNotesGlobalContext();
  const documentContext = useDocumentContext();
  const navigationContext = useNavigationContext();
  const headerIconName = 'image-multiple-outline';

  return (
    <View style={[globalContext.styles.workspaceDock, globalContext.aiPanelOpen && globalContext.styles.workspaceDockShifted]}>
      <View style={globalContext.styles.workspaceDockTop}>
        <MaterialCommunityIcons name={headerIconName} size={20} color="#5F79FF" />
        <Pressable style={globalContext.styles.workspaceDockClose} onPress={globalContext.onCloseWorkspaceDock}>
          <MaterialCommunityIcons name="close" size={18} color="#7A8394" />
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={globalContext.styles.workspaceDockContent}>
        <View style={globalContext.styles.workspaceDockSection}>
          <View style={globalContext.styles.workspaceDockSectionHeader}>
            <Text style={globalContext.styles.workspaceDockSectionTitle}>중요 페이지</Text>
            <Text style={globalContext.styles.workspaceDockSectionMeta}>{documentContext.currentDocumentBookmarks.length}</Text>
          </View>
          {documentContext.currentDocumentBookmarks.length ? documentContext.currentDocumentBookmarks.map((bookmark: any) => (
            <View key={bookmark.id} style={globalContext.styles.workspaceDockRow}>
              <Pressable style={globalContext.styles.workspaceDockRowMeta} onPress={() => documentContext.onOpenBookmarkedPage(bookmark.id)}>
                <Text style={globalContext.styles.workspaceDockRowTitle} numberOfLines={1}>{bookmark.label}</Text>
                <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={1}>중요 표시한 페이지</Text>
              </Pressable>
              <View style={globalContext.styles.workspaceDockRowButtons}>
                <Pressable style={globalContext.styles.workspaceDockInlineAction} onPress={() => documentContext.onOpenBookmarkedPage(bookmark.id)}>
                  <Text style={globalContext.styles.workspaceDockInlineActionText}>열기</Text>
                </Pressable>
                <Pressable style={globalContext.styles.workspaceDockDeleteAction} onPress={() => documentContext.onRemoveBookmark(bookmark.id)}>
                  <Text style={globalContext.styles.workspaceDockDeleteActionText}>삭제</Text>
                </Pressable>
              </View>
            </View>
          )) : (
            <Text style={globalContext.styles.workspaceDockRowBody}>별표를 눌러 시험/복습 페이지를 저장하세요.</Text>
          )}
        </View>
        {documentContext.studyDocument?.type === 'pdf' ? (
          <View style={globalContext.styles.workspaceDockSection}>
            <View style={globalContext.styles.workspaceDockSectionHeader}>
              <Text style={globalContext.styles.workspaceDockSectionTitle}>페이지 삽입</Text>
            </View>
            <Pressable style={globalContext.styles.workspacePrimaryAction} onPress={documentContext.onCreateMemoPage}>
              <Text style={globalContext.styles.workspacePrimaryActionText}>현재 페이지 뒤에 빈 메모 페이지 추가</Text>
            </Pressable>
            {documentContext.memoPages.length ? documentContext.memoPages.map((page: any) => (
              <View key={page.id} style={globalContext.styles.workspaceDockRow}>
                <Pressable style={globalContext.styles.workspaceDockRowMeta} onPress={() => documentContext.onOpenGeneratedPage(page.id)}>
                  <Text style={globalContext.styles.workspaceDockRowTitle} numberOfLines={1}>{page.title}</Text>
                  <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={1}>{page.insertAfterPage}페이지 뒤 메모</Text>
                </Pressable>
                <View style={globalContext.styles.workspaceDockRowButtons}>
                  <Pressable style={globalContext.styles.workspaceDockInlineAction} onPress={() => documentContext.onOpenGeneratedPage(page.id)}>
                    <Text style={globalContext.styles.workspaceDockInlineActionText}>열기</Text>
                  </Pressable>
                  <Pressable style={globalContext.styles.workspaceDockDeleteAction} onPress={() => documentContext.onRemoveGeneratedPage(page.id)}>
                    <Text style={globalContext.styles.workspaceDockDeleteActionText}>삭제</Text>
                  </Pressable>
                </View>
              </View>
            )) : null}
          </View>
        ) : null}
        {globalContext.previewTitle ? (
          <View style={globalContext.styles.workspaceDockCard}>
            <Text style={globalContext.styles.workspaceDockLabel}>
              {globalContext.previewedIncoming ? '새 자료' : globalContext.previewedAttachment ? '삽입 미리보기' : 'Inbox 미리보기'}
            </Text>
            {globalContext.previewImage ? (
              <View style={globalContext.styles.workspaceDockPreviewFrame}>
                <Image source={globalContext.previewImage} style={globalContext.styles.workspaceDockPreviewImage} resizeMode="cover" />
              </View>
            ) : (
              <View style={globalContext.styles.workspaceDockPreviewFallback}>
                <MaterialCommunityIcons name="image-outline" size={24} color="#6D7BD9" />
              </View>
            )}
            <Text style={globalContext.styles.workspaceDockTitle}>
              {globalContext.previewedIncoming ? '사진 1장 도착' : globalContext.previewedAttachment ? '삽입된 정리본 미리보기' : 'Inbox 사진 미리보기'}
            </Text>
            <Text style={globalContext.styles.workspaceDockMeta}>{globalContext.previewTitle}</Text>
            {globalContext.previewMeta ? <Text style={globalContext.styles.workspaceDockMetaMuted}>{globalContext.previewMeta}</Text> : null}
            <View style={globalContext.styles.workspaceDockActions}>
              {globalContext.previewedIncoming ? (
                <>
                  <Pressable style={globalContext.styles.workspacePrimaryAction} onPress={globalContext.onAcceptIncomingAsset}><Text style={globalContext.styles.workspacePrimaryActionText}>삽입</Text></Pressable>
                  <Pressable style={globalContext.styles.workspaceGhostAction} onPress={globalContext.onDismissIncomingAsset}><Text style={globalContext.styles.workspaceGhostActionText}>무시</Text></Pressable>
                </>
              ) : null}
              {globalContext.previewedAttachment ? (
                <>
                  <Pressable style={globalContext.styles.workspacePrimaryAction} onPress={() => globalContext.onOpenWorkspaceAttachment(globalContext.previewedAttachment!.id)}><Text style={globalContext.styles.workspacePrimaryActionText}>열기</Text></Pressable>
                  <Pressable style={globalContext.styles.workspaceDockDeleteAction} onPress={() => globalContext.onRemoveWorkspaceAttachment(globalContext.previewedAttachment!.id)}><Text style={globalContext.styles.workspaceDockDeleteActionText}>삭제</Text></Pressable>
                </>
              ) : null}
              {globalContext.previewedInbox ? (
                <>
                  <Pressable style={globalContext.styles.workspacePrimaryAction} onPress={() => globalContext.onInsertInboxAsset(globalContext.previewedInbox!.id)}><Text style={globalContext.styles.workspacePrimaryActionText}>삽입</Text></Pressable>
                  <Pressable style={globalContext.styles.workspaceDockDeleteAction} onPress={() => globalContext.onRemoveInboxAsset(globalContext.previewedInbox!.id)}><Text style={globalContext.styles.workspaceDockDeleteActionText}>삭제</Text></Pressable>
                </>
              ) : null}
            </View>
          </View>
        ) : null}
        {globalContext.workspaceAttachments.length ? (
          <View style={globalContext.styles.workspaceDockSection}>
            <View style={globalContext.styles.workspaceDockSectionHeader}>
              <Text style={globalContext.styles.workspaceDockSectionTitle}>추가한 정리 페이지</Text>
              <Text style={globalContext.styles.workspaceDockSectionMeta}>{globalContext.workspaceAttachments.length}</Text>
            </View>
            {globalContext.workspaceAttachments.map((asset: any, index: number) => (
              <View key={`${asset.id}-${asset.generatedPageId ?? asset.assetId}-${index}`} style={globalContext.styles.workspaceDockRow}>
                <Pressable style={globalContext.styles.workspaceDockRowMeta} onPress={() => globalContext.onPreviewAttachment(asset.assetId, asset.id)}>
                  <Text style={globalContext.styles.workspaceDockRowTitle} numberOfLines={1}>{asset.title}</Text>
                  <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>{asset.type === 'image' ? '다음 정리 페이지' : 'PDF 참고자료'}</Text>
                </Pressable>
                <Pressable style={globalContext.styles.workspaceDockInlineAction} onPress={() => globalContext.onRemoveWorkspaceAttachment(asset.id)}><Text style={globalContext.styles.workspaceDockInlineActionText}>삭제</Text></Pressable>
              </View>
            ))}
          </View>
        ) : null}
        {globalContext.captureInbox.length ? (
          <View style={globalContext.styles.workspaceDockSection}>
            <View style={globalContext.styles.workspaceDockSectionHeader}>
              <Text style={globalContext.styles.workspaceDockSectionTitle}>Inbox</Text>
              <Pressable style={globalContext.styles.workspaceDockToggle} onPress={globalContext.onToggleInboxPanel}>
                <Text style={globalContext.styles.workspaceDockToggleText}>{globalContext.inboxPanelOpen ? '접기' : `${globalContext.captureInbox.length}건`}</Text>
              </Pressable>
            </View>
            {globalContext.inboxPanelOpen ? globalContext.captureInbox.map((asset: any) => (
              <View key={asset.id} style={globalContext.styles.workspaceDockRow}>
                <Pressable style={globalContext.styles.workspaceDockRowMeta} onPress={() => globalContext.onPreviewInboxAsset(asset.id)}>
                  <Text style={globalContext.styles.workspaceDockRowTitle} numberOfLines={1}>{asset.title}</Text>
                  <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>{asset.sourceDeviceLabel}</Text>
                </Pressable>
                {asset.status !== 'accepted' ? (
                  <View style={globalContext.styles.workspaceDockRowButtons}>
                    <Pressable style={globalContext.styles.workspaceDockInlineAction} onPress={() => globalContext.onInsertInboxAsset(asset.id)}><Text style={globalContext.styles.workspaceDockInlineActionText}>삽입</Text></Pressable>
                    <Pressable style={globalContext.styles.workspaceDockDeleteAction} onPress={() => globalContext.onRemoveInboxAsset(asset.id)}><Text style={globalContext.styles.workspaceDockDeleteActionText}>삭제</Text></Pressable>
                  </View>
                ) : (
                  <Pressable style={globalContext.styles.workspaceDockDeleteAction} onPress={() => globalContext.onRemoveInboxAsset(asset.id)}><Text style={globalContext.styles.workspaceDockDeleteActionText}>삭제</Text></Pressable>
                )}
              </View>
            )) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
