import React, { useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image, NativeModules, Platform, Pressable, StatusBar as NativeStatusBar, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { subjects } from './app/data';
import { Sidebar, TabIcon } from './app/components/navigation';
import { useCaptureWorkspace } from './app/hooks/use-capture-workspace';
import { useStudyWorkspace } from './app/hooks/use-study-workspace';
import { useScheduleState } from './app/hooks/use-schedule-state';
import { SyncBridgeProvider, createMockBridge, createWebSocketBridge } from './app/hooks/use-sync-bridge';
import { DesktopNotes, MobileNotes } from './app/screens/notes';
import { DesktopCapture, MobileCapture } from './app/screens/capture';
import { DesktopProfile, MobileProfile } from './app/screens/profile';
import { DesktopSchedule, MobileSchedule } from './app/screens/schedule';
import { resolvePreviewImage } from './app/mock-preview-images';
import { C, S } from './app/styles';
import type { TabKey } from './app/types';

const TABS: TabKey[] = ['schedule', 'notes', 'capture', 'profile'];

interface AuthUser {
  id: string;
  email: string;
  provider: 'email' | 'google' | 'naver' | 'kakao';
}

function normalizeBackendHttpUrl(value?: string) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function resolveBackendHttpUrl() {
  const envUrl = normalizeBackendHttpUrl(process.env.EXPO_PUBLIC_BACKEND_URL);
  if (envUrl) {
    return envUrl;
  }

  const scriptUrl = NativeModules.SourceCode?.scriptURL;

  if (typeof scriptUrl === 'string' && scriptUrl.length > 0) {
    const normalized = scriptUrl.replace(/^exp:\/\//, 'http://').replace(/^exps:\/\//, 'https://');

    try {
      const url = new URL(normalized);
      if (url.hostname) {
        return `http://${url.hostname}:8000`;
      }
    } catch {
      // Ignore malformed bundle URLs and fall through to the next strategy.
    }
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }

  if (__DEV__) {
    return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
  }

  return null;
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);

  if (!user) {
    return <LoginScreen onLogin={setUser} />;
  }

  return <AuthenticatedApp onLogout={() => setUser(null)} />;
}

function AuthenticatedApp(props: {
  onLogout: () => void;
}) {
  const syncBridge = useMemo(
    () => {
      const httpUrl = resolveBackendHttpUrl();
      return httpUrl ? createWebSocketBridge({ httpUrl }) : createMockBridge();
    },
    [],
  );

  return (
    <SyncBridgeProvider bridge={syncBridge}>
      <AppShell onLogout={props.onLogout} />
    </SyncBridgeProvider>
  );
}

function LoginScreen(props: {
  onLogin: (user: AuthUser) => void;
}) {
  const isWeb = false;
  const [email, setEmail] = useState('student@b-snap.app');
  const [password, setPassword] = useState('bsnap1234');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password.trim()) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }

    setError(null);
    props.onLogin({
      id: 'mock-user',
      email: normalizedEmail,
      provider: 'email',
    });
  };

  const loginWithProvider = (provider: AuthUser['provider']) => {
    if (provider === 'email') {
      submit();
      return;
    }

    setError(null);
    props.onLogin({
      id: `mock-${provider}-user`,
      email: `${provider}@b-snap.app`,
      provider,
    });
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={S.safe} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <NativeStatusBar barStyle="dark-content" />
        <View style={S.loginScreen}>
          <View style={[S.loginCard, isWeb && S.webLoginCard]}>
            {isWeb ? (
              <View style={S.webLoginIntro}>
                <Text style={S.webLoginEyebrow}>B-SNAP WEB</Text>
                <Text style={S.webLoginHeadline}>수업 자료와 노트를 브라우저에서 바로 정리하세요.</Text>
                <Text style={S.webLoginBody}>시간표, 캡처, PDF 정리, AI 요약 흐름을 데스크톱 작업공간처럼 구성한 웹 프리뷰입니다.</Text>
                <View style={S.webLoginFeatureList}>
                  {['과목별 작업공간', 'PDF + 판서 정리 흐름', '실시간 캡처 inbox'].map((item) => (
                    <View key={item} style={S.webLoginFeatureRow}>
                      <View style={S.webLoginFeatureDot} />
                      <Text style={S.webLoginFeatureText}>{item}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            <View style={isWeb ? S.webLoginForm : null}>
              <View style={S.loginLogoWrap}>
                <Image source={require('./assets/icon.png')} style={S.loginLogoImage} resizeMode="contain" />
              </View>
              <Text style={S.loginTitle}>B-SNAP</Text>
              <Text style={S.loginSubtitle}>수업 자료와 노트를 한 번에 정리하세요.</Text>

              <View style={S.loginFieldGroup}>
                <Text style={S.loginLabel}>이메일</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="student@b-snap.app"
                  placeholderTextColor="#B8BFCC"
                  style={S.loginInput}
                />
              </View>
              <View style={S.loginFieldGroup}>
                <Text style={S.loginLabel}>비밀번호</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="비밀번호"
                  placeholderTextColor="#B8BFCC"
                  style={S.loginInput}
                />
              </View>

              {error ? <Text style={S.loginError}>{error}</Text> : null}

              <Pressable style={S.loginButton} onPress={submit}>
                <Text style={S.loginButtonText}>로그인</Text>
              </Pressable>

              <View style={S.loginDividerRow}>
                <View style={S.loginDividerLine} />
                <Text style={S.loginDividerText}>또는</Text>
                <View style={S.loginDividerLine} />
              </View>

              <Pressable style={S.socialLoginButton} onPress={() => loginWithProvider('google')}>
                <View style={[S.socialLoginMark, S.socialLoginMarkGoogle]}>
                  <Text style={S.socialLoginMarkText}>G</Text>
                </View>
                <Text style={S.socialLoginButtonText}>Google로 계속하기</Text>
              </Pressable>
              <Pressable style={S.socialLoginButton} onPress={() => loginWithProvider('naver')}>
                <View style={[S.socialLoginMark, S.socialLoginMarkNaver]}>
                  <Text style={S.socialLoginMarkText}>N</Text>
                </View>
                <Text style={S.socialLoginButtonText}>Naver로 계속하기</Text>
              </Pressable>
              <Pressable style={S.socialLoginButton} onPress={() => loginWithProvider('kakao')}>
                <View style={[S.socialLoginMark, S.socialLoginMarkKakao]}>
                  <Text style={S.socialLoginMarkKakaoText}>K</Text>
                </View>
                <Text style={S.socialLoginButtonText}>Kakao로 계속하기</Text>
              </Pressable>
              <Text style={S.loginHint}>현재는 mock 로그인으로 메인 앱에 진입합니다.</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function AppShell(props: {
  onLogout: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const isWeb = false;
  const wide = width >= 900 || (width >= 700 && width > height);
  const desktopCompact = wide && width < 1280;
  const [tab, setTab] = useState<TabKey>('schedule');
  const [capturePickerOpen, setCapturePickerOpen] = useState(false);
  const scheduleState = useScheduleState();
  const captureState = useCaptureWorkspace({
    subjectId: scheduleState.captureId,
  });
  const notesState = useStudyWorkspace({
    wide,
    initialSubjectId: wide ? subjects[0]?.id ?? null : null,
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
  const bannerSubject = bannerAsset ? subjects.find((item) => item.id === bannerAsset.subjectId) ?? null : null;
  const bannerPreviewImage = bannerAsset ? resolvePreviewImage(bannerAsset.previewImageKey) ?? bannerAsset.previewImage : undefined;

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
              {tab === 'schedule' && <DesktopSchedule semester={scheduleState.semester} onOpenSubject={notesState.openSubject} compact={desktopCompact} styles={S} />}
              {tab === 'notes' && (
                <DesktopNotes
                  compact={desktopCompact}
                  subject={notesState.subject}
                  note={notesState.note}
                  studyDocument={notesState.studyDocument}
                  notes={notesState.filteredNotes}
                  noteMode={notesState.noteWorkspaceMode}
                  studyDocuments={notesState.filteredStudyDocuments}
                  inkTool={notesState.inkTool}
                  inkStrokes={notesState.inkStrokes}
                  aiPanelOpen={notesState.aiPanelOpen}
                  selectionRect={notesState.selectionRect}
                  aiQuestion={notesState.aiQuestion}
                  incomingAssetSuggestion={notesState.incomingAssetSuggestion}
                  inboxHint={notesState.inboxHint}
                  inboxPendingCount={notesState.inboxPendingCount}
                  workspaceFeedback={notesState.workspaceFeedback}
                  captureInbox={notesState.captureInbox}
                  workspaceAttachments={notesState.workspaceAttachments}
                  generatedWorkspacePages={notesState.generatedWorkspacePages}
                  activeGeneratedPage={notesState.activeGeneratedPage}
                  currentDocumentPage={notesState.currentDocumentPage}
                  currentPdfPage={notesState.currentPdfPage}
                  currentDocumentPageIndex={notesState.currentDocumentPageIndex}
                  totalDocumentPageCount={notesState.totalDocumentPageCount}
                  subjects={scheduleState.semesterSubjects}
                  query={notesState.query}
                  sort={notesState.sort}
                  onChangeInkTool={notesState.changeInkTool}
                  onToggleAiPanel={notesState.toggleAiPanel}
                  onChangeAiQuestion={notesState.setAiQuestion}
                  onSelectionChange={notesState.changeSelection}
                  onClearInk={notesState.clearInk}
                  onUndoInk={notesState.undoInk}
                  onCommitInkStroke={notesState.commitInkStroke}
                  onAcceptIncomingAsset={notesState.acceptIncomingAsset}
                  onArchiveIncomingAsset={notesState.archiveIncomingAsset}
                  onDismissIncomingAsset={notesState.dismissIncomingAsset}
                  onInsertInboxAsset={notesState.insertInboxAsset}
                  onRemoveInboxAsset={notesState.removeInboxAsset}
                  onRemoveWorkspaceAttachment={notesState.removeWorkspaceAttachment}
                  onOpenWorkspaceAttachment={notesState.openWorkspaceAttachment}
                  onQuery={notesState.setQuery}
                  onSort={notesState.toggleSort}
                  onChangeMode={notesState.changeNoteWorkspaceMode}
                  onOpenStudyDocument={notesState.openStudyDocument}
                  onOpenNote={notesState.openNote}
                  onOpenSubject={notesState.openSubject}
                  onCreateBlankNote={notesState.createBlankNote}
                  onUploadPdf={notesState.uploadPdfDocument}
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
              {tab === 'profile' && <DesktopProfile compact={desktopCompact} styles={S} onLogout={props.onLogout} isWeb={isWeb} />}
            </View>
          </View>
        ) : (
          <View style={S.app}>
            <View style={S.main}>
              {tab === 'schedule' && (
                <MobileSchedule
                  semester={scheduleState.semester}
                  semesters={scheduleState.semesterSchedules}
                  listOpen={scheduleState.scheduleListOpen}
                  onToggleList={scheduleState.toggleScheduleList}
                  onCloseList={scheduleState.closeScheduleList}
                  onSelectSemester={scheduleState.selectSemester}
                  onOpenSubject={notesState.openSubject}
                  styles={S}
                />
              )}
              {tab === 'notes' && (
                <MobileNotes
                  subject={notesState.subject}
                  note={notesState.note}
                  studyDocument={notesState.studyDocument}
                  notes={notesState.filteredNotes}
                  studyDocuments={notesState.filteredStudyDocuments}
                  subjects={scheduleState.semesterSubjects}
                  query={notesState.query}
                  noteTab={notesState.noteDetailTab}
                  noteMode={notesState.noteWorkspaceMode}
                  inkTool={notesState.inkTool}
                  inkStrokes={notesState.inkStrokes}
                  aiPanelOpen={notesState.aiPanelOpen}
                  selectionRect={notesState.selectionRect}
                  aiQuestion={notesState.aiQuestion}
                  incomingAssetSuggestion={notesState.incomingAssetSuggestion}
                  inboxHint={notesState.inboxHint}
                  inboxPendingCount={notesState.inboxPendingCount}
                  workspaceFeedback={notesState.workspaceFeedback}
                  captureInbox={notesState.captureInbox}
                  workspaceAttachments={notesState.workspaceAttachments}
                  onChangeNoteTab={notesState.setNoteDetailTab}
                  onChangeMode={notesState.changeNoteWorkspaceMode}
                  onChangeInkTool={notesState.changeInkTool}
                  onToggleAiPanel={notesState.toggleAiPanel}
                  onChangeAiQuestion={notesState.setAiQuestion}
                  onSelectionChange={notesState.changeSelection}
                  onUndoInk={notesState.undoInk}
                  onClearInk={notesState.clearInk}
                  onCommitInkStroke={notesState.commitInkStroke}
                  onAcceptIncomingAsset={notesState.acceptIncomingAsset}
                  onArchiveIncomingAsset={notesState.archiveIncomingAsset}
                  onDismissIncomingAsset={notesState.dismissIncomingAsset}
                  onInsertInboxAsset={notesState.insertInboxAsset}
                  onRemoveInboxAsset={notesState.removeInboxAsset}
                  onRemoveWorkspaceAttachment={notesState.removeWorkspaceAttachment}
                  onQuery={notesState.setQuery}
                  onOpenNote={notesState.openNote}
                  onOpenStudyDocument={notesState.openStudyDocument}
                  onOpenSubject={notesState.openSubject}
                  onCreateBlankNote={notesState.createBlankNote}
                  onUploadPdf={notesState.uploadPdfDocument}
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
                  onTogglePicker={() => setCapturePickerOpen((v) => !v)}
                  onCaptureFromCamera={captureState.captureFromCamera}
                  onPickFromLibrary={captureState.pickImageFromLibrary}
                  onPickPdf={captureState.pickPdfDocument}
                  styles={S}
                />
              )}
              {tab === 'profile' && <MobileProfile styles={S} onLogout={props.onLogout} />}
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
