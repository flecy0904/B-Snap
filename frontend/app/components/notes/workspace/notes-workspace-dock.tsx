import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, PanResponder, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useNotesGlobalContext } from './notes-global-context';
import { useDocumentContext } from './document-context';
import { cleanAiDisplayText } from '../../../ui-helpers';

export function NotesWorkspaceDock() {
  const globalContext = useNotesGlobalContext();
  const documentContext = useDocumentContext();
  const { width, height } = useWindowDimensions();
  const [position, setPosition] = React.useState(() => ({ x: 12, y: 8 }));
  const [referenceQuery, setReferenceQuery] = React.useState('');
  const [referenceScope, setReferenceScope] = React.useState<'current' | 'all'>('current');
  const startPositionRef = React.useRef(position);
  const headerIconName = 'image-multiple-outline';
  const panelHeight = Math.max(360, Math.min(640, height - position.y - 16));
  const normalizedReferenceQuery = referenceQuery.trim().toLowerCase();
  const filterReference = (reference: any) => {
    if (!normalizedReferenceQuery) return true;
    return [
      reference.title,
      reference.summary,
      reference.aiSummary,
      reference.pageLabel,
      reference.sourceDeviceLabel,
      ...(reference.keywords ?? []),
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedReferenceQuery));
  };
  const scopedReferences = referenceScope === 'current'
    ? globalContext.currentPageCaptureReferences
    : globalContext.pageCaptureReferences;
  const displayedCurrentReferences = scopedReferences.filter(filterReference);
  const otherPageReferences = globalContext.pageCaptureReferences
    .filter((reference: any) => !globalContext.currentPageCaptureReferences.some((current: any) => current.id === reference.id))
    .filter(filterReference);
  const previewBody = cleanAiDisplayText(
    globalContext.previewedIncoming?.analysisSummary ??
    globalContext.previewedIncoming?.summary ??
    globalContext.previewedInbox?.analysisSummary ??
    globalContext.previewedInbox?.summary ??
    globalContext.previewedPageReference?.aiSummary ??
    globalContext.previewedPageReference?.summary ??
    globalContext.previewedAttachment?.summary ??
    null
  );
  const previewIsIncoming = Boolean(globalContext.previewedIncoming);

  React.useEffect(() => {
    startPositionRef.current = position;
  }, [position]);

  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => {
      startPositionRef.current = position;
    },
    onPanResponderMove: (_, gesture) => {
      setPosition({
        x: Math.max(8, Math.min(width - 316, startPositionRef.current.x + gesture.dx)),
        y: Math.max(8, Math.min(height - 380, startPositionRef.current.y + gesture.dy)),
      });
    },
  }), [height, position, width]);

  return (
    <View
      style={[
        globalContext.styles.workspaceDock,
        globalContext.aiPanelOpen && globalContext.styles.workspaceDockShifted,
        { left: position.x, top: position.y, bottom: undefined, height: panelHeight },
      ]}
    >
      <View style={globalContext.styles.workspaceDockTop}>
        <MaterialCommunityIcons name={headerIconName} size={20} color="#5F79FF" />
        <View {...panResponder.panHandlers} style={globalContext.styles.workspaceDockDragHandle}>
          <MaterialCommunityIcons name="drag-horizontal-variant" size={18} color="#7E8798" />
          <Text style={globalContext.styles.workspaceDockDragText}>자료 패널</Text>
        </View>
        <Pressable style={globalContext.styles.workspaceDockClose} onPress={globalContext.onCloseWorkspaceDock}>
          <MaterialCommunityIcons name="close" size={18} color="#7A8394" />
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={globalContext.styles.workspaceDockContent}>
        {globalContext.previewTitle ? (
          <View style={globalContext.styles.workspaceDockCard}>
            <Text style={globalContext.styles.workspaceDockLabel}>
              {previewIsIncoming ? '새 사진 도착' : '자료 미리보기'}
            </Text>
            {globalContext.previewImage ? (
              <View style={globalContext.styles.workspaceDockPreviewFrame}>
                <Image source={globalContext.previewImage} style={globalContext.styles.workspaceDockPreviewImage} resizeMode="cover" />
              </View>
            ) : (
              <View style={globalContext.styles.workspaceDockPreviewFallback}>
                <MaterialCommunityIcons name="image-outline" size={28} color="#6D7BD9" />
              </View>
            )}
            <Text style={globalContext.styles.workspaceDockTitle} numberOfLines={2}>{globalContext.previewTitle}</Text>
            {globalContext.previewMeta ? (
              <Text style={globalContext.styles.workspaceDockMeta}>{globalContext.previewMeta}</Text>
            ) : null}
            {previewBody ? (
              <Text style={globalContext.styles.workspaceDockMetaMuted} numberOfLines={4}>{previewBody}</Text>
            ) : null}
            {previewIsIncoming ? (
              <View style={globalContext.styles.workspaceDockActions}>
                <Pressable style={globalContext.styles.workspacePrimaryAction} onPress={globalContext.onAcceptIncomingAsset}>
                  <Text style={globalContext.styles.workspacePrimaryActionText}>현재 페이지 연결</Text>
                </Pressable>
                <Pressable style={globalContext.styles.workspaceSecondaryAction} onPress={globalContext.onArchiveIncomingAsset}>
                  <Text style={globalContext.styles.workspaceSecondaryActionText}>보관</Text>
                </Pressable>
                <Pressable style={globalContext.styles.workspaceGhostAction} onPress={globalContext.onDismissIncomingAsset}>
                  <Text style={globalContext.styles.workspaceGhostActionText}>무시</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
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
            <Pressable style={globalContext.styles.workspacePrimaryAction} onPress={() => documentContext.onCreateMemoPage()}>
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
        <View style={globalContext.styles.workspaceDockSection}>
          <View style={globalContext.styles.workspaceDockSectionHeader}>
            <Text style={globalContext.styles.workspaceDockSectionTitle}>{referenceScope === 'current' ? '현재 페이지 연결 위치' : '문서 전체 연결 위치'}</Text>
            <Text style={globalContext.styles.workspaceDockSectionMeta}>{displayedCurrentReferences.length}</Text>
          </View>
          <View style={globalContext.styles.workspaceDockSearchRow}>
            <TextInput
              value={referenceQuery}
              onChangeText={setReferenceQuery}
              placeholder="자료 검색"
              placeholderTextColor="#9AA4B5"
              style={globalContext.styles.workspaceDockSearchInput}
            />
            <Pressable
              style={[globalContext.styles.workspaceDockScopeButton, referenceScope === 'current' && globalContext.styles.workspaceDockScopeButtonActive]}
              onPress={() => setReferenceScope('current')}
            >
              <Text style={[globalContext.styles.workspaceDockScopeText, referenceScope === 'current' && globalContext.styles.workspaceDockScopeTextActive]}>현재</Text>
            </Pressable>
            <Pressable
              style={[globalContext.styles.workspaceDockScopeButton, referenceScope === 'all' && globalContext.styles.workspaceDockScopeButtonActive]}
              onPress={() => setReferenceScope('all')}
            >
              <Text style={[globalContext.styles.workspaceDockScopeText, referenceScope === 'all' && globalContext.styles.workspaceDockScopeTextActive]}>전체</Text>
            </Pressable>
          </View>
          {displayedCurrentReferences.length ? displayedCurrentReferences.map((reference: any) => (
            <View key={reference.id} style={globalContext.styles.workspaceDockRow}>
              <Pressable style={globalContext.styles.workspaceDockReferenceIcon} onPress={() => globalContext.onPreviewPageReference(reference.id)}>
                <MaterialCommunityIcons name={reference.type === 'pdf' ? 'file-pdf-box' : 'image-outline'} size={18} color="#5F79FF" />
              </Pressable>
              <Pressable style={globalContext.styles.workspaceDockRowMeta} onPress={() => globalContext.onPreviewPageReference(reference.id)}>
                <Text style={globalContext.styles.workspaceDockRowTitle} numberOfLines={1}>{reference.pageLabel} · {reference.title}</Text>
                <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>{reference.type === 'image' ? '원본 사진은 Photo에 보관 · 오른쪽 자료 카드에서 확인' : 'PDF 자료 연결 위치'}</Text>
              </Pressable>
              <View style={globalContext.styles.workspaceDockRowButtons}>
                <Pressable style={globalContext.styles.workspaceDockInlineAction} onPress={() => globalContext.onOpenPageCaptureReference(reference.id)}>
                  <Text style={globalContext.styles.workspaceDockInlineActionText}>페이지</Text>
                </Pressable>
                <View style={globalContext.styles.workspaceDockMiniActionsRow}>
                  <Pressable style={globalContext.styles.workspaceDockMiniAction} onPress={() => globalContext.onMovePageCaptureReference(reference.id, -1)}>
                    <MaterialCommunityIcons name="chevron-left" size={15} color="#4F68D2" />
                  </Pressable>
                  <Pressable style={globalContext.styles.workspaceDockMiniAction} onPress={() => globalContext.onMovePageCaptureReference(reference.id, 1)}>
                    <MaterialCommunityIcons name="chevron-right" size={15} color="#4F68D2" />
                  </Pressable>
                </View>
              </View>
            </View>
          )) : (
            <Text style={globalContext.styles.workspaceDockRowBody}>사진을 찍으면 현재 페이지에 연결 위치가 기록되고, 오른쪽 자료 카드에 원본 사진과 AI 설명이 뜹니다.</Text>
          )}
        </View>
        {otherPageReferences.length ? (
          <View style={globalContext.styles.workspaceDockSection}>
            <View style={globalContext.styles.workspaceDockSectionHeader}>
              <Text style={globalContext.styles.workspaceDockSectionTitle}>다른 페이지 자료</Text>
              <Text style={globalContext.styles.workspaceDockSectionMeta}>{otherPageReferences.length}</Text>
            </View>
            {otherPageReferences
              .slice(0, 5)
              .map((reference: any) => (
                <View key={reference.id} style={globalContext.styles.workspaceDockRow}>
                  <Pressable style={globalContext.styles.workspaceDockRowMeta} onPress={() => globalContext.onOpenPageCaptureReference(reference.id)}>
                    <Text style={globalContext.styles.workspaceDockRowTitle} numberOfLines={1}>{reference.pageLabel} · {reference.title}</Text>
                    <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={1}>{reference.sourceDeviceLabel}</Text>
                  </Pressable>
                  <Pressable style={globalContext.styles.workspaceDockInlineAction} onPress={() => globalContext.onOpenPageCaptureReference(reference.id)}>
                    <Text style={globalContext.styles.workspaceDockInlineActionText}>이동</Text>
                  </Pressable>
                </View>
              ))}
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
                    <Pressable style={globalContext.styles.workspaceDockInlineAction} onPress={() => globalContext.onInsertInboxAsset(asset.id)}><Text style={globalContext.styles.workspaceDockInlineActionText}>연결</Text></Pressable>
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
