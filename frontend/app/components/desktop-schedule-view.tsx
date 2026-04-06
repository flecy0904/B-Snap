import React from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import type { DesktopScheduleProps } from '../screens/schedule';
import { visibleHours } from '../ui-helpers';
import { DesktopTimetableBoard } from './schedule-shared';

export function DesktopScheduleView(props: DesktopScheduleProps) {
  const { height } = useWindowDimensions();
  const hours = visibleHours(props.semester.entries);
  const reservedHeight = props.compact ? 170 : 196;
  const rowHeight = Math.max(props.compact ? 44 : 50, Math.min(props.compact ? 62 : 68, Math.floor((height - reservedHeight) / hours.length)));

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={[props.styles.desktopPage, props.compact && props.styles.desktopPageCompact]}>
      <View style={[props.styles.desktopHeader, props.compact && props.styles.desktopHeaderCompact]}>
        <View>
          <Text style={props.styles.desktopCaption}>{props.semester.label}</Text>
          <Text style={[props.styles.desktopTitle, props.compact && props.styles.desktopTitleCompact]}>시간표</Text>
        </View>
      </View>

      <DesktopTimetableBoard
        semester={props.semester}
        hours={hours}
        rowHeight={rowHeight}
        compact={props.compact}
        onOpenSubject={props.onOpenSubject}
        styles={props.styles}
      />
    </ScrollView>
  );
}
