import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, PanResponder, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useNotesGlobalContext } from './notes-global-context';
import { useDocumentContext } from './document-context';
import { cleanAiDisplayText } from '../../../ui-helpers';

const HANDWRITING_DEBUG_ENABLED = process.env.EXPO_PUBLIC_ENABLE_HANDWRITING_DEBUG === 'true';

function formatVisionSkipReason(reason?: string | null) {
  switch (reason) {
    case 'disabled':
      return 'fallback-disabled';
    case 'missing-api-key':
      return 'missing-api-key';
    case 'cluster-limit':
      return 'cluster-limit-exceeded';
    case 'page-limit':
      return 'note-page-limit-exceeded';
    default:
      return reason || '없음';
  }
}

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
  const dockX = useSharedValue(position.x);
  const dockY = useSharedValue(position.y);
  const dockHeight = useSharedValue(panelHeight);
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
  const importantRecommendations = globalContext.importantPageRecommendations ?? [];
  const handwritingRecognition = globalContext.currentPageHandwritingRecognition;
  const handwritingBusy = globalContext.handwritingAnalysisBusy;
  const mlKitDebug = globalContext.mlKitHandwritingDebug;
  const handwritingFirstCluster = handwritingRecognition?.clusters?.[0] ?? null;
  const handwritingRejectedCandidate = handwritingFirstCluster?.symbolCandidates?.find((candidate) => !candidate.accepted && candidate.confidence > 0)
    ?? handwritingFirstCluster?.symbolCandidates?.find((candidate) => !candidate.accepted)
    ?? null;
  const handwritingReadiness = globalContext.handwritingDebugReadiness;
  const handwritingReadinessMissing = React.useMemo(() => {
    if (!handwritingReadiness) return ['readiness'];
    const missing: string[] = [];
    if (!handwritingReadiness.workspaceHydrated) missing.push('hydrated');
    if (!handwritingReadiness.backendApiEnabled) missing.push('api');
    if (!handwritingReadiness.studyDocumentId) missing.push('doc');
    if (!handwritingReadiness.backendNoteId) missing.push('noteId');
    if (!handwritingReadiness.currentDocumentHasBackendPages) missing.push('backendPages');
    if (typeof handwritingReadiness.pageNumber !== 'number') missing.push('page');
    if (!handwritingReadiness.pageId) missing.push('pageId');
    if (handwritingReadiness.pendingPageSaveCount || handwritingReadiness.savingPageCount) missing.push('save-pending');
    return missing;
  }, [handwritingReadiness]);
  const handwritingReadyText = globalContext.canAnalyzeCurrentPageHandwriting
    ? 'ready'
    : `missing ${handwritingReadinessMissing.join(', ') || 'unknown'}`;
  const handwritingKeywords = handwritingRecognition?.keywords?.length ? handwritingRecognition.keywords.join(', ') : '없음';
  const handwritingSymbols = handwritingRecognition?.symbols?.length ? handwritingRecognition.symbols.join(', ') : '없음';
  const handwritingConfidence = typeof handwritingRecognition?.confidence === 'number'
    ? `${Math.round(handwritingRecognition.confidence * 100)}%`
    : '없음';
  const handwritingClusterCount = handwritingRecognition?.analyzedClusterCount ?? handwritingRecognition?.clusters?.length ?? 0;
  const handwritingVisionClusterCount = handwritingRecognition?.visionAnalyzedClusterCount ?? 0;
  const handwritingVisionUsed = handwritingRecognition?.visionFallbackUsed ? 'yes' : 'no';
  const handwritingSkippedReason = formatVisionSkipReason(handwritingRecognition?.visionFallbackSkippedReason);
  const handwritingCacheState = [
    handwritingRecognition?.cached ? 'cached' : null,
    handwritingRecognition?.stale ? 'stale' : null,
  ].filter(Boolean).join(', ') || 'fresh';
  const mlKitCandidates = mlKitDebug?.result?.candidates?.length
    ? mlKitDebug.result.candidates.slice(0, 3).map((candidate) => (
      typeof candidate.confidence === 'number'
        ? `${candidate.text} ${Math.round(candidate.confidence * 100)}%`
        : candidate.text
    )).join(' · ')
    : '없음';
  const mlKitKeywords = mlKitDebug?.result?.keywords?.length ? mlKitDebug.result.keywords.join(', ') : '없음';
  const mlKitConfidence = typeof mlKitDebug?.result?.confidence === 'number'
    ? `${Math.round(mlKitDebug.result.confidence * 100)}%`
    : '없음';
  const getPriorityText = (priority: string) => {
    if (priority === 'very-high') return '최상';
    if (priority === 'high') return '높음';
    return '중간';
  };

  React.useEffect(() => {
    startPositionRef.current = position;
    dockX.value = position.x;
    dockY.value = position.y;
    dockHeight.value = panelHeight;
  }, [dockHeight, dockX, dockY, panelHeight, position]);

  const dockAnimatedStyle = useAnimatedStyle(() => ({
    left: dockX.value,
    top: dockY.value,
    height: dockHeight.value,
  }));

  const getClampedPosition = React.useCallback((x: number, y: number) => ({
    x: Math.max(8, Math.min(width - 316, x)),
    y: Math.max(8, Math.min(height - 380, y)),
  }), [height, width]);

  const commitDragPosition = React.useCallback((gesture: { dx: number; dy: number }) => {
    const nextPosition = getClampedPosition(
      startPositionRef.current.x + gesture.dx,
      startPositionRef.current.y + gesture.dy,
    );
    setPosition(nextPosition);
    startPositionRef.current = nextPosition;
    dockX.value = nextPosition.x;
    dockY.value = nextPosition.y;
    dockHeight.value = Math.max(360, Math.min(640, height - nextPosition.y - 16));
  }, [dockHeight, dockX, dockY, getClampedPosition, height]);

  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => {
      startPositionRef.current = position;
      dockX.value = position.x;
      dockY.value = position.y;
      dockHeight.value = panelHeight;
    },
    onPanResponderMove: (_, gesture) => {
      const nextPosition = getClampedPosition(
        startPositionRef.current.x + gesture.dx,
        startPositionRef.current.y + gesture.dy,
      );
      dockX.value = nextPosition.x;
      dockY.value = nextPosition.y;
      dockHeight.value = Math.max(360, Math.min(640, height - nextPosition.y - 16));
    },
    onPanResponderRelease: (_, gesture) => {
      commitDragPosition(gesture);
    },
    onPanResponderTerminate: (_, gesture) => {
      commitDragPosition(gesture);
    },
  }), [commitDragPosition, dockHeight, dockX, dockY, getClampedPosition, height, panelHeight, position]);

  return (
    <Reanimated.View
      style={[
        globalContext.styles.workspaceDock,
        globalContext.aiPanelOpen && globalContext.styles.workspaceDockShifted,
        {
          bottom: undefined,
        },
        dockAnimatedStyle,
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
        {HANDWRITING_DEBUG_ENABLED ? (
          <View style={globalContext.styles.workspaceDockSection}>
            <View style={globalContext.styles.workspaceDockSectionHeader}>
              <Text style={globalContext.styles.workspaceDockSectionTitle}>손필기 분석 디버그</Text>
              <Text style={globalContext.styles.workspaceDockSectionMeta}>{handwritingRecognition?.status ?? 'not-run'}</Text>
            </View>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={1}>
              engine {handwritingRecognition?.engine ?? '없음'} · status {handwritingRecognition?.status ?? 'not-run'}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
              ready {handwritingReadyText}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
              ids doc {handwritingReadiness?.studyDocumentId ?? '없음'} · note {handwritingReadiness?.backendNoteId ?? '없음'} · page {handwritingReadiness?.pageNumber ?? '없음'} · pageId {handwritingReadiness?.pageId ?? '없음'}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
              state {handwritingReadiness?.platform ?? 'unknown'} · api {handwritingReadiness?.backendApiEnabled ? 'on' : 'off'} · pages {handwritingReadiness?.backendPageCount ?? 0} · save {handwritingReadiness?.pendingPageSaveCount ?? 0}/{handwritingReadiness?.savingPageCount ?? 0}/{handwritingReadiness?.failedPageSaveCount ?? 0}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
              hash {handwritingRecognition?.strokeHash ? handwritingRecognition.strokeHash.slice(0, 12) : '없음'}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
              text {handwritingRecognition?.text || '없음'}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
              keywords {handwritingKeywords}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
              symbols {handwritingSymbols} · confidence {handwritingConfidence}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={1}>
              clusters {handwritingClusterCount} · vision clusters {handwritingVisionClusterCount}
            </Text>
            {handwritingFirstCluster ? (
              <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
                cluster {handwritingFirstCluster.clusterKind ?? 'unknown'} · text {typeof handwritingFirstCluster.textLikeScore === 'number' ? Math.round(handwritingFirstCluster.textLikeScore * 100) : 0}% · symbol {typeof handwritingFirstCluster.symbolLikeScore === 'number' ? Math.round(handwritingFirstCluster.symbolLikeScore * 100) : 0}%
              </Text>
            ) : null}
            {handwritingRejectedCandidate ? (
              <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
                rejected {handwritingRejectedCandidate.symbol} {Math.round((handwritingRejectedCandidate.confidence ?? 0) * 100)}% · {handwritingRejectedCandidate.rejectionReason ?? 'below threshold'}
              </Text>
            ) : null}
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
              vision used {handwritingVisionUsed} · skipped {handwritingSkippedReason}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={1}>
              cache {handwritingCacheState}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
              mlkit available {mlKitDebug?.available === null ? 'unknown' : mlKitDebug?.available ? 'yes' : 'no'} · model {mlKitDebug?.modelState ?? (mlKitDebug?.modelReady === null ? 'unknown' : mlKitDebug?.modelReady ? 'ready' : 'missing')}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
              mlkit candidates {mlKitCandidates}
            </Text>
            <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
              mlkit keywords {mlKitKeywords} · confidence {mlKitConfidence}
            </Text>
            {mlKitDebug?.detail ? (
              <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
                mlkit detail {mlKitDebug.detail}
              </Text>
            ) : null}
            <View style={globalContext.styles.workspaceDockActions}>
              <Pressable
                style={[globalContext.styles.workspacePrimaryAction, (!globalContext.canAnalyzeCurrentPageHandwriting || handwritingBusy) && { opacity: 0.55 }]}
                disabled={!globalContext.canAnalyzeCurrentPageHandwriting || Boolean(handwritingBusy)}
                onPress={globalContext.analyzeCurrentPageHandwriting}
              >
                <Text style={globalContext.styles.workspacePrimaryActionText}>{handwritingBusy === 'page' ? '분석 중' : '현재 페이지 재분석'}</Text>
              </Pressable>
              <Pressable
                style={[globalContext.styles.workspaceSecondaryAction, (!globalContext.canAnalyzeCurrentPageHandwriting || handwritingBusy) && { opacity: 0.55 }]}
                disabled={!globalContext.canAnalyzeCurrentPageHandwriting || Boolean(handwritingBusy)}
                onPress={globalContext.forceAnalyzeCurrentPageHandwriting}
              >
                <Text style={globalContext.styles.workspaceSecondaryActionText}>force 재분석</Text>
              </Pressable>
              <Pressable
                style={[globalContext.styles.workspaceSecondaryAction, (!globalContext.canAnalyzeCurrentPageHandwriting || handwritingBusy) && { opacity: 0.55 }]}
                disabled={!globalContext.canAnalyzeCurrentPageHandwriting || Boolean(handwritingBusy)}
                onPress={globalContext.analyzeCurrentPageHandwritingWithVision}
              >
                <Text style={globalContext.styles.workspaceSecondaryActionText}>Vision fallback</Text>
              </Pressable>
              <Pressable
                style={[globalContext.styles.workspaceSecondaryAction, handwritingBusy && { opacity: 0.55 }]}
                disabled={Boolean(handwritingBusy)}
                onPress={globalContext.analyzeCurrentNoteHandwriting}
              >
                <Text style={globalContext.styles.workspaceSecondaryActionText}>{handwritingBusy === 'note' ? '전체 분석 중' : '현재 노트 전체 재분석'}</Text>
              </Pressable>
              <Pressable
                style={[globalContext.styles.workspaceSecondaryAction, mlKitDebug?.busy && { opacity: 0.55 }]}
                disabled={Boolean(mlKitDebug?.busy)}
                onPress={globalContext.checkMlKitHandwritingAvailability}
              >
                <Text style={globalContext.styles.workspaceSecondaryActionText}>ML Kit 확인</Text>
              </Pressable>
              <Pressable
                style={[globalContext.styles.workspaceSecondaryAction, mlKitDebug?.busy && { opacity: 0.55 }]}
                disabled={Boolean(mlKitDebug?.busy)}
                onPress={globalContext.prepareKoreanHandwritingModel}
              >
                <Text style={globalContext.styles.workspaceSecondaryActionText}>한국어 모델 준비</Text>
              </Pressable>
              <Pressable
                style={[globalContext.styles.workspaceSecondaryAction, (!globalContext.canAnalyzeCurrentPageHandwriting || mlKitDebug?.busy) && { opacity: 0.55 }]}
                disabled={!globalContext.canAnalyzeCurrentPageHandwriting || Boolean(mlKitDebug?.busy)}
                onPress={globalContext.recognizeCurrentPageWithMlKit}
              >
                <Text style={globalContext.styles.workspaceSecondaryActionText}>{mlKitDebug?.busy ? 'ML Kit 실행 중' : '현재 페이지 ML Kit'}</Text>
              </Pressable>
              <Pressable
                style={[globalContext.styles.workspacePrimaryAction, (!globalContext.canAnalyzeCurrentPageHandwriting || mlKitDebug?.busy || handwritingBusy) && { opacity: 0.55 }]}
                disabled={!globalContext.canAnalyzeCurrentPageHandwriting || Boolean(mlKitDebug?.busy) || Boolean(handwritingBusy)}
                onPress={globalContext.recognizeAndSaveCurrentPageWithMlKit}
              >
                <Text style={globalContext.styles.workspacePrimaryActionText}>{mlKitDebug?.busy ? 'ML Kit 저장 중' : 'ML Kit 실행 후 저장'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {importantRecommendations.length ? (
          <View style={globalContext.styles.workspaceDockSection}>
            <View style={globalContext.styles.workspaceDockSectionHeader}>
              <Text style={globalContext.styles.workspaceDockSectionTitle}>복습 우선 페이지</Text>
              <Text style={globalContext.styles.workspaceDockSectionMeta}>추천</Text>
            </View>
            {importantRecommendations.map((signal: any, index: number) => (
              <View key={`${signal.pageNumber}-${index}`} style={globalContext.styles.workspaceDockRow}>
                <Pressable style={globalContext.styles.workspaceDockRowMeta} onPress={() => documentContext.onSetCurrentPdfPage(signal.pageNumber)}>
                  <Text style={globalContext.styles.workspaceDockRowTitle} numberOfLines={1}>
                    {index + 1}. {signal.pageNumber}p · {getPriorityText(signal.priority)}
                  </Text>
                  <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>
                    {(signal.reasonTags ?? []).slice(0, 2).join(' · ') || '복습 우선도가 높은 구간'}
                  </Text>
                  <View style={globalContext.styles.workspaceDockSignalChipRow}>
                    <View style={globalContext.styles.workspaceDockSignalChip}>
                      <Text style={globalContext.styles.workspaceDockSignalChipText}>복습 우선도 {getPriorityText(signal.priority)}</Text>
                    </View>
                  </View>
                </Pressable>
                <View style={globalContext.styles.workspaceDockRowButtons}>
                  <Pressable style={globalContext.styles.workspaceDockInlineAction} onPress={() => documentContext.onSetCurrentPdfPage(signal.pageNumber)}>
                    <Text style={globalContext.styles.workspaceDockInlineActionText}>이동</Text>
                  </Pressable>
                </View>
              </View>
            ))}
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
                <Text style={globalContext.styles.workspaceDockRowBody} numberOfLines={2}>{reference.type === 'image' ? '사진은 Photo에 보관 · 오른쪽 자료 카드에서 확인' : 'PDF 자료 연결 위치'}</Text>
              </Pressable>
              <View style={globalContext.styles.workspaceDockRowButtons}>
                <Pressable style={globalContext.styles.workspaceDockInlineAction} onPress={() => globalContext.onOpenPageCaptureReference(reference.id)}>
                  <Text style={globalContext.styles.workspaceDockInlineActionText}>페이지</Text>
                </Pressable>
                <View style={globalContext.styles.workspaceDockMiniActionsRow}>
                  <Pressable style={globalContext.styles.workspaceDockMiniAction} onPress={() => globalContext.onMovePageCaptureReference(reference.id, -1)}>
                    <MaterialCommunityIcons name="chevron-left" size={15} color="#4F68D2" />
                  </Pressable>
                  <Pressable style={globalContext.styles.workspaceDockMiniActionWide} onPress={() => globalContext.onMovePageCaptureReferenceToPage(reference.id, documentContext.currentPdfPage)}>
                    <Text style={globalContext.styles.workspaceDockMiniActionText}>현재</Text>
                  </Pressable>
                  <Pressable style={globalContext.styles.workspaceDockMiniAction} onPress={() => globalContext.onMovePageCaptureReference(reference.id, 1)}>
                    <MaterialCommunityIcons name="chevron-right" size={15} color="#4F68D2" />
                  </Pressable>
                </View>
              </View>
            </View>
          )) : (
            <Text style={globalContext.styles.workspaceDockRowBody}>사진을 찍으면 현재 페이지에 연결 위치가 기록되고, 오른쪽 자료 카드에 사진과 AI 설명이 뜹니다.</Text>
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
    </Reanimated.View>
  );
}
