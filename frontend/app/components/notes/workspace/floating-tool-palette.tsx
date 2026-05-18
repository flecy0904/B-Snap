import React from 'react';
import { Animated, PanResponder, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import type { InkBrush, InkBrushSettings, InkTool } from '../../../ui-types';
import { useCanvasContext } from '../canvas/canvas-context';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';

const SHAPE_TOOLS: Array<{ tool: InkTool; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }> = [
  { tool: 'line', icon: 'vector-line' },
  { tool: 'arrow', icon: 'arrow-top-right' },
  { tool: 'rect', icon: 'rectangle-outline' },
  { tool: 'ellipse', icon: 'circle-outline' },
];

const PEN_COLORS = ['#111827', '#E11D48', '#2563EB', '#FFFFFF', '#9FD1EE', '#F5AFC8', '#8DBA98', '#C4B5FD'];
const HIGHLIGHT_COLORS = ['#FDE047', '#FB7185', '#86EFAC', '#67E8F9', '#FDBA74', '#C4B5FD'];
const PEN_WIDTHS = [2, 3, 4, 6, 8, 10];
const HIGHLIGHT_WIDTHS = [10, 12, 16, 20, 24, 30];
const BRUSH_LABELS: Record<InkBrush, string> = {
  ballpoint: '볼펜',
  fountain: '플로우 펜',
  pencil: '연필',
  marker: '마커',
  highlighter: '형광펜',
};
const LINE_PATTERN_LABELS = {
  solid: '실선',
  dotted: '점선',
  dashed: '파선',
} as const;
const ADVANCED_CONTROLS: Array<{ key: keyof InkBrushSettings; label: string }> = [
  { key: 'stability', label: '안정성' },
  { key: 'sharpness', label: '날카로움' },
  { key: 'pressure', label: '압력 민감도' },
  { key: 'density', label: '농도' },
];
const TOP_DOCK_Y = 12;
const TOP_DOCK_THRESHOLD = 72;
const TOP_DOCK_RIGHT_GAP = 360;
const PREVIEW_PATH = 'M 22 50 C 72 18 116 22 154 50 S 218 58 238 28';

function getDefaultPalettePosition(width: number) {
  const maxDockedX = Math.max(10, width - TOP_DOCK_RIGHT_GAP);
  return {
    x: Math.max(10, Math.min(maxDockedX, Math.round(width * 0.68))),
    y: TOP_DOCK_Y,
  };
}

export function FloatingToolPalette() {
  const workspaceContext = useDesktopNotesWorkspaceContext();
  const canvasContext = useCanvasContext();
  const { width, height } = useWindowDimensions();
  const [expanded, setExpanded] = React.useState<'pen' | 'highlight' | 'shape' | 'select' | null>('pen');
  const [collapsed, setCollapsed] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const defaultPosition = React.useMemo(() => getDefaultPalettePosition(width), [width]);
  const [position, setPosition] = React.useState(defaultPosition);
  const startPositionRef = React.useRef(position);
  const topDocked = position.y <= TOP_DOCK_THRESHOLD;
  const sideDocked = !topDocked && (position.x <= 24 || position.x >= width - 84);

  React.useEffect(() => {
    startPositionRef.current = position;
  }, [position]);

  React.useEffect(() => {
    setPosition(defaultPosition);
    setExpanded('pen');
    setCollapsed(false);
    setDetailOpen(false);
    setAdvancedOpen(false);
  }, [defaultPosition, workspaceContext.studyDocumentId]);

  const closeDetail = React.useCallback(() => {
    setDetailOpen(false);
    setAdvancedOpen(false);
  }, []);

  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => {
      startPositionRef.current = position;
    },
    onPanResponderMove: (_, gesture) => {
      const nextX = Math.max(4, Math.min(width - 54, startPositionRef.current.x + gesture.dx));
      const nextY = Math.max(8, Math.min(height - 72, startPositionRef.current.y + gesture.dy));
      setPosition({ x: nextX, y: nextY });
    },
    onPanResponderRelease: (_, gesture) => {
      const releasedX = startPositionRef.current.x + gesture.dx;
      const releasedY = startPositionRef.current.y + gesture.dy;
      if (releasedY < TOP_DOCK_THRESHOLD) {
        setPosition({ x: Math.max(10, Math.min(Math.max(10, width - TOP_DOCK_RIGHT_GAP), releasedX)), y: TOP_DOCK_Y });
        return;
      }
      if (releasedX < width * 0.16) {
        setPosition({ x: 10, y: Math.max(92, Math.min(height - 320, releasedY)) });
        return;
      }
      if (releasedX > width * 0.78) {
        setPosition({ x: Math.max(8, width - 58), y: Math.max(92, Math.min(height - 320, releasedY)) });
        return;
      }
      setPosition({
        x: Math.max(4, Math.min(width - 54, releasedX)),
        y: Math.max(8, Math.min(height - 72, releasedY)),
      });
    },
  }), [height, position, width]);

  const activateTool = (tool: InkTool, nextExpanded: typeof expanded = null) => {
    const alreadyActiveTool = canvasContext.inkTool === tool && expanded === nextExpanded;
    const switchingTool = canvasContext.inkTool !== tool;
    if (switchingTool && tool === 'highlight') {
      canvasContext.setBrushType('highlighter');
      if (!HIGHLIGHT_WIDTHS.includes(canvasContext.penWidth)) canvasContext.setPenWidth(16);
      canvasContext.setLinePattern('solid');
    }
    if (switchingTool && tool === 'pen' && canvasContext.brushType === 'highlighter') {
      canvasContext.setBrushType('ballpoint');
      if (!PEN_WIDTHS.includes(canvasContext.penWidth)) canvasContext.setPenWidth(3);
    }
    canvasContext.setInkTool(tool);
    setExpanded(nextExpanded);
    setDetailOpen(Boolean(nextExpanded && alreadyActiveTool));
    if (!nextExpanded || !alreadyActiveTool) setAdvancedOpen(false);
    workspaceContext.setPageListOpen(false);
  };

  const renderToolButton = (
    key: string,
    tool: InkTool,
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'],
    nextExpanded: typeof expanded = null,
  ) => {
    const active = canvasContext.inkTool === tool || expanded === nextExpanded;
    return (
      <Pressable
        key={key}
        style={[workspaceContext.styles.floatingToolButton, active && workspaceContext.styles.floatingToolButtonActive]}
        onPress={() => activateTool(tool, nextExpanded)}
      >
        <MaterialCommunityIcons name={icon} size={20} color={active ? '#2563EB' : '#283241'} />
      </Pressable>
    );
  };

  const detailMode = expanded === 'highlight' ? 'highlight' : expanded === 'shape' ? 'shape' : 'pen';
  const detailBrush = detailMode === 'highlight' ? 'highlighter' : canvasContext.brushType;
  const detailColors = detailMode === 'highlight' ? HIGHLIGHT_COLORS : PEN_COLORS;
  const detailWidths = detailMode === 'highlight' ? HIGHLIGHT_WIDTHS : PEN_WIDTHS;
  const detailTitle = detailMode === 'shape' ? '도형' : BRUSH_LABELS[detailBrush];
  const previewDashArray = canvasContext.linePattern === 'dotted'
    ? `${Math.max(1, canvasContext.penWidth * 0.45)} ${Math.max(8, canvasContext.penWidth * 2.3)}`
    : canvasContext.linePattern === 'dashed'
      ? `${Math.max(10, canvasContext.penWidth * 3.2)} ${Math.max(7, canvasContext.penWidth * 2)}`
      : undefined;
  const previewStrokeWidth = detailMode === 'highlight'
    ? Math.min(26, Math.max(14, canvasContext.penWidth * 0.82))
    : detailBrush === 'marker'
      ? Math.min(24, Math.max(8, canvasContext.penWidth * 2.2))
      : Math.min(18, Math.max(4, canvasContext.penWidth * 1.6));
  const previewOpacity = detailMode === 'highlight' ? 0.45 : detailBrush === 'pencil' ? 0.72 : 1;
  const setBrushSetting = (key: keyof InkBrushSettings, value: number) => {
    canvasContext.setBrushSettings({ [key]: Math.max(0, Math.min(100, value)) });
  };
  const collapseIcon = topDocked
    ? (collapsed ? 'chevron-down' : 'chevron-up')
    : sideDocked
      ? (collapsed ? 'chevron-down' : 'chevron-up')
      : (collapsed ? 'chevron-right' : 'chevron-left');

  return (
    <>
      {detailOpen ? (
        <Pressable
          pointerEvents="auto"
          style={workspaceContext.styles.floatingToolDismissLayer}
          onPress={closeDetail}
        />
      ) : null}
      <Animated.View
        pointerEvents="box-none"
        style={[
          workspaceContext.styles.floatingToolPaletteWrap,
          topDocked && workspaceContext.styles.floatingToolPaletteWrapTop,
          sideDocked && workspaceContext.styles.floatingToolPaletteWrapSide,
          {
            left: position.x,
            top: position.y,
          },
        ]}
      >
      <View style={[
        workspaceContext.styles.floatingToolPalette,
        topDocked && workspaceContext.styles.floatingToolPaletteTop,
      ]}>
        <View {...panResponder.panHandlers} style={workspaceContext.styles.floatingToolDragHandle}>
          <MaterialCommunityIcons name="drag-horizontal-variant" size={18} color="#7E8798" />
        </View>
        <Pressable
          style={[workspaceContext.styles.floatingToolButton, collapsed && workspaceContext.styles.floatingToolButtonActive]}
          onPress={() => {
            setCollapsed((current) => !current);
            closeDetail();
          }}
        >
          <MaterialCommunityIcons name={collapseIcon} size={20} color={collapsed ? '#2563EB' : '#283241'} />
        </Pressable>
        <Pressable
          style={[workspaceContext.styles.floatingToolButton, workspaceContext.fingerDrawingEnabled && workspaceContext.styles.floatingToolButtonActive]}
          onPress={() => {
            workspaceContext.onToggleFingerDrawing();
            closeDetail();
          }}
        >
          <MaterialCommunityIcons name="gesture-tap" size={20} color={workspaceContext.fingerDrawingEnabled ? '#2563EB' : '#283241'} />
        </Pressable>
        {!collapsed ? (
          <>
            {renderToolButton('view', 'view', 'cursor-default-outline')}
            {renderToolButton('pen', 'pen', 'pencil-outline', 'pen')}
            {renderToolButton('highlight', 'highlight', 'marker', 'highlight')}
            {renderToolButton('erase', 'erase', 'eraser-variant')}
            {renderToolButton('select', 'select', 'selection-drag', 'select')}
            {renderToolButton('text', 'text', 'format-textbox')}
            {renderToolButton('shape', 'line', 'shape-outline', 'shape')}
          </>
        ) : null}
      </View>

      {!collapsed && expanded === 'shape' ? (
        <View style={[
          workspaceContext.styles.floatingToolShelfCompact,
          sideDocked && workspaceContext.styles.floatingToolShelfCompactSide,
        ]}>
          {SHAPE_TOOLS.map((item) => (
            <Pressable
              key={item.tool}
              style={[workspaceContext.styles.floatingToolSmallButton, canvasContext.inkTool === item.tool && workspaceContext.styles.floatingToolPresetActive]}
              onPress={() => activateTool(item.tool, 'shape')}
            >
              <MaterialCommunityIcons name={item.icon} size={18} color={canvasContext.inkTool === item.tool ? '#2563EB' : '#283241'} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {!collapsed && detailOpen && (expanded === 'pen' || expanded === 'highlight' || expanded === 'shape') ? (
        <View style={[
          workspaceContext.styles.penDetailPopover,
          sideDocked && workspaceContext.styles.penDetailPopoverSide,
        ]}>
          <View style={workspaceContext.styles.penDetailArrow} />
          <View style={workspaceContext.styles.penDetailHeader}>
            <Pressable onPress={() => {
              canvasContext.setPenColor(detailMode === 'highlight' ? '#FDE047' : '#111827');
              canvasContext.setPenWidth(detailMode === 'highlight' ? 16 : 3);
              if (detailMode !== 'shape') canvasContext.setBrushType(detailMode === 'highlight' ? 'highlighter' : 'ballpoint');
              canvasContext.setLinePattern('solid');
            }}>
              <Text style={workspaceContext.styles.penDetailLink}>리셋</Text>
            </Pressable>
            <Text style={workspaceContext.styles.penDetailTitle}>{detailTitle}</Text>
            <Pressable onPress={() => setAdvancedOpen((current) => !current)}>
              <Text style={workspaceContext.styles.penDetailLink}>고급</Text>
            </Pressable>
          </View>
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
          <View style={workspaceContext.styles.penDetailSection}>
            <View style={workspaceContext.styles.penDetailRowHeader}>
              <Text style={workspaceContext.styles.penDetailLabel}>굵기</Text>
              <Text style={workspaceContext.styles.penDetailValue}>{canvasContext.penWidth}</Text>
            </View>
            <View style={workspaceContext.styles.penDetailChoiceRow}>
              {detailWidths.map((size) => (
                <Pressable
                  key={size}
                  style={[workspaceContext.styles.penDetailSizeChoice, canvasContext.penWidth === size && workspaceContext.styles.penDetailSizeChoiceActive]}
                  onPress={() => canvasContext.setPenWidth(size)}
                >
                  <View style={[workspaceContext.styles.penDetailSizeDot, { width: Math.max(5, size), height: Math.max(5, size), borderRadius: 99 }]} />
                </Pressable>
              ))}
            </View>
          </View>
          <View style={workspaceContext.styles.penDetailSection}>
            <View style={workspaceContext.styles.penDetailRowHeader}>
              <Text style={workspaceContext.styles.penDetailLabel}>선 스타일</Text>
              <Text style={workspaceContext.styles.penDetailValue}>{LINE_PATTERN_LABELS[canvasContext.linePattern]}</Text>
            </View>
            <View style={workspaceContext.styles.penDetailPatternRow}>
              {['solid', 'dotted', 'dashed'].map((pattern) => (
                <Pressable
                  key={pattern}
                  style={[workspaceContext.styles.penDetailPatternButton, canvasContext.linePattern === pattern && workspaceContext.styles.penDetailPatternButtonActive]}
                  onPress={() => canvasContext.setLinePattern(pattern as 'solid' | 'dotted' | 'dashed')}
                >
                  <View style={[
                    workspaceContext.styles.penDetailPatternLine,
                    pattern === 'dotted' && workspaceContext.styles.penDetailPatternLineDotted,
                    pattern === 'dashed' && workspaceContext.styles.penDetailPatternLineDashed,
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
                      <Pressable style={workspaceContext.styles.penDetailSliderTrack} onPress={() => setBrushSetting(control.key, value + 10)}>
                        <View style={[workspaceContext.styles.penDetailSliderFill, { width: `${Math.max(4, Math.min(100, value))}%` }]} />
                      </Pressable>
                      <Pressable style={workspaceContext.styles.penDetailStepperButton} onPress={() => setBrushSetting(control.key, value + 10)}>
                        <MaterialCommunityIcons name="plus" size={14} color="#1684FF" />
                      </Pressable>
                    </View>
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
            </View>
          </View>
          <Pressable style={workspaceContext.styles.penDetailDoneButton} onPress={closeDetail}>
            <MaterialCommunityIcons name="check-circle-outline" size={16} color="#2563EB" />
            <Text style={workspaceContext.styles.penDetailDoneText}>완료</Text>
          </Pressable>
        </View>
      ) : null}

      {!collapsed && expanded === 'select' && canvasContext.selectionRect ? (
        <View style={[
          workspaceContext.styles.floatingSelectionShelf,
          sideDocked && workspaceContext.styles.floatingSelectionShelfSide,
        ]}>
          <View style={workspaceContext.styles.floatingSelectionColorRow}>
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
          <Pressable style={workspaceContext.styles.floatingSelectionButton} onPress={canvasContext.duplicateSelectedStrokes}>
            <MaterialCommunityIcons name="content-copy" size={16} color="#455062" />
          </Pressable>
          <Pressable style={workspaceContext.styles.floatingSelectionButton} onPress={() => canvasContext.resizeSelectedStrokes(0.9)}>
            <MaterialCommunityIcons name="magnify-minus-outline" size={16} color="#455062" />
          </Pressable>
          <Pressable style={workspaceContext.styles.floatingSelectionButton} onPress={() => canvasContext.resizeSelectedStrokes(1.1)}>
            <MaterialCommunityIcons name="magnify-plus-outline" size={16} color="#455062" />
          </Pressable>
          <Pressable style={workspaceContext.styles.floatingSelectionButton} onPress={() => canvasContext.nudgeSelectedStrokes(0, -18)}>
            <MaterialCommunityIcons name="arrow-up" size={16} color="#455062" />
          </Pressable>
          <Pressable style={workspaceContext.styles.floatingSelectionButton} onPress={() => canvasContext.nudgeSelectedStrokes(-18, 0)}>
            <MaterialCommunityIcons name="arrow-left" size={16} color="#455062" />
          </Pressable>
          <Pressable style={workspaceContext.styles.floatingSelectionButton} onPress={() => canvasContext.nudgeSelectedStrokes(18, 0)}>
            <MaterialCommunityIcons name="arrow-right" size={16} color="#455062" />
          </Pressable>
          <Pressable style={workspaceContext.styles.floatingSelectionButton} onPress={() => canvasContext.nudgeSelectedStrokes(0, 18)}>
            <MaterialCommunityIcons name="arrow-down" size={16} color="#455062" />
          </Pressable>
          <Pressable style={[workspaceContext.styles.floatingSelectionButton, workspaceContext.styles.floatingSelectionButtonDanger]} onPress={canvasContext.deleteSelectedStrokes}>
            <MaterialCommunityIcons name="delete-outline" size={16} color="#DC2626" />
          </Pressable>
        </View>
      ) : null}
      </Animated.View>
    </>
  );
}
