import React from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { GearIcon } from './navigation';
import type { MobileScheduleProps } from '../screens/schedule';
import { visibleHours } from '../ui-helpers';
import { MobileTimetableCard } from './schedule-shared';

export function MobileScheduleView(props: MobileScheduleProps) {
  const { height } = useWindowDimensions();
  const hours = visibleHours(props.semester.entries);
  const compact = height <= 780;
  const reservedHeight = compact ? 228 : 246;
  const rowHeight = Math.max(46, Math.min(74, Math.floor((height - reservedHeight) / hours.length)));
  const now = new Date();
  const currentDayIndex = now.getDay() >= 1 && now.getDay() <= 5 ? now.getDay() - 1 : null;
  const showLine = currentDayIndex !== null;
  const currentTime = now.getHours() + now.getMinutes() / 60;

  if (props.listOpen) {
    return (
      <ScrollView style={props.styles.main} contentContainerStyle={props.styles.mobilePage} showsVerticalScrollIndicator={false}>
        <View style={props.styles.centerTopBar}>
          <Pressable onPress={props.onCloseList} style={props.styles.navIcon}>
            <Text style={props.styles.navIconText}>{'‹'}</Text>
          </Pressable>
          <Text style={props.styles.centerTopTitle}>시간표 목록</Text>
          <Pressable style={props.styles.navIcon}>
            <Text style={props.styles.navIconText}>＋</Text>
          </Pressable>
        </View>
        {props.semesters.map((semester) => (
          <Pressable key={semester.id} style={props.styles.semesterRow} onPress={() => props.onSelectSemester(semester.id)}>
            <View>
              <Text style={props.styles.semesterTitle}>{semester.label}</Text>
              <Text style={props.styles.semesterMeta}>시간표</Text>
            </View>
            <Text style={props.styles.chevron}>{semester.id === props.semester.id ? '✓' : '›'}</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={[props.styles.mobilePage, compact && props.styles.mobilePageCompact]} showsVerticalScrollIndicator={false}>
      <View style={[props.styles.mobileHero, compact && props.styles.mobileHeroCompact]}>
        <View>
          <Text style={[props.styles.mobileCaption, compact && props.styles.mobileCaptionCompact]}>{props.semester.label}</Text>
          <Pressable style={props.styles.heroTitleRow} onPress={props.onToggleList}>
            <Text style={[props.styles.heroTitle, compact && props.styles.heroTitleCompact]}>시간표</Text>
            <Text style={props.styles.heroTitleArrow}>⌄</Text>
          </Pressable>
        </View>
        <View style={props.styles.heroActions}>
          <Pressable style={props.styles.heroIcon}>
            <Text style={props.styles.heroIconText}>＋</Text>
          </Pressable>
          <Pressable style={props.styles.heroIcon}>
            <GearIcon styles={props.styles} />
          </Pressable>
        </View>
      </View>

      <MobileTimetableCard
        semester={props.semester}
        hours={hours}
        rowHeight={rowHeight}
        currentDayIndex={currentDayIndex}
        currentTime={currentTime}
        showLine={showLine}
        onOpenSubject={props.onOpenSubject}
        styles={props.styles}
      />
    </ScrollView>
  );
}
