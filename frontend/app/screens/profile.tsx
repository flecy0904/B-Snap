import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { notes, profile, semesterSchedules } from '../data';

function SettingsSection(props: { title: string; items: Array<[string, string?]>; styles: any }) {
  return (
    <View style={props.styles.settingsSection}>
      <Text style={props.styles.settingsTitle}>{props.title}</Text>
      <View style={props.styles.settingsCard}>
        {props.items.map(([label, value], index) => (
          <View key={label} style={[props.styles.settingsRow, index < props.items.length - 1 && props.styles.settingsRowBorder]}>
            <Text style={props.styles.settingsLabel}>{label}</Text>
            {value ? <Text style={props.styles.settingsValue}>{value}</Text> : <Text style={props.styles.chevron}>›</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}

function ProfileContent(props: { styles: any; onLogout: () => void; isWeb?: boolean }) {
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
            <Text style={props.styles.webProfileHeroValue}>{profile.semester}</Text>
          </View>
        ) : null}
      </View>

      <View style={props.isWeb ? props.styles.webProfileSectionGrid : null}>
        <View style={props.isWeb ? props.styles.webProfileSectionCell : null}>
          <SettingsSection
            title="학습 관리"
            styles={props.styles}
            items={[
              ['현재 학기 설정', profile.semester],
              ['시간표 관리'],
              ['과목 관리'],
            ]}
          />
        </View>
        <View style={props.isWeb ? props.styles.webProfileSectionCell : null}>
          <SettingsSection title="앱 설정" styles={props.styles} items={[['알림 설정'], ['저장 및 백업']]} />
          <SettingsSection title="지원" styles={props.styles} items={[['도움말']]} />
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

export function MobileProfile(props: { styles: any; onLogout: () => void }) {
  return (
    <ScrollView style={props.styles.main} contentContainerStyle={props.styles.mobilePage}>
      <Text style={props.styles.pageTitle}>내정보</Text>
      <ProfileContent styles={props.styles} onLogout={props.onLogout} />
    </ScrollView>
  );
}

export function DesktopProfile(props: { compact: boolean; styles: any; onLogout: () => void; isWeb?: boolean }) {
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
      <ProfileContent styles={props.styles} onLogout={props.onLogout} isWeb={props.isWeb} />
    </ScrollView>
  );
}
