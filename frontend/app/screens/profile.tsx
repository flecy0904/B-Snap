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

function ProfileContent(props: { styles: any }) {
  return (
    <>
      <View style={props.styles.profileCard}>
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
      </View>

      <SettingsSection
        title="학습 관리"
        styles={props.styles}
        items={[
          ['현재 학기 설정', profile.semester],
          ['시간표 관리'],
          ['과목 관리'],
        ]}
      />
      <SettingsSection title="앱 설정" styles={props.styles} items={[['알림 설정'], ['저장 및 백업']]} />
      <SettingsSection title="지원" styles={props.styles} items={[['도움말']]} />

      <Pressable style={props.styles.logoutButton}>
        <Text style={props.styles.logoutButtonText}>로그아웃</Text>
      </Pressable>

      <Text style={props.styles.footerMeta}>AI 학습 노트 v1.0.0</Text>
      <Text style={props.styles.footerMeta}>© 2026 All rights reserved</Text>
    </>
  );
}

export function MobileProfile(props: { styles: any }) {
  return (
    <ScrollView style={props.styles.main} contentContainerStyle={props.styles.mobilePage}>
      <Text style={props.styles.pageTitle}>내정보</Text>
      <ProfileContent styles={props.styles} />
    </ScrollView>
  );
}

export function DesktopProfile(props: { compact: boolean; styles: any }) {
  return (
    <ScrollView style={props.styles.main} contentContainerStyle={[props.styles.desktopPage, props.compact && props.styles.desktopPageCompact]}>
      <View style={[props.styles.desktopHeader, props.compact && props.styles.desktopHeaderCompact]}>
        <Text style={[props.styles.desktopTitle, props.compact && props.styles.desktopTitleCompact]}>내정보</Text>
      </View>
      <ProfileContent styles={props.styles} />
    </ScrollView>
  );
}
