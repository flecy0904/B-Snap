import React from 'react';
import { Pressable, Text, View } from 'react-native';

export function NotesDetailHeader(props: {
  styles: any;
  compact: boolean;
  caption: string;
  title: string;
  metaText?: string;
  rightAction?: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <View style={[props.styles.desktopDetailHeader, props.compact && props.styles.desktopDetailHeaderCompact]}>
      <Pressable onPress={props.onBack} style={props.styles.navIcon}><Text style={props.styles.navIconText}>{'‹'}</Text></Pressable>
      <View style={props.styles.fill}>
        <Text style={props.styles.desktopCaption}>{props.caption}</Text>
        <Text style={[props.styles.desktopDetailTitle, props.compact && props.styles.desktopDetailTitleCompact]}>{props.title}</Text>
      </View>
      {props.metaText ? (
        <View style={props.styles.documentDetailMetaPill}>
          <Text style={props.styles.documentDetailMetaText}>{props.metaText}</Text>
        </View>
      ) : null}
      {props.rightAction}
    </View>
  );
}
