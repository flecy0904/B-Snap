import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, Modal, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CaptureProcessingStage, CaptureProcessingState } from '../../types';

type ProcessingTheme = {
  stage: CaptureProcessingStage;
  label: string;
  body: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  tint: string;
  soft: string;
  overlay: string;
  shimmer: string;
};

const PROCESSING_THEMES: ProcessingTheme[] = [
  {
    stage: 'uploading',
    label: '업로드',
    body: '촬영 이미지를 서버에 안전하게 전송하고 있어요.',
    icon: 'cloud-upload-outline',
    tint: '#5F79FF',
    soft: '#EEF2FF',
    overlay: 'rgba(95, 121, 255, 0.18)',
    shimmer: 'rgba(95, 121, 255, 0.52)',
  },
  {
    stage: 'target-detecting',
    label: '강의자료/칠판 찾는 중',
    body: '사진 안에서 강의자료와 칠판 영역을 찾고 있어요.',
    icon: 'image-search-outline',
    tint: '#8B5CF6',
    soft: '#F4ECFF',
    overlay: 'rgba(139, 92, 246, 0.18)',
    shimmer: 'rgba(139, 92, 246, 0.52)',
  },
  {
    stage: 'preprocessing',
    label: '전처리 중',
    body: '찾은 영역을 읽기 좋은 이미지로 정리하고 있어요.',
    icon: 'image-auto-adjust',
    tint: '#0891B2',
    soft: '#E9FAFF',
    overlay: 'rgba(8, 145, 178, 0.18)',
    shimmer: 'rgba(8, 145, 178, 0.52)',
  },
  {
    stage: 'ai-commenting',
    label: 'AI 코멘트 작성 중',
    body: 'AI가 사진 내용을 요약하고 노트에 붙일 설명을 만들고 있어요.',
    icon: 'star-four-points-outline',
    tint: '#10A87A',
    soft: '#EAFBF5',
    overlay: 'rgba(16, 168, 122, 0.18)',
    shimmer: 'rgba(16, 168, 122, 0.52)',
  },
];

function getStageIndex(stage: CaptureProcessingStage) {
  return PROCESSING_THEMES.findIndex((item) => item.stage === stage);
}

export function CaptureProcessingModal(props: {
  processing: CaptureProcessingState | null;
  styles: any;
}) {
  const shimmerProgress = useRef(new Animated.Value(0)).current;
  const spinnerProgress = useRef(new Animated.Value(0)).current;
  const activeTheme = useMemo(
    () => PROCESSING_THEMES.find((item) => item.stage === props.processing?.stage) ?? PROCESSING_THEMES[0],
    [props.processing?.stage],
  );
  const activeIndex = getStageIndex(activeTheme.stage);

  useEffect(() => {
    if (!props.processing) return undefined;

    shimmerProgress.setValue(0);
    spinnerProgress.setValue(0);
    const sweepAnimation = Animated.loop(
      Animated.timing(shimmerProgress, {
        toValue: 1,
        duration: 1180,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
    );
    const spinnerAnimation = Animated.loop(
      Animated.timing(spinnerProgress, {
        toValue: 1,
        duration: 880,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    sweepAnimation.start();
    spinnerAnimation.start();

    return () => {
      sweepAnimation.stop();
      spinnerAnimation.stop();
    };
  }, [props.processing, shimmerProgress, spinnerProgress]);

  const shimmerTranslateX = shimmerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-460, 620],
  });
  const spinnerRotate = spinnerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Modal
      visible={!!props.processing}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={() => undefined}
    >
      <View style={props.styles.captureProcessingOverlay}>
        <BlurView intensity={42} tint="light" style={props.styles.captureProcessingBlur} />
        <View style={props.styles.captureProcessingDim} />
        {props.processing ? (
          <View style={props.styles.captureProcessingCard}>
            <View style={props.styles.captureProcessingHeader}>
              <View style={[props.styles.captureProcessingIconWrap, { backgroundColor: activeTheme.soft }]}>
                <MaterialCommunityIcons name={activeTheme.icon} size={22} color={activeTheme.tint} />
              </View>
              <View style={props.styles.fill}>
                <Text style={props.styles.captureProcessingTitle}>이미지를 처리 중입니다</Text>
                <Text style={props.styles.captureProcessingSubtitle}>{activeTheme.body}</Text>
              </View>
            </View>

            <View style={props.styles.captureProcessingImageFrame}>
              <Image source={{ uri: props.processing.imageUri }} style={props.styles.captureProcessingImage} resizeMode="cover" />
              <View style={[props.styles.captureProcessingImageTint, { backgroundColor: activeTheme.overlay }]} />
              <Animated.View
                pointerEvents="none"
                style={[
                  props.styles.captureProcessingLightSweep,
                  {
                    shadowColor: activeTheme.tint,
                    transform: [{ translateX: shimmerTranslateX }, { rotate: '12deg' }],
                  },
                ]}
              >
                <BlurView intensity={18} tint="light" style={props.styles.captureProcessingLightBlur} />
                <View style={[props.styles.captureProcessingLightShade, { left: 0 }]} />
                <View style={[props.styles.captureProcessingLightWash, { backgroundColor: activeTheme.overlay }]} />
                <View style={[props.styles.captureProcessingLightHighlight, { backgroundColor: 'rgba(255,255,255,0.22)' }]} />
                <View style={[props.styles.captureProcessingLightShade, { right: 0 }]} />
              </Animated.View>
              <View style={[props.styles.captureProcessingImageBadge, { backgroundColor: activeTheme.tint }]}>
                <MaterialCommunityIcons name={activeTheme.icon} size={14} color="#FFFFFF" />
                <Text style={props.styles.captureProcessingImageBadgeText}>{activeTheme.label}</Text>
              </View>
            </View>

            <View style={props.styles.captureProcessingSteps}>
              {PROCESSING_THEMES.map((item, index) => {
                const completed = index < activeIndex;
                const active = index === activeIndex;
                const color = completed || active ? item.tint : '#A8B0C0';
                const sweepTranslateX = shimmerProgress.interpolate({ inputRange: [0, 1], outputRange: [-140, 620] });
                const delayedSweepTranslateX = shimmerProgress.interpolate({ inputRange: [0, 1], outputRange: [-320, 440] });
                return (
                  <View key={item.stage} style={props.styles.captureProcessingStep}>
                    <View
                      style={[
                        props.styles.captureProcessingStepIcon,
                        active && { borderColor: item.tint, backgroundColor: item.soft },
                        completed && { borderColor: item.tint, backgroundColor: item.tint },
                      ]}
                    >
                      {completed ? (
                        <MaterialCommunityIcons name="check" size={15} color="#FFFFFF" />
                      ) : active ? (
                        <Animated.View
                          style={[
                            props.styles.captureProcessingStepSpinner,
                            {
                              borderTopColor: item.tint,
                              borderRightColor: item.tint,
                              borderBottomColor: item.soft,
                              borderLeftColor: 'transparent',
                              transform: [{ rotate: spinnerRotate }],
                            },
                          ]}
                        />
                      ) : (
                        <MaterialCommunityIcons name={item.icon} size={15} color={color} />
                      )}
                    </View>
                    <View style={props.styles.fill}>
                      <Text
                        style={[
                          props.styles.captureProcessingStepLabel,
                          (active || completed) && { color: item.tint },
                        ]}
                        numberOfLines={1}
                      >
                        {item.label}
                      </Text>
                      <View style={props.styles.captureProcessingStepTrack}>
                        {completed ? (
                          <View style={[props.styles.captureProcessingStepCompleteBar, { backgroundColor: item.tint }]} />
                        ) : active ? (
                          <>
                            <Animated.View
                              style={[
                                props.styles.captureProcessingStepSweepBar,
                                {
                                  backgroundColor: item.tint,
                                  shadowColor: item.tint,
                                  transform: [{ translateX: sweepTranslateX }],
                                },
                              ]}
                            />
                            <Animated.View
                              style={[
                                props.styles.captureProcessingStepSweepBar,
                                props.styles.captureProcessingStepSweepBarSoft,
                                {
                                  backgroundColor: item.tint,
                                  transform: [{ translateX: delayedSweepTranslateX }],
                                },
                              ]}
                            />
                          </>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
