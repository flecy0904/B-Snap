import React from 'react';
import { PanResponder, View } from 'react-native';
import { clamp } from './ink-toolbar-options';

function snapValue(value: number, min: number, max: number, step: number) {
  return clamp(Math.round((value - min) / step) * step + min, min, max);
}

export function InkSlider(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  accent?: string;
  onChange: (value: number) => void;
}) {
  const { value, min, max, step, accent = '#1684FF', onChange } = props;
  const trackRef = React.useRef<View>(null);
  const trackLeftRef = React.useRef(0);
  const trackWidthRef = React.useRef(1);
  const percent = ((value - min) / Math.max(1, max - min)) * 100;

  const measureTrack = React.useCallback((afterMeasure?: () => void) => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      trackLeftRef.current = x;
      trackWidthRef.current = Math.max(1, width);
      afterMeasure?.();
    });
  }, []);

  const setFromPageX = React.useCallback((pageX: number) => {
    const ratio = clamp((pageX - trackLeftRef.current) / trackWidthRef.current, 0, 1);
    const next = min + ratio * (max - min);
    onChange(snapValue(next, min, max, step));
  }, [max, min, onChange, step]);

  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const pageX = event.nativeEvent.pageX;
      measureTrack(() => setFromPageX(pageX));
    },
    onPanResponderMove: (_event, gesture) => setFromPageX(gesture.moveX),
  }), [measureTrack, setFromPageX]);

  return (
    <View
      ref={trackRef}
      style={{ flex: 1, height: 28, justifyContent: 'center' }}
      onLayout={() => measureTrack()}
      {...panResponder.panHandlers}
    >
      <View style={{ height: 8, borderRadius: 99, backgroundColor: '#E6E7EA', overflow: 'hidden' }}>
        <View style={{ height: 8, borderRadius: 99, width: `${clamp(percent, 0, 100)}%`, backgroundColor: accent }} />
      </View>
      <View
        style={{
          position: 'absolute',
          left: `${clamp(percent, 0, 100)}%`,
          marginLeft: -11,
          width: 22,
          height: 22,
          borderRadius: 99,
          backgroundColor: '#FFFFFF',
          borderWidth: 1,
          borderColor: '#DCE3EF',
          shadowColor: '#64748B',
          shadowOpacity: 0.16,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 4,
        }}
      />
    </View>
  );
}
