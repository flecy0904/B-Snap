import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { subjects } from '../data';
import { DAY_LABEL, DAYS } from '../ui-helpers';
import type { SemesterSchedule } from '../types';

interface TimetableBaseProps {
  semester: SemesterSchedule;
  hours: number[];
  rowHeight: number;
  onOpenSubject: (id: number) => void;
  styles: any;
}

export function MobileTimetableCard(props: TimetableBaseProps & { currentTime: number; currentDayIndex: number | null; showLine: boolean }) {
  return (
    <View style={props.styles.timetableCard}>
      <View style={props.styles.timetableHeader}>
        <View style={props.styles.timeColumnSpacer} />
        {DAYS.map((day) => (
          <View key={day} style={props.styles.dayHeaderCell}>
            <Text style={props.styles.dayHeaderText}>{DAY_LABEL[day]}</Text>
          </View>
        ))}
      </View>

      <View style={props.styles.timetableGrid}>
        <View style={props.styles.timeColumn}>
          {props.hours.map((hour) => (
            <View key={hour} style={[props.styles.timeCell, { height: props.rowHeight }]}>
              <Text style={props.styles.timeText}>{hour}</Text>
            </View>
          ))}
        </View>

        <View style={props.styles.dayColumns}>
          {DAYS.map((day, dayIndex) => (
            <View key={day} style={[props.styles.dayColumn, dayIndex < DAYS.length - 1 && props.styles.dayColumnBorder]}>
              {props.hours.map((hour) => (
                <View key={`${day}-${hour}`} style={[props.styles.slotCell, { height: props.rowHeight }]} />
              ))}
              {props.semester.entries
                .filter((entry) => entry.day === day)
                .map((entry) => {
                  const subject = subjects.find((value) => value.id === entry.subjectId)!;
                  return (
                    <Pressable
                      key={entry.id}
                      onPress={() => props.onOpenSubject(entry.subjectId)}
                      style={[
                        props.styles.classBlock,
                        props.styles.classBlockInset,
                        {
                          top: (entry.startHour - 9) * props.rowHeight + 3,
                          height: entry.duration * props.rowHeight - 6,
                          backgroundColor: subject.bgColor,
                        },
                      ]}
                    >
                      <Text style={[props.styles.classTitle, { color: subject.textColor }]} numberOfLines={3}>
                        {entry.subject}
                      </Text>
                      <Text style={[props.styles.classMeta, { color: subject.textColor }]} numberOfLines={1}>
                        {entry.location}
                      </Text>
                    </Pressable>
                  );
                })}
            </View>
          ))}
          {props.showLine && props.currentDayIndex !== null && props.currentTime <= props.hours[props.hours.length - 1] + 1 ? (
            <View
              style={[
                props.styles.nowLineWrap,
                {
                  top: (props.currentTime - 9) * props.rowHeight,
                  left: `${(props.currentDayIndex / 5) * 100}%`,
                },
              ]}
            >
              <View style={props.styles.nowDot} />
              <View style={props.styles.nowLine} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function DesktopTimetableBoard(props: TimetableBaseProps & { compact: boolean }) {
  return (
    <View style={[props.styles.desktopBoard, props.compact && props.styles.desktopBoardCompact]}>
      <View style={props.styles.timetableHeader}>
        <View style={[props.styles.timeColumnSpacer, { width: 64 }]} />
        {DAYS.map((day) => (
          <View key={day} style={props.styles.dayHeaderCell}>
            <Text style={props.styles.desktopDayHeader}>{DAY_LABEL[day]}</Text>
          </View>
        ))}
      </View>
      <View style={props.styles.timetableGrid}>
        <View style={[props.styles.timeColumn, { width: 64 }]}>
          {props.hours.map((hour) => (
            <View key={hour} style={[props.styles.timeCell, { height: props.rowHeight }]}>
              <Text style={props.styles.desktopTimeText}>{hour}</Text>
            </View>
          ))}
        </View>
        <View style={props.styles.dayColumns}>
          {DAYS.map((day, dayIndex) => (
            <View key={day} style={[props.styles.dayColumn, dayIndex < DAYS.length - 1 && props.styles.dayColumnBorder]}>
              {props.hours.map((hour) => (
                <View key={`${day}-${hour}`} style={[props.styles.slotCell, { height: props.rowHeight }]} />
              ))}
              {props.semester.entries
                .filter((entry) => entry.day === day)
                .map((entry) => {
                  const subject = subjects.find((value) => value.id === entry.subjectId)!;
                  return (
                    <Pressable
                      key={entry.id}
                      onPress={() => props.onOpenSubject(entry.subjectId)}
                      style={[
                        props.styles.desktopClassBlock,
                        props.styles.desktopClassBlockInset,
                        props.compact && props.styles.desktopClassBlockCompact,
                        {
                          top: (entry.startHour - 9) * props.rowHeight + 6,
                          height: entry.duration * props.rowHeight - 12,
                          backgroundColor: subject.bgColor,
                        },
                      ]}
                    >
                      <Text style={[props.styles.desktopClassTitle, props.compact && props.styles.desktopClassTitleCompact, { color: subject.textColor }]}>
                        {entry.subject}
                      </Text>
                      <Text style={[props.styles.desktopClassMeta, props.compact && props.styles.desktopClassMetaCompact, { color: subject.textColor }]}>
                        {entry.location}
                      </Text>
                    </Pressable>
                  );
                })}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
