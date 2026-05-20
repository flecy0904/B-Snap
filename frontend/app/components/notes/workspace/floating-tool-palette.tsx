import React from 'react';
import { PanResponder, Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import type { InkBrush, InkBrushSettings, InkLinePattern, InkSelectionMode, InkTool } from '../../../ui-types';
import { useCanvasContext } from '../canvas/canvas-context';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';

type DetailMode = 'pen' | 'highlight' | 'shape';
type DetailAnchor = InkBrush | 'shape' | null;

const SHAPE_TOOLS: Array<{ tool: InkTool; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }> = [
  { tool: 'line', icon: 'vector-line' },
  { tool: 'arrow', icon: 'arrow-top-right' },
  { tool: 'rect', icon: 'rectangle-outline' },
  { tool: 'ellipse', icon: 'circle-outline' },
];

const PEN_BRUSHES: Array<{ brush: Exclude<InkBrush, 'highlighter'>; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }> = [
  { brush: 'ballpoint', label: '볼펜', icon: 'pencil-outline' },
  { brush: 'pencil', label: '연필', icon: 'lead-pencil' },
  { brush: 'marker', label: '마커', icon: 'marker' },
];

const FAVORITE_PEN_COLORS = ['#111827', '#E11D48', '#2563EB', '#FFFFFF'];
const FAVORITE_HIGHLIGHT_COLORS = ['#FDE047', '#FB7185', '#86EFAC', '#9FD1EE'];
const PEN_COLORS = [...FAVORITE_PEN_COLORS, '#F5AFC8', '#8DBA98', '#C4B5FD'];
const HIGHLIGHT_COLORS = [...FAVORITE_HIGHLIGHT_COLORS, '#FDBA74', '#C4B5FD'];
const PEN_WIDTHS = [2, 3, 4, 6, 8, 10];
const HIGHLIGHT_WIDTHS = [10, 12, 16, 20, 24, 30];
const QUICK_PEN_WIDTHS = [2, 4, 8];
const QUICK_HIGHLIGHT_WIDTHS = [12, 18, 24];
const LINE_PATTERNS: Array<{ pattern: InkLinePattern; label: string }> = [
  { pattern: 'solid', label: '실선' },
  { pattern: 'dotted', label: '점선' },
];
const SELECTION_MODES: Array<{ mode: InkSelectionMode; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }> = [
  { mode: 'rect', label: '네모', icon: 'selection-drag' },
  { mode: 'lasso', label: '올가미', icon: 'lasso' },
];
const BRUSH_LABELS: Record<InkBrush, string> = {
  ballpoint: '볼펜',
  fountain: '볼펜',
  pencil: '연필',
  marker: '마커',
  highlighter: '형광펜',
};
const ADVANCED_CONTROLS: Array<{ key: keyof InkBrushSettings; label: string; hint?: string }> = [
  { key: 'stability', label: '손떨림 보정', hint: '낮으면 펜슬 움직임 그대로, 높으면 선이 더 매끈해져요.' },
  { key: 'sharpness', label: '끝 처리' },
  { key: 'pressure', label: '압력 반응' },
  { key: 'density', label: '농도' },
];
const PREVIEW_PATH = 'M 22 50 C 72 18 116 22 154 50 S 218 58 238 28';

function isShapeTool(tool: InkTool) {
  return tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse';
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function snapValue(value: number, min: number, max: number, step: number) {
  return clamp(Math.round((value - min) / step) * step + min, min, max);
}

function InkSlider(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  accent?: string;
  onChange: (value: number) => void;
}) {
  const trackRef = React.useRef<View>(null);
  const trackLeftRef = React.useRef(0);
  const trackWidthRef = React.useRef(1);
  const accent = props.accent ?? '#1684FF';
  const percent = ((props.value - props.min) / Math.max(1, props.max - props.min)) * 100;

  const measureTrack = React.useCallback((afterMeasure?: () => void) => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      trackLeftRef.current = x;
      trackWidthRef.current = Math.max(1, width);
      afterMeasure?.();
    });
  }, []);

  const setFromPageX = React.useCallback((pageX: number) => {
    const ratio = clamp((pageX - trackLeftRef.current) / trackWidthRef.current, 0, 1);
    const next = props.min + ratio * (props.max - props.min);
    props.onChange(snapValue(next, props.min, props.max, props.step));
  }, [props]);

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

export function FloatingToolPalette() {
  const workspaceContext = useDesktopNotesWorkspaceContext();
  const canvasContext = useCanvasContext();
  const [detailMode, setDetailMode] = React.useState<DetailMode>('pen');
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailAnchor, setDetailAnchor] = React.useState<DetailAnchor>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [colorLibraryOpen, setColorLibraryOpen] = React.useState(false);
  const [selectionModeOpen, setSelectionModeOpen] = React.useState(false);

  React.useEffect(() => {
    setDetailMode('pen');
    setDetailOpen(false);
    setDetailAnchor(null);
    setAdvancedOpen(false);
    setColorLibraryOpen(false);
    setSelectionModeOpen(false);
  }, [workspaceContext.studyDocumentId]);

  React.useEffect(() => {
    if (canvasContext.linePattern === 'dashed') canvasContext.setLinePattern('dotted');
  }, [canvasContext.linePattern, canvasContext.setLinePattern]);

  const closeDetail = React.useCallback(() => {
    setDetailOpen(false);
    setDetailAnchor(null);
    setAdvancedOpen(false);
    setColorLibraryOpen(false);
    setSelectionModeOpen(false);
  }, []);

  const openDetail = React.useCallback((mode: DetailMode, anchor: DetailAnchor) => {
    setDetailMode(mode);
    setDetailAnchor(anchor);
    setDetailOpen(true);
    setSelectionModeOpen(false);
    setColorLibraryOpen(false);
    workspaceContext.setPageListOpen(false);
  }, [workspaceContext]);

  const setBrushSetting = (key: keyof InkBrushSettings, value: number) => {
    canvasContext.setBrushSettings({ [key]: Math.max(0, Math.min(100, value)) });
  };

  const activatePrimaryPen = () => {
    const currentBrush = canvasContext.brushType === 'highlighter' || canvasContext.brushType === 'fountain' ? 'ballpoint' : canvasContext.brushType;
    const alreadyActive = canvasContext.inkTool === 'pen';
    canvasContext.setBrushType(currentBrush);
    canvasContext.setInkTool('pen');
    canvasContext.setLinePattern('solid');
    if (alreadyActive) {
      if (detailOpen && detailMode === 'pen') closeDetail();
      else openDetail('pen', currentBrush);
    } else {
      closeDetail();
    }
    workspaceContext.setPageListOpen(false);
  };

  const activateSelectionTool = () => {
    closeDetail();
    if (canvasContext.inkTool === 'select') {
      setSelectionModeOpen((current) => !current);
      return;
    }
    canvasContext.setInkTool('select');
    setSelectionModeOpen(true);
    workspaceContext.setPageListOpen(false);
  };

  const chooseSelectionMode = (mode: InkSelectionMode) => {
    canvasContext.setSelectionMode(mode);
    setSelectionModeOpen(false);
  };

  const activateHighlight = () => {
    const alreadyActive = canvasContext.inkTool === 'highlight';
    canvasContext.setBrushType('highlighter');
    canvasContext.setInkTool('highlight');
    canvasContext.setLinePattern('solid');
    if (alreadyActive) {
      if (detailOpen && detailAnchor === 'highlighter') closeDetail();
      else openDetail('highlight', 'highlighter');
    } else {
      closeDetail();
    }
    workspaceContext.setPageListOpen(false);
  };

  const activateTool = (tool: InkTool) => {
    if (tool === 'highlight') {
      activateHighlight();
      return;
    }
    if (isShapeTool(tool)) {
      const alreadyActive = canvasContext.inkTool === tool || (isShapeTool(canvasContext.inkTool) && detailAnchor === 'shape');
      if (canvasContext.brushType === 'highlighter') canvasContext.setBrushType('ballpoint');
      canvasContext.setInkTool(tool);
      if (alreadyActive) {
        if (detailOpen && detailAnchor === 'shape') closeDetail();
        else openDetail('shape', 'shape');
      } else {
        closeDetail();
      }
      workspaceContext.setPageListOpen(false);
      return;
    }
    if (canvasContext.brushType === 'highlighter') canvasContext.setBrushType('ballpoint');
    canvasContext.setInkTool(tool);
    closeDetail();
    workspaceContext.setPageListOpen(false);
  };

  const quickMode = canvasContext.inkTool === 'highlight' ? 'highlight' : 'pen';
  const quickColors = quickMode === 'highlight' ? FAVORITE_HIGHLIGHT_COLORS : FAVORITE_PEN_COLORS;
  const widthRange = quickMode === 'highlight'
    ? { min: QUICK_HIGHLIGHT_WIDTHS[0], max: QUICK_HIGHLIGHT_WIDTHS[QUICK_HIGHLIGHT_WIDTHS.length - 1], step: 2 }
    : { min: QUICK_PEN_WIDTHS[0], max: QUICK_PEN_WIDTHS[QUICK_PEN_WIDTHS.length - 1], step: 1 };
  const detailBrush = detailMode === 'highlight' ? 'highlighter' : canvasContext.brushType === 'highlighter' || canvasContext.brushType === 'fountain' ? 'ballpoint' : canvasContext.brushType;
  const detailBaseColors = detailMode === 'highlight' ? FAVORITE_HIGHLIGHT_COLORS : FAVORITE_PEN_COLORS;
  const detailExtraColors = detailMode === 'highlight'
    ? HIGHLIGHT_COLORS.filter((color) => !FAVORITE_HIGHLIGHT_COLORS.includes(color))
    : PEN_COLORS.filter((color) => !FAVORITE_PEN_COLORS.includes(color));
  const detailColors = colorLibraryOpen ? [...detailBaseColors, ...detailExtraColors] : detailBaseColors;
  const detailWidths = detailMode === 'highlight' ? HIGHLIGHT_WIDTHS : PEN_WIDTHS;
  const detailWidthRange = { min: detailWidths[0], max: detailWidths[detailWidths.length - 1], step: detailMode === 'highlight' ? 2 : 1 };
  const detailTitle = detailMode === 'shape' ? '도형' : BRUSH_LABELS[detailBrush];
  const previewDashArray = canvasContext.linePattern === 'dotted'
    ? `${Math.max(1, canvasContext.penWidth * 0.45)} ${Math.max(8, canvasContext.penWidth * 2.3)}`
    : undefined;
  const previewStrokeWidth = detailMode === 'highlight'
    ? Math.min(26, Math.max(14, canvasContext.penWidth * 0.82))
    : detailBrush === 'marker'
      ? Math.min(24, Math.max(8, canvasContext.penWidth * 2.2))
      : detailBrush === 'pencil'
        ? Math.min(14, Math.max(3, canvasContext.penWidth * 1.25))
        : Math.min(18, Math.max(4, canvasContext.penWidth * 1.6));
  const previewOpacity = detailMode === 'highlight' ? 0.45 : detailBrush === 'pencil' ? 0.68 : 1;
  const activeIconColor = canvasContext.penColor.toLowerCase() === '#ffffff' ? '#2563EB' : canvasContext.penColor;

  const setPenWidth = (value: number) => {
    const bounds = canvasContext.inkTool === 'highlight'
      ? { min: HIGHLIGHT_WIDTHS[0], max: HIGHLIGHT_WIDTHS[HIGHLIGHT_WIDTHS.length - 1] }
      : { min: PEN_WIDTHS[0], max: PEN_WIDTHS[PEN_WIDTHS.length - 1] };
    canvasContext.setPenWidth(clamp(value, bounds.min, bounds.max));
  };

  const nudgePenWidth = (delta: number) => {
    const step = canvasContext.inkTool === 'highlight' ? 2 : 1;
    setPenWidth(canvasContext.penWidth + delta * step);
  };

  const renderDetailPopover = () => (
    <View style={workspaceContext.styles.fixedPenDetailPopover}>
      <View style={workspaceContext.styles.fixedPenDetailArrow} />
      <View style={workspaceContext.styles.penDetailHeader}>
        <Pressable onPress={() => {
          canvasContext.setPenColor(detailMode === 'highlight' ? '#FDE047' : '#111827');
          canvasContext.setPenWidth(detailMode === 'highlight' ? 16 : 3);
          if (detailMode !== 'shape') canvasContext.setBrushType(detailMode === 'highlight' ? 'highlighter' : 'ballpoint');
          canvasContext.setBrushSettings({ stability: 18, sharpness: 50, density: 100, pressure: 35 });
          canvasContext.setLinePattern('solid');
        }}>
          <Text style={workspaceContext.styles.penDetailLink}>리셋</Text>
        </Pressable>
        <Text style={workspaceContext.styles.penDetailTitle}>{detailTitle}</Text>
        <Pressable onPress={() => setAdvancedOpen((current) => !current)}>
          <Text style={workspaceContext.styles.penDetailLink}>고급</Text>
        </Pressable>
      </View>
      <ScrollView
        style={workspaceContext.styles.fixedPenDetailBody}
        contentContainerStyle={workspaceContext.styles.fixedPenDetailBodyContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        <View style={workspaceContext.styles.penDetailPreview}>
          <Svg width="100%" height="100%" viewBox="0 0 260 80">
            <Path
              d={PREVIEW_PATH}
              fill="none"
              stroke={canvasContext.penColor}
              strokeWidth={previewStrokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={previewDashArray}
              opacity={previewOpacity}
            />
          </Svg>
        </View>
        {detailMode === 'pen' ? (
        <View style={workspaceContext.styles.penDetailSection}>
          <View style={workspaceContext.styles.penDetailRowHeader}>
            <Text style={workspaceContext.styles.penDetailLabel}>펜 종류</Text>
            <Text style={workspaceContext.styles.penDetailValue}>{BRUSH_LABELS[detailBrush]}</Text>
          </View>
          <View style={workspaceContext.styles.fixedBrushChoiceRow}>
            {PEN_BRUSHES.map((preset) => {
              const active = canvasContext.brushType === preset.brush;
              return (
                <Pressable
                  key={preset.brush}
                  style={[workspaceContext.styles.fixedBrushChoice, active && workspaceContext.styles.fixedBrushChoiceActive]}
                  onPress={() => {
                    canvasContext.setBrushType(preset.brush);
                    setDetailAnchor(preset.brush);
                  }}
                >
                  <MaterialCommunityIcons name={preset.icon} size={18} color={active ? '#2563EB' : '#475569'} />
                  <Text style={[workspaceContext.styles.fixedBrushChoiceText, active && workspaceContext.styles.fixedBrushChoiceTextActive]}>{preset.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        ) : null}
        <View style={workspaceContext.styles.penDetailSection}>
          <View style={workspaceContext.styles.penDetailRowHeader}>
            <Text style={workspaceContext.styles.penDetailLabel}>굵기</Text>
            <Text style={workspaceContext.styles.penDetailValue}>{canvasContext.penWidth}</Text>
          </View>
          <View style={workspaceContext.styles.penDetailSliderRow}>
            <Pressable style={workspaceContext.styles.penDetailStepperButton} onPress={() => setPenWidth(canvasContext.penWidth - detailWidthRange.step)}>
              <MaterialCommunityIcons name="minus" size={14} color="#1684FF" />
            </Pressable>
            <InkSlider
              value={canvasContext.penWidth}
              min={detailWidthRange.min}
              max={detailWidthRange.max}
              step={detailWidthRange.step}
              accent={canvasContext.penColor.toLowerCase() === '#ffffff' ? '#2563EB' : canvasContext.penColor}
              onChange={setPenWidth}
            />
            <Pressable style={workspaceContext.styles.penDetailStepperButton} onPress={() => setPenWidth(canvasContext.penWidth + detailWidthRange.step)}>
              <MaterialCommunityIcons name="plus" size={14} color="#1684FF" />
            </Pressable>
          </View>
        </View>
        <View style={workspaceContext.styles.penDetailSection}>
          <View style={workspaceContext.styles.penDetailRowHeader}>
            <Text style={workspaceContext.styles.penDetailLabel}>선 스타일</Text>
            <View style={workspaceContext.styles.penDetailPatternPreviewPill}>
              <View style={[
                workspaceContext.styles.penDetailPatternLine,
                canvasContext.linePattern === 'dotted' && workspaceContext.styles.penDetailPatternLineDotted,
              ]} />
            </View>
          </View>
          <View style={workspaceContext.styles.penDetailPatternRow}>
            {LINE_PATTERNS.map((item) => (
              <Pressable
                key={item.pattern}
                style={[workspaceContext.styles.penDetailPatternButton, canvasContext.linePattern === item.pattern && workspaceContext.styles.penDetailPatternButtonActive]}
                onPress={() => canvasContext.setLinePattern(item.pattern)}
              >
                <View style={[
                  workspaceContext.styles.penDetailPatternLine,
                  item.pattern === 'dotted' && workspaceContext.styles.penDetailPatternLineDotted,
                ]} />
              </Pressable>
            ))}
          </View>
        </View>
        {advancedOpen ? (
          <View style={workspaceContext.styles.penDetailSection}>
            {ADVANCED_CONTROLS.map((control) => {
              const value = canvasContext.brushSettings[control.key];
              return (
                <View key={control.key} style={workspaceContext.styles.penDetailAdvancedRow}>
                  <View style={workspaceContext.styles.penDetailRowHeader}>
                    <Text style={workspaceContext.styles.penDetailLabel}>{control.label}</Text>
                    <Text style={workspaceContext.styles.penDetailValue}>{Math.round(value)}%</Text>
                  </View>
                  <View style={workspaceContext.styles.penDetailSliderRow}>
                    <Pressable style={workspaceContext.styles.penDetailStepperButton} onPress={() => setBrushSetting(control.key, value - 10)}>
                      <MaterialCommunityIcons name="minus" size={14} color="#1684FF" />
                    </Pressable>
                    <InkSlider value={value} min={0} max={100} step={5} onChange={(next) => setBrushSetting(control.key, next)} />
                    <Pressable style={workspaceContext.styles.penDetailStepperButton} onPress={() => setBrushSetting(control.key, value + 10)}>
                      <MaterialCommunityIcons name="plus" size={14} color="#1684FF" />
                    </Pressable>
                  </View>
                  {control.hint ? <Text style={workspaceContext.styles.penDetailHelperText}>{control.hint}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}
        <View style={workspaceContext.styles.penDetailSection}>
          <View style={workspaceContext.styles.penDetailColorHeader}>
            <Text style={workspaceContext.styles.penDetailLabel}>색상</Text>
          </View>
          <View style={workspaceContext.styles.penDetailColorGrid}>
            {detailColors.map((color) => (
              <Pressable
                key={color}
                style={[
                  workspaceContext.styles.penDetailColorButton,
                  canvasContext.penColor.toLowerCase() === color.toLowerCase() && workspaceContext.styles.penDetailColorButtonActive,
                ]}
                onPress={() => canvasContext.setPenColor(color)}
              >
                <View style={[workspaceContext.styles.penDetailColorDot, { backgroundColor: color }]} />
              </Pressable>
            ))}
            <Pressable
              style={workspaceContext.styles.penDetailColorButton}
              onPress={() => setColorLibraryOpen((current) => !current)}
            >
              <MaterialCommunityIcons
                name={colorLibraryOpen ? 'minus' : 'plus'}
                size={20}
                color="#475569"
              />
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );

  const renderToolButton = (
    key: string,
    tool: InkTool,
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'],
  ) => {
    const active = canvasContext.inkTool === tool || (tool === 'line' && isShapeTool(canvasContext.inkTool));
    return (
      <View key={key} style={workspaceContext.styles.fixedInkToolAnchor}>
        <Pressable
          style={[workspaceContext.styles.fixedInkToolButton, active && workspaceContext.styles.fixedInkToolButtonActive]}
          onPress={() => activateTool(tool)}
        >
          <MaterialCommunityIcons name={icon} size={20} color={active ? '#2563EB' : '#334155'} />
        </Pressable>
        {tool === 'line' && detailOpen && detailAnchor === 'shape' ? (
          <View style={workspaceContext.styles.fixedShapeShelf}>
            {SHAPE_TOOLS.map((item) => (
              <Pressable
                key={item.tool}
                style={[workspaceContext.styles.fixedInkToolButton, canvasContext.inkTool === item.tool && workspaceContext.styles.fixedInkToolButtonActive]}
                onPress={() => activateTool(item.tool)}
              >
                <MaterialCommunityIcons name={item.icon} size={18} color={canvasContext.inkTool === item.tool ? '#2563EB' : '#334155'} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const highlightActive = canvasContext.inkTool === 'highlight';
  const activePenBrush = canvasContext.brushType === 'highlighter' || canvasContext.brushType === 'fountain' ? 'ballpoint' : canvasContext.brushType;
  const activePenPreset = PEN_BRUSHES.find((preset) => preset.brush === activePenBrush) ?? PEN_BRUSHES[0];
  const penActive = canvasContext.inkTool === 'pen';

  return (
    <View pointerEvents="box-none" style={workspaceContext.styles.fixedInkToolbarWrap}>
      {detailOpen || selectionModeOpen ? <Pressable style={workspaceContext.styles.fixedInkDismissLayer} onPress={() => {
        closeDetail();
        setSelectionModeOpen(false);
      }} /> : null}
      <View style={workspaceContext.styles.fixedInkToolbar}>
        <View style={workspaceContext.styles.fixedInkToolbarContent}>
          <View style={workspaceContext.styles.fixedInkToolAnchor}>
            <Pressable
              style={[workspaceContext.styles.fixedInkToolButton, penActive && workspaceContext.styles.fixedInkToolButtonActive]}
              onPress={activatePrimaryPen}
            >
              <MaterialCommunityIcons name={activePenPreset.icon} size={20} color={penActive ? activeIconColor : '#334155'} />
              {penActive ? <View style={[workspaceContext.styles.fixedInkToolColorBadge, { backgroundColor: canvasContext.penColor }]} /> : null}
            </Pressable>
            {detailOpen && detailMode === 'pen' ? renderDetailPopover() : null}
          </View>
          <View style={workspaceContext.styles.fixedInkToolAnchor}>
            <Pressable
              style={[workspaceContext.styles.fixedInkToolButton, highlightActive && workspaceContext.styles.fixedInkToolButtonActive]}
              onPress={activateHighlight}
            >
              <MaterialCommunityIcons name="format-color-highlight" size={20} color={highlightActive ? activeIconColor : '#334155'} />
              {highlightActive ? <View style={[workspaceContext.styles.fixedInkToolColorBadge, { backgroundColor: canvasContext.penColor }]} /> : null}
            </Pressable>
            {detailOpen && detailAnchor === 'highlighter' ? renderDetailPopover() : null}
          </View>
          {renderToolButton('erase', 'erase', 'eraser-variant')}
          <View style={workspaceContext.styles.fixedInkToolAnchor}>
            <Pressable
              style={[workspaceContext.styles.fixedInkToolButton, canvasContext.inkTool === 'select' && workspaceContext.styles.fixedInkToolButtonActive]}
              onPress={activateSelectionTool}
            >
              <MaterialCommunityIcons name={canvasContext.selectionMode === 'lasso' ? 'lasso' : 'selection-drag'} size={20} color={canvasContext.inkTool === 'select' ? '#2563EB' : '#334155'} />
            </Pressable>
            {selectionModeOpen ? (
              <View style={workspaceContext.styles.fixedSelectionModePopover}>
                {SELECTION_MODES.map((item) => {
                  const active = canvasContext.selectionMode === item.mode;
                  return (
                    <Pressable
                      key={item.mode}
                      style={[workspaceContext.styles.selectionModeChoice, active && workspaceContext.styles.selectionModeChoiceActive]}
                      onPress={() => chooseSelectionMode(item.mode)}
                    >
                      <MaterialCommunityIcons name={item.icon} size={18} color={active ? '#2563EB' : '#475569'} />
                      <Text style={[workspaceContext.styles.selectionModeChoiceText, active && workspaceContext.styles.selectionModeChoiceTextActive]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
          {renderToolButton('text', 'text', 'format-textbox')}
          {renderToolButton('shape', 'line', 'shape-outline')}

          <View style={workspaceContext.styles.fixedInkToolbarDivider} />
          <View style={workspaceContext.styles.fixedInkWidthControl}>
            <Pressable style={workspaceContext.styles.fixedInkWidthNudge} onPress={() => nudgePenWidth(-1)}>
              <MaterialCommunityIcons name="minus" size={13} color="#5B6474" />
            </Pressable>
            <Pressable style={workspaceContext.styles.fixedInkWidthPreview} onPress={() => openDetail(quickMode, quickMode === 'highlight' ? 'highlighter' : detailBrush)}>
              <View style={[workspaceContext.styles.fixedInkWidthLine, { height: Math.max(2, Math.min(8, canvasContext.penWidth / 2.2)) }]} />
              <Text style={workspaceContext.styles.fixedInkWidthValue}>{canvasContext.penWidth}</Text>
            </Pressable>
            <Pressable style={workspaceContext.styles.fixedInkWidthNudge} onPress={() => nudgePenWidth(1)}>
              <MaterialCommunityIcons name="plus" size={13} color="#5B6474" />
            </Pressable>
          </View>
          <View style={workspaceContext.styles.fixedInkColorStrip}>
            {quickColors.slice(0, 3).map((color) => (
              <Pressable
                key={color}
                style={[
                  workspaceContext.styles.fixedInkColorButton,
                  canvasContext.penColor.toLowerCase() === color.toLowerCase() && workspaceContext.styles.fixedInkColorButtonActive,
                ]}
                onPress={() => canvasContext.setPenColor(color)}
              >
                <View style={[workspaceContext.styles.fixedInkColorDot, { backgroundColor: color }]} />
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {canvasContext.selectionRect ? (
        <View style={workspaceContext.styles.fixedSelectionShelf}>
          <View style={workspaceContext.styles.selectionActionHeader}>
            <View>
              <Text style={workspaceContext.styles.selectionActionTitle}>선택 영역</Text>
              <Text style={workspaceContext.styles.selectionActionMeta}>
                {canvasContext.selectionRect.mode === 'lasso' ? '올가미 선택' : '네모 선택'}
              </Text>
            </View>
            <Pressable style={workspaceContext.styles.floatingSelectionButton} onPress={canvasContext.clearCurrentSelection}>
              <MaterialCommunityIcons name="close" size={16} color="#64748B" />
            </Pressable>
          </View>
          <View style={workspaceContext.styles.selectionActionRow}>
            <Pressable
              style={[workspaceContext.styles.selectionActionButton, workspaceContext.styles.selectionActionPrimary]}
              onPress={workspaceContext.onAskAiAboutSelection}
            >
              <MaterialCommunityIcons name="star-four-points" size={15} color="#FFFFFF" />
              <Text style={workspaceContext.styles.selectionActionPrimaryText}>AI</Text>
            </Pressable>
            <Pressable style={workspaceContext.styles.selectionActionButton} onPress={canvasContext.duplicateSelectedStrokes}>
              <MaterialCommunityIcons name="content-copy" size={15} color="#455062" />
              <Text style={workspaceContext.styles.selectionActionButtonText}>복제</Text>
            </Pressable>
            <Pressable
              style={[workspaceContext.styles.selectionActionButton, workspaceContext.styles.selectionActionDanger]}
              onPress={canvasContext.deleteSelectedStrokes}
            >
              <MaterialCommunityIcons name="delete-outline" size={15} color="#DC2626" />
              <Text style={workspaceContext.styles.selectionActionDangerText}>삭제</Text>
            </Pressable>
          </View>
          <View style={workspaceContext.styles.selectionActionColors}>
            {PEN_COLORS.slice(0, 5).map((color) => (
              <Pressable
                key={color}
                style={workspaceContext.styles.floatingSelectionColorButton}
                onPress={() => canvasContext.changeSelectedStrokesColor(color)}
              >
                <View style={[workspaceContext.styles.floatingSelectionColorDot, { backgroundColor: color }]} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
