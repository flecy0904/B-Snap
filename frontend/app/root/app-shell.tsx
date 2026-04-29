import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image, Platform, Pressable, Share, StatusBar as NativeStatusBar, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Sidebar, TabIcon } from '../components/navigation';
import { useCaptureWorkspace } from '../hooks/use-capture-workspace';
import { useStudyWorkspace } from '../hooks/use-study-workspace';
import { useScheduleState } from '../hooks/use-schedule-state';
import { DesktopNotes, MobileNotes } from '../screens/notes';
import { DesktopCapture, MobileCapture } from '../screens/capture';
import { DesktopProfile, MobileProfile } from '../screens/profile';
import { DesktopSchedule, MobileSchedule } from '../screens/schedule';
import { resolvePreviewImage } from '../mock-preview-images';
import { C, S } from '../styles';
import type { TabKey } from '../types';

const TABS: TabKey[] = ['schedule', 'notes', 'capture', 'profile'];

export function AppShell(props: {
  onLogout: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const wide = width >= 900 || (width >= 700 && width > height);
  const desktopCompact = wide && width < 1280;
  const [tab, setTab] = useState<TabKey>('schedule');
  const [capturePickerOpen, setCapturePickerOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [profileHelpOpen, setProfileHelpOpen] = useState(false);
  const scheduleState = useScheduleState();
  const captureState = useCaptureWorkspace({
    subjectId: scheduleState.captureId,
    subjects: scheduleState.semesterSubjects,
  });
  const notesState = useStudyWorkspace({
    wide,
    subjects: scheduleState.semesterSubjects,
    initialSubjectId: wide ? scheduleState.semesterSubjects[0]?.id ?? null : null,
    onOpenNotesTab: () => setTab('notes'),
  });

  const changeTab = (next: TabKey) => {
    setTab(next);
    if (next !== 'schedule') scheduleState.closeScheduleList();
    if (next !== 'capture') {
      setCapturePickerOpen(false);
    }
  };

  const bannerAsset = wide && tab !== 'capture' ? notesState.activeIncomingBanner : null;
  const bannerSubject = bannerAsset ? scheduleState.semesterSubjects.find((item) => item.id === bannerAsset.subjectId) ?? null : null;
  const bannerPreviewImage = bannerAsset 
    ? (bannerAsset.previewImageKey?.startsWith('file://') 
        ? { uri: bannerAsset.previewImageKey } 
        : resolvePreviewImage(bannerAsset.previewImageKey) ?? bannerAsset.previewImage)
    : undefined;

  useEffect(() => {
    if (!profileFeedback) return;
    const timer = setTimeout(() => setProfileFeedback(null), 2400);
    return () => clearTimeout(timer);
  }, [profileFeedback]);

  const cycleSemesterFromProfile = () => {
    const currentIndex = scheduleState.semesterSchedules.findIndex((item) => item.id === scheduleState.semester.id);
    const nextSemester = scheduleState.semesterSchedules[(currentIndex + 1) % scheduleState.semesterSchedules.length];
    scheduleState.selectSemester(nextSemester.id);
    setProfileFeedback(`활성 학기를 ${nextSemester.label}로 변경했습니다.`);
  };

  const openTimetableManager = () => {
    setTab('schedule');
    scheduleState.openScheduleList();
    setProfileFeedback('시간표 화면으로 이동했습니다. 상단에서 학기를 바꿀 수 있습니다.');
  };

  const openSubjectManager = () => {
    const targetSubjectId = notesState.subject?.id ?? scheduleState.semesterSubjects[0]?.id ?? null;
    setTab('notes');
    if (targetSubjectId) {
      notesState.openSubject(targetSubjectId);
      const targetSubject = scheduleState.semesterSubjects.find((item) => item.id === targetSubjectId);
      setProfileFeedback(`${targetSubject?.name ?? '현재'} 과목 노트 화면으로 이동했습니다.`);
      return;
    }
    setProfileFeedback('이 학기에 표시할 과목이 없습니다.');
  };

  const toggleNotificationsFromProfile = () => {
    setNotificationsEnabled((current) => {
      const next = !current;
      setProfileFeedback(next ? '업로드 알림을 켰습니다.' : '업로드 알림을 껐습니다.');
      return next;
    });
  };

  const exportBackupFromProfile = async () => {
    const backupPayload = {
      exportedAt: new Date().toISOString(),
      semester: scheduleState.semester.label,
      subjectCount: scheduleState.semesterSubjects.length,
      noteCount: notesState.filteredNotes.length,
      documentCount: notesState.filteredStudyDocuments.length,
      notificationsEnabled,
    };

    try {
      await Share.share({
        title: 'B-SNAP backup summary',
        message: JSON.stringify(backupPayload, null, 2),
      });
      setProfileFeedback('학습 요약 백업을 공유 시트로 내보냈습니다.');
    } catch {
      setProfileFeedback('이 기기에서는 백업 공유를 열지 못했습니다.');
    }
  };

  const toggleHelpFromProfile = () => {
    setProfileHelpOpen((current) => !current);
  };

  const resetLocalDataFromProfile = () => {
    void notesState.resetLocalWorkspaceData()
      .then(() => {
        setProfileFeedback('로컬에 저장된 노트 작업 데이터를 초기화했습니다.');
      })
      .catch(() => {
        setProfileFeedback('로컬 데이터 초기화 중 문제가 발생했습니다.');
      });
  };

  const localSaveStatus = notesState.localPersistenceError
    ? '오류'
    : notesState.workspaceHydrated
      ? '켜짐'
      : '준비 중';

  return (
    <SafeAreaProvider>
      <SafeAreaView style={S.safe} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <NativeStatusBar barStyle="dark-content" />
        {bannerAsset ? (
          <View pointerEvents="box-none" style={S.appOverlay}>
            <View style={S.appBannerWrap}>
              <View style={S.appBanner}>
                {bannerPreviewImage ? <Image source={bannerPreviewImage} style={S.appBannerThumb} resizeMode="cover" /> : null}
                <View style={S.appBannerMain}>
                  <Text style={S.appBannerTitle}>
                    {bannerSubject?.name ?? '현재 과목'} 새 {bannerAsset.type === 'image' ? '사진' : 'PDF'} 도착
                  </Text>
                  <Text style={S.appBannerBody}>{bannerAsset.sourceDeviceLabel}</Text>
                </View>
                <View style={S.appBannerActions}>
                  <Pressable style={S.appBannerPrimaryButton} onPress={notesState.openIncomingBanner}>
                    <Text style={S.appBannerPrimaryText}>열기</Text>
                  </Pressable>
                  <Pressable style={S.appBannerClose} onPress={notesState.dismissIncomingBanner}>
                    <Text style={S.appBannerCloseText}>✕</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        ) : null}
        {wide ? (
          <View style={[S.desktop, desktopCompact && S.desktopCompact, isWeb && S.webDesktop]}>
            <Sidebar tab={tab} onTab={changeTab} compact={desktopCompact} styles={S} blueColor={C.blue} isWeb={isWeb} />
            <View style={[S.main, isWeb && S.webMainShell]}>
              {tab === 'schedule' && <DesktopSchedule
                  semester={scheduleState.semester}
                  subjects={scheduleState.semesterSubjects}
                  addModalOpen={scheduleState.addSubjectModalOpen}
                  editMode={scheduleState.editMode}
                  onOpenSubject={notesState.openSubject}
                  onOpenAddModal={scheduleState.openAddSubjectModal}
                  onCloseAddModal={scheduleState.closeAddSubjectModal}
                  onToggleEditMode={scheduleState.toggleEditMode}
                  onAddSubject={scheduleState.addSubject}
                  onRemoveSubject={scheduleState.removeSubject}
                  compact={desktopCompact}
                  styles={S}
                />}
              {tab === 'notes' && (
                <DesktopNotes
                  compact={desktopCompact}
                  subject={notesState.subject}
                  note={notesState.note}
                  studyDocument={notesState.studyDocument}
                  notes={notesState.filteredNotes}
                  allNotes={notesState.allNotes}
                  deletedNotes={notesState.deletedNotes}
                  noteMode={notesState.noteWorkspaceMode}
                  studyDocuments={notesState.filteredStudyDocuments}
                  allStudyDocuments={notesState.allStudyDocuments}
                  deletedStudyDocuments={notesState.deletedStudyDocuments}
                  inkTool={notesState.inkTool}
                  penColor={notesState.penColor}
                  penWidth={notesState.penWidth}
                  inkStrokes={notesState.inkStrokes}
                  textAnnotations={notesState.textAnnotations}
                  aiPanelOpen={notesState.aiPanelOpen}
                  selectionRect={notesState.selectionRect}
                  selectionPreviewUri={notesState.selectionPreviewUri}
                  aiQuestion={notesState.aiQuestion}
                  aiAnswer={notesState.aiAnswer}
                  aiMessages={notesState.aiMessages}
                  aiChatSessions={notesState.aiChatSessions}
                  noteAiChatSessions={notesState.noteAiChatSessions}
                  allAiChatSessions={notesState.allAiChatSessions}
                  aiChatScope={notesState.aiChatScope}
                  aiChatSearchQuery={notesState.aiChatSearchQuery}
                  activeAiChatSessionId={notesState.activeAiChatSessionId}
                  aiLoading={notesState.aiLoading}
                  aiError={notesState.aiError}
                  incomingAssetSuggestion={notesState.incomingAssetSuggestion}
                  inboxHint={notesState.inboxHint}
                  inboxPendingCount={notesState.inboxPendingCount}
                  workspaceFeedback={notesState.workspaceFeedback}
                  captureInbox={notesState.captureInbox}
                  workspaceAttachments={notesState.workspaceAttachments}
                  bookmarks={notesState.currentDocumentBookmarks}
                  currentPageBookmarked={notesState.currentPageBookmarked}
                  generatedWorkspacePages={notesState.generatedWorkspacePages}
                  memoPages={notesState.memoPages}
                  activeGeneratedPage={notesState.activeGeneratedPage}
                  currentDocumentPages={notesState.currentDocumentPages}
                  currentDocumentPage={notesState.currentDocumentPage}
                  currentPdfPage={notesState.currentPdfPage}
                  currentDocumentPageIndex={notesState.currentDocumentPageIndex}
                  totalDocumentPageCount={notesState.totalDocumentPageCount}
                  subjects={scheduleState.semesterSubjects}
                  query={notesState.query}
                  sort={notesState.sort}
                  onChangeInkTool={notesState.changeInkTool}
                  onChangePenColor={notesState.changePenColor}
                  onChangePenWidth={notesState.changePenWidth}
                  onToggleAiPanel={notesState.toggleAiPanel}
                  onChangeAiQuestion={notesState.setAiQuestion}
                  onChangeAiChatScope={notesState.setAiChatScope}
                  onChangeAiChatSearchQuery={notesState.setAiChatSearchQuery}
                  onSelectAiChatSession={notesState.selectAiChatSession}
                  onRenameAiChatSession={notesState.renameAiChatSession}
                  onRemoveAiChatSession={notesState.removeAiChatSession}
                  onStartNewAiChatSession={notesState.startNewAiChatSession}
                  onCreateAiChatSession={notesState.createAiChatSession}
                  onRequestAiAnswer={notesState.requestAiAnswer}
                  onInsertAiAnswerPage={notesState.insertAiAnswerPage}
                  onSelectionChange={notesState.changeSelection}
                  onSelectionPreviewChange={notesState.changeSelectionPreview}
                  onUndoInk={notesState.undoInk}
                  onRedoInk={notesState.redoInk}
                  onClearInk={notesState.clearInk}
                  onCommitInkStroke={notesState.commitInkStroke}
                  onRemoveInkStroke={notesState.removeInkStroke}
                  deleteSelectedStrokes={notesState.deleteSelectedStrokes}
                  changeSelectedStrokesColor={notesState.changeSelectedStrokesColor}
                  onAddTextAnnotation={notesState.addTextAnnotation}
                  onUpdateTextAnnotation={notesState.updateTextAnnotation}
                  onRemoveTextAnnotation={notesState.removeTextAnnotation}
                  onAcceptIncomingAsset={notesState.acceptIncomingAsset}
                  onArchiveIncomingAsset={notesState.archiveIncomingAsset}
                  onDismissIncomingAsset={notesState.dismissIncomingAsset}
                  onInsertInboxAsset={notesState.insertInboxAsset}
                  onRemoveInboxAsset={notesState.removeInboxAsset}
                  onRemoveWorkspaceAttachment={notesState.removeWorkspaceAttachment}
                  onToggleBookmarkCurrentPage={notesState.toggleBookmarkCurrentPage}
                  onOpenBookmarkedPage={notesState.openBookmarkedPage}
                  onRemoveBookmark={notesState.removeBookmark}
                  onExportCurrentDocument={notesState.exportCurrentDocumentSummary}
                  onOpenWorkspaceAttachment={notesState.openWorkspaceAttachment}
                  onOpenGeneratedPage={notesState.openGeneratedPage}
                  onRemoveGeneratedPage={notesState.removeGeneratedPage}
                  onCreateMemoPage={notesState.createMemoPage}
                  onQuery={notesState.setQuery}
                  onSort={notesState.toggleSort}
                  onChangeMode={notesState.changeNoteWorkspaceMode}
                  onOpenStudyDocument={notesState.openStudyDocument}
                  onOpenNote={notesState.openNote}
                  onOpenSubject={notesState.openSubject}
                  onDeleteNote={notesState.requestDeleteNote}
                  onDeleteStudyDocument={notesState.requestDeleteStudyDocument}
                  onRestoreNote={notesState.restoreNote}
                  onRestoreStudyDocument={notesState.restoreStudyDocument}
                  onRenameStudyDocument={notesState.renameStudyDocument}
                  onCreateBlankNote={notesState.createBlankNote}
                  onUploadPdf={notesState.uploadPdfDocument}
                  onUpdateStudyDocumentPageCount={notesState.updateStudyDocumentPageCount}
                  onReset={notesState.resetNotes}
                  onSetCurrentPdfPage={notesState.setCurrentPdfPage}
                  onGoToPreviousDocumentPage={notesState.goToPreviousDocumentPage}
                  onGoToNextDocumentPage={notesState.goToNextDocumentPage}
                  styles={S}
                  blueColor={C.blue}
                  isWeb={isWeb}
                />
              )}
              {tab === 'capture' && (
                <DesktopCapture
                  compact={desktopCompact}
                  captureId={scheduleState.captureId}
                  subjects={scheduleState.semesterSubjects}
                  recentUploads={captureState.recentUploads}
                  pendingAction={captureState.pendingAction}
                  captureFeedback={captureState.captureFeedback}
                  captureError={captureState.captureError}
                  onCaptureId={scheduleState.setCaptureId}
                  onCaptureFromCamera={captureState.captureFromCamera}
                  onPickFromLibrary={captureState.pickImageFromLibrary}
                  onPickPdf={captureState.pickPdfDocument}
                  styles={S}
                  isWeb={isWeb}
                />
              )}
              {tab === 'profile' && (
                <DesktopProfile
                  compact={desktopCompact}
                  styles={S}
                  onLogout={props.onLogout}
                  isWeb={isWeb}
                  currentSemesterLabel={scheduleState.semester.label}
                  notificationsEnabled={notificationsEnabled}
                  feedbackMessage={profileFeedback}
                  localSaveStatus={localSaveStatus}
                  helpOpen={profileHelpOpen}
                  currentSubjectCount={scheduleState.semesterSubjects.length}
                  onSelectSemester={(id) => {
                    scheduleState.selectSemester(id);
                    const label = scheduleState.semesterSchedules.find(s => s.id === id)?.label;
                    if (label) setProfileFeedback(`활성 학기를 ${label}로 변경했습니다.`);
                  }}
                  onOpenTimetableManager={openTimetableManager}
                  onOpenSubjectManager={openSubjectManager}
                  onToggleNotifications={toggleNotificationsFromProfile}
                  onExportBackup={exportBackupFromProfile}
                  onResetLocalData={resetLocalDataFromProfile}
                  onToggleHelp={toggleHelpFromProfile}
                />
              )}
            </View>
          </View>
        ) : (
          <View style={S.app}>
            <View style={S.main}>
              {tab === 'schedule' && (
                <MobileSchedule
                  semester={scheduleState.semester}
                  semesters={scheduleState.semesterSchedules}
                  subjects={scheduleState.semesterSubjects}
                  listOpen={scheduleState.scheduleListOpen}
                  addModalOpen={scheduleState.addSubjectModalOpen}
                  editMode={scheduleState.editMode}
                  onToggleList={scheduleState.toggleScheduleList}
                  onCloseList={scheduleState.closeScheduleList}
                  onSelectSemester={scheduleState.selectSemester}
                  onOpenSubject={notesState.openSubject}
                  onOpenAddModal={scheduleState.openAddSubjectModal}
                  onCloseAddModal={scheduleState.closeAddSubjectModal}
                  onToggleEditMode={scheduleState.toggleEditMode}
                  onAddSubject={scheduleState.addSubject}
                  onRemoveSubject={scheduleState.removeSubject}
                  styles={S}
                />
              )}
              {tab === 'notes' && (
                <MobileNotes
                  subject={notesState.subject}
                  note={notesState.note}
                  studyDocument={notesState.studyDocument}
                  notes={notesState.filteredNotes}
                  allNotes={notesState.allNotes}
                  deletedNotes={notesState.deletedNotes}
                  studyDocuments={notesState.filteredStudyDocuments}
                  allStudyDocuments={notesState.allStudyDocuments}
                  deletedStudyDocuments={notesState.deletedStudyDocuments}
                  subjects={scheduleState.semesterSubjects}
                  query={notesState.query}
                  noteTab={notesState.noteDetailTab}
                  noteMode={notesState.noteWorkspaceMode}
                  inkTool={notesState.inkTool}
                  penColor={notesState.penColor}
                  penWidth={notesState.penWidth}
                  inkStrokes={notesState.inkStrokes}
                  textAnnotations={notesState.textAnnotations}
                  currentPdfPage={notesState.currentPdfPage}
                  currentDocumentPages={notesState.currentDocumentPages}
                  currentDocumentPage={notesState.currentDocumentPage}
                  memoPages={notesState.memoPages}
                  activeGeneratedPage={notesState.activeGeneratedPage}
                  aiPanelOpen={notesState.aiPanelOpen}
                  selectionRect={notesState.selectionRect}
                  selectionPreviewUri={notesState.selectionPreviewUri}
                  aiQuestion={notesState.aiQuestion}
                  aiAnswer={notesState.aiAnswer}
                  aiMessages={notesState.aiMessages}
                  aiChatSessions={notesState.aiChatSessions}
                  noteAiChatSessions={notesState.noteAiChatSessions}
                  allAiChatSessions={notesState.allAiChatSessions}
                  aiChatScope={notesState.aiChatScope}
                  aiChatSearchQuery={notesState.aiChatSearchQuery}
                  activeAiChatSessionId={notesState.activeAiChatSessionId}
                  aiLoading={notesState.aiLoading}
                  aiError={notesState.aiError}
                  incomingAssetSuggestion={notesState.incomingAssetSuggestion}
                  inboxHint={notesState.inboxHint}
                  inboxPendingCount={notesState.inboxPendingCount}
                  workspaceFeedback={notesState.workspaceFeedback}
                  captureInbox={notesState.captureInbox}
                  workspaceAttachments={notesState.workspaceAttachments}
                  bookmarks={notesState.currentDocumentBookmarks}
                  currentPageBookmarked={notesState.currentPageBookmarked}
                  onChangeNoteTab={notesState.setNoteDetailTab}
                  onChangeMode={notesState.changeNoteWorkspaceMode}
                  onChangeInkTool={notesState.changeInkTool}
                  onChangePenColor={notesState.changePenColor}
                  onChangePenWidth={notesState.changePenWidth}
                  onToggleAiPanel={notesState.toggleAiPanel}
                  onChangeAiQuestion={notesState.setAiQuestion}
                  onChangeAiChatScope={notesState.setAiChatScope}
                  onChangeAiChatSearchQuery={notesState.setAiChatSearchQuery}
                  onSelectAiChatSession={notesState.selectAiChatSession}
                  onRenameAiChatSession={notesState.renameAiChatSession}
                  onRemoveAiChatSession={notesState.removeAiChatSession}
                  onStartNewAiChatSession={notesState.startNewAiChatSession}
                  onCreateAiChatSession={notesState.createAiChatSession}
                  onRequestAiAnswer={notesState.requestAiAnswer}
                  onInsertAiAnswerPage={notesState.insertAiAnswerPage}
                  onSelectionChange={notesState.changeSelection}
                  onSelectionPreviewChange={notesState.changeSelectionPreview}
                  onUndoInk={notesState.undoInk}
                  onRedoInk={notesState.redoInk}
                  onClearInk={notesState.clearInk}
                  onCommitInkStroke={notesState.commitInkStroke}
                  onRemoveInkStroke={notesState.removeInkStroke}
                  deleteSelectedStrokes={notesState.deleteSelectedStrokes}
                  changeSelectedStrokesColor={notesState.changeSelectedStrokesColor}
                  onAddTextAnnotation={notesState.addTextAnnotation}
                  onUpdateTextAnnotation={notesState.updateTextAnnotation}
                  onRemoveTextAnnotation={notesState.removeTextAnnotation}
                  onAcceptIncomingAsset={notesState.acceptIncomingAsset}
                  onArchiveIncomingAsset={notesState.archiveIncomingAsset}
                  onDismissIncomingAsset={notesState.dismissIncomingAsset}
                  onInsertInboxAsset={notesState.insertInboxAsset}
                  onRemoveInboxAsset={notesState.removeInboxAsset}
                  onRemoveWorkspaceAttachment={notesState.removeWorkspaceAttachment}
                  onToggleBookmarkCurrentPage={notesState.toggleBookmarkCurrentPage}
                  onOpenBookmarkedPage={notesState.openBookmarkedPage}
                  onRemoveBookmark={notesState.removeBookmark}
                  onExportCurrentDocument={notesState.exportCurrentDocumentSummary}
                  onOpenGeneratedPage={notesState.openGeneratedPage}
                  onQuery={notesState.setQuery}
                  onOpenNote={notesState.openNote}
                  onOpenStudyDocument={notesState.openStudyDocument}
                  onOpenSubject={notesState.openSubject}
                  onDeleteNote={notesState.requestDeleteNote}
                  onDeleteStudyDocument={notesState.requestDeleteStudyDocument}
                  onRestoreNote={notesState.restoreNote}
                  onRestoreStudyDocument={notesState.restoreStudyDocument}
                  onRenameStudyDocument={notesState.renameStudyDocument}
                  onCreateBlankNote={notesState.createBlankNote}
                  onUploadPdf={notesState.uploadPdfDocument}
                  onUpdateStudyDocumentPageCount={notesState.updateStudyDocumentPageCount}
                  onSetCurrentPdfPage={notesState.setCurrentPdfPage}
                  onBackToSubjectList={notesState.resetToSubjectList}
                  onBackToNoteList={notesState.backToNoteList}
                  styles={S}
                  blueColor={C.blue}
                />
              )}
              {tab === 'capture' && (
                <MobileCapture
                  captureId={scheduleState.captureId}
                  subjects={scheduleState.semesterSubjects}
                  recentUploads={captureState.recentUploads}
                  pendingAction={captureState.pendingAction}
                  captureFeedback={captureState.captureFeedback}
                  captureError={captureState.captureError}
                  pickerOpen={capturePickerOpen}
                  onCaptureId={(id) => {
                    scheduleState.setCaptureId(id);
                    setCapturePickerOpen(false);
                  }}
                  onTogglePicker={() => setCapturePickerOpen((value) => !value)}
                  onCaptureFromCamera={captureState.captureFromCamera}
                  onPickFromLibrary={captureState.pickImageFromLibrary}
                  onPickPdf={captureState.pickPdfDocument}
                  styles={S}
                />
              )}
              {tab === 'profile' && (
                <MobileProfile
                  styles={S}
                  onLogout={props.onLogout}
                  currentSemesterLabel={scheduleState.semester.label}
                  notificationsEnabled={notificationsEnabled}
                  feedbackMessage={profileFeedback}
                  localSaveStatus={localSaveStatus}
                  helpOpen={profileHelpOpen}
                  currentSubjectCount={scheduleState.semesterSubjects.length}
                  onSelectSemester={(id) => {
                    scheduleState.selectSemester(id);
                    const label = scheduleState.semesterSchedules.find(s => s.id === id)?.label;
                    if (label) setProfileFeedback(`활성 학기를 ${label}로 변경했습니다.`);
                  }}
                  onOpenTimetableManager={openTimetableManager}
                  onOpenSubjectManager={openSubjectManager}
                  onToggleNotifications={toggleNotificationsFromProfile}
                  onExportBackup={exportBackupFromProfile}
                  onResetLocalData={resetLocalDataFromProfile}
                  onToggleHelp={toggleHelpFromProfile}
                />
              )}
            </View>
            <View style={S.tabbar}>
              {TABS.map((item) => {
                const active = item === tab;
                return (
                  <Pressable key={item} onPress={() => changeTab(item)} style={[S.tabButton, active && S.tabButtonActive]}>
                    <TabIcon tab={item} active={active} styles={S} blueColor={C.blue} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
