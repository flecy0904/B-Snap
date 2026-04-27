import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { notes, profile, semesterSchedules } from '../data';

type SettingsItem = {
  label: string;
  value?: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
};

function SettingsSection(props: { title: string; items: SettingsItem[]; styles: any }) {
  return (
    <View style={props.styles.settingsSection}>
      <Text style={props.styles.settingsTitle}>{props.title}</Text>
      <View style={props.styles.settingsCard}>
        {props.items.map((item, index) => (
          <Pressable
            key={item.label}
            onPress={item.onPress}
            style={({ pressed }) => [
              props.styles.settingsRow,
              index < props.items.length - 1 && props.styles.settingsRowBorder,
              pressed && props.styles.settingsRowPressed,
            ]}
          >
            <Text style={[props.styles.settingsLabel, item.tone === 'danger' && props.styles.settingsLabelDanger]}>{item.label}</Text>
            {item.value ? <Text style={props.styles.settingsValue}>{item.value}</Text> : <Text style={props.styles.chevron}>›</Text>}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ProfileContent(props: {
  styles: any;
  onLogout: () => void;
  isWeb?: boolean;
  currentSemesterLabel: string;
  notificationsEnabled: boolean;
  feedbackMessage: string | null;
  localSaveStatus: string;
  helpOpen: boolean;
  currentSubjectCount: number;
  onSelectSemester: (id: string) => void;
  onOpenTimetableManager: () => void;
  onOpenSubjectManager: () => void;
  onToggleNotifications: () => void;
  onExportBackup: () => void;
  onResetLocalData: () => void;
  onToggleHelp: () => void;
}) {
  const [semesterDropdownOpen, setSemesterDropdownOpen] = useState(false);

  return (
    <>
      <View style={[props.styles.profileCard, props.isWeb && props.styles.webProfileHero]}>
        <View style={props.styles.profileAvatar}>
          <Text style={props.styles.profileAvatarText}>⌂</Text>
        </View>
        <View style={props.styles.fill}>
          <Text style={props.styles.profileName}>{profile.name}</Text>
          <Text style={props.styles.profileDept}>{profile.department}</Text>
          <View style={props.styles.profileStats}>
            <Text style={props.styles.profileStat}>◫ {semesterSchedules.length}개 학기</Text>
            <Text style={props.styles.profileStat}>▣ {notes.length}개 노트</Text>
          </View>
        </View>
        {props.isWeb ? (
          <View style={props.styles.webProfileHeroMeta}>
            <Text style={props.styles.webProfileHeroLabel}>활성 학기</Text>
            <Text style={props.styles.webProfileHeroValue}>{props.currentSemesterLabel}</Text>
          </View>
        ) : null}
      </View>

      {props.feedbackMessage ? (
        <View style={props.styles.profileFeedbackCard}>
          <Text style={props.styles.profileFeedbackTitle}>실행됨</Text>
          <Text style={props.styles.profileFeedbackBody}>{props.feedbackMessage}</Text>
        </View>
      ) : null}

      {props.helpOpen ? (
        <View style={props.styles.profileHelpCard}>
          <View style={props.styles.profileHelpHeader}>
            <Text style={props.styles.profileHelpTitle}>도움말</Text>
            <Pressable onPress={props.onToggleHelp} style={props.styles.profileHelpClose}>
              <Text style={props.styles.profileHelpCloseText}>닫기</Text>
            </Pressable>
          </View>
          <Text style={props.styles.profileHelpBody}>현재 과목 수: {props.currentSubjectCount}개</Text>
          <Text style={props.styles.profileHelpBody}>학기 설정: 활성 학기를 눌러 목록에서 학기를 선택할 수 있습니다.</Text>
          <Text style={props.styles.profileHelpBody}>시간표 관리: 시간표 탭으로 이동해 학기 목록을 바로 엽니다.</Text>
          <Text style={props.styles.profileHelpBody}>저장 및 백업: 현재 학습 요약 정보를 공유 시트로 내보냅니다.</Text>
        </View>
      ) : null}

      <View style={props.isWeb ? props.styles.webProfileSectionGrid : null}>
        <View style={props.isWeb ? props.styles.webProfileSectionCell : null}>
          <View style={props.styles.settingsSection}>
            <Text style={props.styles.settingsTitle}>학습 관리</Text>
            <View style={props.styles.settingsCard}>
              <Pressable
                onPress={() => setSemesterDropdownOpen(!semesterDropdownOpen)}
                style={({ pressed }) => [
                  props.styles.settingsRow,
                  props.styles.settingsRowBorder,
                  pressed && props.styles.settingsRowPressed,
                ]}
              >
                <Text style={props.styles.settingsLabel}>현재 학기 설정</Text>
                <Text style={props.styles.settingsValue}>{props.currentSemesterLabel} {semesterDropdownOpen ? '⌃' : '⌄'}</Text>
              </Pressable>

              {semesterDropdownOpen ? (
                <View style={{ backgroundColor: '#f9f9f9', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                  {semesterSchedules.map(sem => (
                    <Pressable 
                      key={sem.id} 
                      onPress={() => {
                        props.onSelectSemester(sem.id);
                        setSemesterDropdownOpen(false);
                      }}
                      style={{ paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Text style={{ fontSize: 15, color: '#333', fontWeight: sem.label === props.currentSemesterLabel ? '700' : '400' }}>{sem.label}</Text>
                      {sem.label === props.currentSemesterLabel && <Text style={{ color: '#0055ff', fontSize: 14 }}>✓</Text>}
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Pressable
                onPress={props.onOpenTimetableManager}
                style={({ pressed }) => [props.styles.settingsRow, props.styles.settingsRowBorder, pressed && props.styles.settingsRowPressed]}
              >
                <Text style={props.styles.settingsLabel}>시간표 관리</Text>
                <Text style={props.styles.chevron}>›</Text>
              </Pressable>

              <Pressable
                onPress={props.onOpenSubjectManager}
                style={({ pressed }) => [props.styles.settingsRow, pressed && props.styles.settingsRowPressed]}
              >
                <Text style={props.styles.settingsLabel}>과목 관리</Text>
                <Text style={props.styles.settingsValue}>{props.currentSubjectCount}개</Text>
              </Pressable>
            </View>
          </View>
        </View>
        <View style={props.isWeb ? props.styles.webProfileSectionCell : null}>
          <SettingsSection
            title="앱 설정"
            styles={props.styles}
            items={[
              { label: '알림 설정', value: props.notificationsEnabled ? '켜짐' : '꺼짐', onPress: props.onToggleNotifications },
              { label: '로컬 저장', value: props.localSaveStatus, onPress: () => {} },
              { label: '저장 및 백업', onPress: props.onExportBackup },
              { label: '로컬 데이터 초기화', onPress: props.onResetLocalData, tone: 'danger' },
            ]}
          />
          <SettingsSection
            title="지원"
            styles={props.styles}
            items={[
              { label: props.helpOpen ? '도움말 닫기' : '도움말', onPress: props.onToggleHelp },
            ]}
          />
        </View>
      </View>

      <Pressable style={props.styles.logoutButton} onPress={props.onLogout}>
        <Text style={props.styles.logoutButtonText}>로그아웃</Text>
      </Pressable>

      <Text style={props.styles.footerMeta}>AI 학습 노트 v1.0.0</Text>
      <Text style={props.styles.footerMeta}>© 2026 All rights reserved</Text>
    </>
  );
}

export function MobileProfile(props: {
  styles: any;
  onLogout: () => void;
  currentSemesterLabel: string;
  notificationsEnabled: boolean;
  feedbackMessage: string | null;
  localSaveStatus: string;
  helpOpen: boolean;
  currentSubjectCount: number;
  onSelectSemester: (id: string) => void;
  onOpenTimetableManager: () => void;
  onOpenSubjectManager: () => void;
  onToggleNotifications: () => void;
  onExportBackup: () => void;
  onResetLocalData: () => void;
  onToggleHelp: () => void;
}) {
  return (
    <ScrollView style={props.styles.main} contentContainerStyle={props.styles.mobilePage}>
      <Text style={props.styles.pageTitle}>내정보</Text>
      <ProfileContent {...props} />
    </ScrollView>
  );
}

export function DesktopProfile(props: {
  compact: boolean;
  styles: any;
  onLogout: () => void;
  isWeb?: boolean;
  currentSemesterLabel: string;
  notificationsEnabled: boolean;
  feedbackMessage: string | null;
  localSaveStatus: string;
  helpOpen: boolean;
  currentSubjectCount: number;
  onSelectSemester: (id: string) => void;
  onOpenTimetableManager: () => void;
  onOpenSubjectManager: () => void;
  onToggleNotifications: () => void;
  onExportBackup: () => void;
  onResetLocalData: () => void;
  onToggleHelp: () => void;
}) {
  return (
    <ScrollView style={props.styles.main} contentContainerStyle={[props.styles.desktopPage, props.compact && props.styles.desktopPageCompact, props.isWeb && props.styles.webDesktopPage]}>
      <View style={props.isWeb ? props.styles.webPageHeader : [props.styles.desktopHeader, props.compact && props.styles.desktopHeaderCompact]}>
        {props.isWeb ? (
          <>
            <View style={props.styles.webPageHeaderMeta}>
              <Text style={props.styles.webPageEyebrow}>ACCOUNT</Text>
              <Text style={props.styles.webPageTitle}>프로필</Text>
              <Text style={props.styles.webPageBody}>사용자 정보와 학습 환경 설정을 웹 대시보드 형태로 정리했습니다.</Text>
            </View>
            <View style={props.styles.webHeaderBadgeRow}>
              <View style={props.styles.webHeaderBadge}>
                <Text style={props.styles.webHeaderBadgeText}>{profile.studentId}</Text>
              </View>
            </View>
          </>
        ) : (
          <Text style={[props.styles.desktopTitle, props.compact && props.styles.desktopTitleCompact]}>내정보</Text>
        )}
      </View>
      <ProfileContent {...props} />
    </ScrollView>
  );
}
