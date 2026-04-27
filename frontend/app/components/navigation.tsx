import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { TabKey } from '../types';

const TABS: TabKey[] = ['schedule', 'notes', 'capture', 'profile'];
const TAB_META: Record<TabKey, { label: string; hint: string }> = {
  schedule: { label: '시간표', hint: '이번 학기 흐름' },
  notes: { label: '노트', hint: '문서와 판서 정리' },
  capture: { label: '캡처', hint: '자료 업로드' },
  profile: { label: '프로필', hint: '계정과 설정' },
};

export function Sidebar(props: {
  tab: TabKey;
  onTab: (tab: TabKey) => void;
  compact: boolean;
  styles: any;
  blueColor: string;
  isWeb?: boolean;
}) {
  const webMode = false;

  return (
    <View style={[props.styles.sidebar, props.compact && props.styles.sidebarCompact, webMode && props.styles.webSidebar]}>
      {webMode ? (
        <View style={props.styles.webSidebarBrand}>
          <Text style={props.styles.webSidebarEyebrow}>B-SNAP</Text>
          <Text style={props.styles.webSidebarTitle}>Study Workspace</Text>
          <Text style={props.styles.webSidebarBody}>수업 자료와 판서 정리를 하나의 웹 작업공간으로 관리합니다.</Text>
        </View>
      ) : null}
      {TABS.map((item) => {
        const active = item === props.tab;
        return (
          <Pressable
            key={item}
            onPress={() => props.onTab(item)}
            style={[
              props.styles.sidebarButton,
              active && props.styles.sidebarButtonActive,
              webMode && props.styles.webSidebarButton,
              webMode && active && props.styles.webSidebarButtonActive,
            ]}
          >
            <TabIcon tab={item} active={active} styles={props.styles} blueColor={props.blueColor} />
            {webMode ? (
              <View style={props.styles.webSidebarButtonTextWrap}>
                <Text style={[props.styles.webSidebarButtonLabel, active && props.styles.webSidebarButtonLabelActive]}>{TAB_META[item].label}</Text>
                <Text style={[props.styles.webSidebarButtonHint, active && props.styles.webSidebarButtonHintActive]}>{TAB_META[item].hint}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
      {webMode ? (
        <View style={props.styles.webSidebarFoot}>
          <Text style={props.styles.webSidebarFootText}>Web preview</Text>
        </View>
      ) : null}
    </View>
  );
}

export function TabIcon(props: { tab: TabKey; active: boolean; styles: any; blueColor: string }) {
  const color = props.active ? props.blueColor : '#AEB5C2';

  if (props.tab === 'schedule') {
    return (
      <View style={props.styles.iconBase}>
        <View style={[props.styles.calendarOutline, { borderColor: color }]}>
          <View style={[props.styles.calendarLine, { backgroundColor: color }]} />
          <View style={[props.styles.calendarPinLeft, { backgroundColor: color }]} />
          <View style={[props.styles.calendarPinRight, { backgroundColor: color }]} />
        </View>
      </View>
    );
  }

  if (props.tab === 'notes') {
    return (
      <View style={props.styles.iconBase}>
        <View style={[props.styles.docOutline, { borderColor: color }]}>
          <View style={[props.styles.docLineLong, { backgroundColor: color }]} />
          <View style={[props.styles.docLineShort, { backgroundColor: color }]} />
        </View>
      </View>
    );
  }

  if (props.tab === 'capture') {
    return (
      <View style={props.styles.iconBase}>
        <View style={[props.styles.cameraOutline, { borderColor: color }]}>
          <View style={[props.styles.cameraLens, { borderColor: color }]} />
          <View style={[props.styles.cameraHead, { backgroundColor: color }]} />
        </View>
      </View>
    );
  }

  return (
    <View style={props.styles.iconBase}>
      <View style={[props.styles.personHead, { borderColor: color }]} />
      <View style={[props.styles.personBody, { borderColor: color }]} />
    </View>
  );
}

export function GearIcon(props: { styles: any }) {
  return (
    <View style={props.styles.gearIcon}>
      <View style={props.styles.gearCenter} />
      <View style={[props.styles.gearTooth, props.styles.gearToothTop]} />
      <View style={[props.styles.gearTooth, props.styles.gearToothBottom]} />
      <View style={[props.styles.gearTooth, props.styles.gearToothLeft]} />
      <View style={[props.styles.gearTooth, props.styles.gearToothRight]} />
      <View style={[props.styles.gearTooth, props.styles.gearToothTopLeft]} />
      <View style={[props.styles.gearTooth, props.styles.gearToothTopRight]} />
      <View style={[props.styles.gearTooth, props.styles.gearToothBottomLeft]} />
      <View style={[props.styles.gearTooth, props.styles.gearToothBottomRight]} />
    </View>
  );
}
