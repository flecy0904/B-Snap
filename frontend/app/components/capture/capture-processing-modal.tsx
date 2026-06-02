import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, Modal, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
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
  const lightProgress = useRef(new Animated.Value(0)).current;
  const spinnerProgress = useRef(new Animated.Value(0)).current;
  const processingVisible = !!props.processing;
  const activeTheme = useMemo(
    () => PROCESSING_THEMES.find((item) => item.stage === props.processing?.stage) ?? PROCESSING_THEMES[0],
    [props.processing?.stage],
  );
  const activeIndex = getStageIndex(activeTheme.stage);

  useEffect(() => {
    if (!processingVisible) return undefined;

    shimmerProgress.setValue(0);
    lightProgress.setValue(0);
    spinnerProgress.setValue(0);
    const sweepAnimation = Animated.loop(
      Animated.timing(shimmerProgress, {
        toValue: 1,
        duration: 1900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const lightAnimation = Animated.loop(
      Animated.timing(lightProgress, {
        toValue: 1,
        duration: 6200,
        easing: Easing.linear,
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
    lightAnimation.start();
    spinnerAnimation.start();

    return () => {
      sweepAnimation.stop();
      lightAnimation.stop();
      spinnerAnimation.stop();
    };
  }, [lightProgress, processingVisible, shimmerProgress, spinnerProgress]);

  const lightTranslateX = lightProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-980, 920],
  });
  const lightTranslateY = lightProgress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [34, -18, -34],
  });
  const lightOpacity = lightProgress.interpolate({
    inputRange: [0, 0.08, 0.82, 1],
    outputRange: [0, 0.92, 0.92, 0],
    extrapolate: 'clamp',
  });
  const sweepOpacity = shimmerProgress.interpolate({
    inputRange: [0, 0.12, 0.84, 1],
    outputRange: [0, 1, 1, 0],
    extrapolate: 'clamp',
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
                    opacity: lightOpacity,
                    transform: [{ translateX: lightTranslateX }, { translateY: lightTranslateY }, { rotate: '8deg' }],
                  },
                ]}
              >
                <LinearGradient
                  colors={[
                    'rgba(255,255,255,0)',
                    activeTheme.overlay,
                    'rgba(255,255,255,0.46)',
                    'rgba(255,255,255,0.18)',
                    'rgba(255,255,255,0)',
                  ]}
                  locations={[0, 0.28, 0.5, 0.7, 1]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={props.styles.captureProcessingLightGradient}
                />
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
                const sweepTranslateX = shimmerProgress.interpolate({ inputRange: [0, 1], outputRange: [-260, 780] });
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
                          <Animated.View
                            style={[
                              props.styles.captureProcessingStepSweepBar,
                              {
                                opacity: sweepOpacity,
                                transform: [{ translateX: sweepTranslateX }],
                              },
                            ]}
                          >
                            <LinearGradient
                              colors={[
                                'rgba(255,255,255,0)',
                                item.shimmer,
                                item.tint,
                                item.shimmer,
                                'rgba(255,255,255,0)',
                              ]}
                              locations={[0, 0.26, 0.5, 0.74, 1]}
                              start={{ x: 0, y: 0.5 }}
                              end={{ x: 1, y: 0.5 }}
                              style={props.styles.captureProcessingStepSweepGradient}
                            />
                          </Animated.View>
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
