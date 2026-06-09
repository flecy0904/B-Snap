import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { TabKey } from '../../types';

const TABS: TabKey[] = ['schedule', 'notes', 'capture', 'profile'];
const TAB_LABEL: Record<TabKey, string> = {
  schedule: '시간표',
  notes: '노트',
  capture: '캡처',
  profile: '프로필',
};

export function Sidebar(props: {
  tab: TabKey;
  onTab: (tab: TabKey) => void;
  compact: boolean;
  styles: any;
  blueColor: string;
  isWeb?: boolean;
}) {
  const webMode = Boolean(props.isWeb);

  return (
    <View style={[props.styles.sidebar, props.compact && props.styles.sidebarCompact, webMode && props.styles.webSidebar, webMode && props.compact && props.styles.webSidebarCompact]}>
      {webMode ? (
        <View style={props.styles.webSidebarBrand}>
          <Text style={props.styles.webSidebarEyebrow}>B</Text>
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
                <Text style={[props.styles.webSidebarButtonLabel, active && props.styles.webSidebarButtonLabelActive]}>{TAB_LABEL[item]}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
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
