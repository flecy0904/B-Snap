import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { InkTextAnnotation } from '../ui-types';

export function TextAnnotationLayer(props: {
  annotations: InkTextAnnotation[];
  styles: any;
  onChangeText: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  variant?: 'floating' | 'marker';
}) {
  const variant = props.variant ?? 'floating';

  return (
    <View pointerEvents="box-none" style={props.styles.textAnnotationLayer}>
      {props.annotations.map((annotation) => {
        if (variant === 'marker' && annotation.anchorRect) {
          return (
            <View key={annotation.id} pointerEvents="box-none">
              <View
                pointerEvents="none"
                style={[
                  props.styles.textAnnotationAnchorRect,
                  {
                    left: annotation.anchorRect.x,
                    top: annotation.anchorRect.y,
                    width: annotation.anchorRect.width,
                    height: annotation.anchorRect.height,
                  },
                ]}
              />
              <View
                style={[
                  props.styles.textAnnotationMarker,
                  {
                    left: annotation.anchorRect.x + annotation.anchorRect.width - 12,
                    top: Math.max(12, annotation.anchorRect.y - 12),
                  },
                ]}
              >
                <MaterialCommunityIcons name="note-text-outline" size={12} color="#FFFFFF" />
                <Text style={props.styles.textAnnotationMarkerText}>{annotation.text.trim() ? '메모' : '새 메모'}</Text>
              </View>
            </View>
          );
        }

        return (
          <View
            key={annotation.id}
            style={[
              props.styles.textAnnotationCard,
              {
                left: annotation.x,
                top: annotation.y,
                width: annotation.width,
              },
            ]}
          >
            <Pressable style={props.styles.textAnnotationDelete} onPress={() => props.onRemove(annotation.id)}>
              <MaterialCommunityIcons name="close" size={12} color="#6C7689" />
            </Pressable>
            <TextInput
              value={annotation.text}
              onChangeText={(text) => props.onChangeText(annotation.id, text)}
              placeholder="텍스트 메모 입력"
              placeholderTextColor="#9AA4B5"
              multiline
              style={props.styles.textAnnotationInput}
            />
          </View>
        );
      })}
    </View>
  );
}
