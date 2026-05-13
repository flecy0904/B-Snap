import React from 'react';
import { Animated, PanResponder, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { InkTool } from '../../../ui-types';
import { useCanvasContext } from '../canvas/canvas-context';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';

type ToolPreset = {
  id: string;
  label: string;
  tool: InkTool;
  color: string;
  width: number;
  kind: 'pen' | 'highlight';
};

const PEN_PRESETS: ToolPreset[] = [
  { id: 'pen-black', label: 'Black', tool: 'pen', color: '#111827', width: 3, kind: 'pen' },
  { id: 'pen-gray', label: 'Gray', tool: 'pen', color: '#4B5563', width: 3, kind: 'pen' },
  { id: 'pen-red', label: 'Red', tool: 'pen', color: '#E11D48', width: 3, kind: 'pen' },
  { id: 'pen-blue', label: 'Blue', tool: 'pen', color: '#2563EB', width: 3, kind: 'pen' },
  { id: 'pen-green', label: 'Green', tool: 'pen', color: '#16A34A', width: 3, kind: 'pen' },
];

const HIGHLIGHT_PRESETS: ToolPreset[] = [
  { id: 'highlight-yellow', label: 'Yellow', tool: 'highlight', color: '#FDE047', width: 16, kind: 'highlight' },
  { id: 'highlight-pink', label: 'Pink', tool: 'highlight', color: '#FB7185', width: 16, kind: 'highlight' },
  { id: 'highlight-green', label: 'Green', tool: 'highlight', color: '#86EFAC', width: 16, kind: 'highlight' },
  { id: 'highlight-blue', label: 'Blue', tool: 'highlight', color: '#60A5FA', width: 16, kind: 'highlight' },
  { id: 'highlight-orange', label: 'Orange', tool: 'highlight', color: '#FDBA74', width: 16, kind: 'highlight' },
];

const SHAPE_TOOLS: Array<{ tool: InkTool; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }> = [
  { tool: 'line', icon: 'vector-line' },
  { tool: 'arrow', icon: 'arrow-top-right' },
  { tool: 'rect', icon: 'rectangle-outline' },
  { tool: 'ellipse', icon: 'circle-outline' },
];

function ToolImage(props: { preset: ToolPreset; active: boolean }) {
  const isHighlight = props.preset.kind === 'highlight';

  return (
    <View style={{ width: 38, height: 38, borderRadius: 99, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 99,
          backgroundColor: props.preset.color,
          borderWidth: props.active ? 2 : 1,
          borderColor: props.active ? '#2563EB' : '#FFFFFF',
          opacity: isHighlight ? 0.78 : 1,
          shadowColor: '#64748B',
          shadowOpacity: 0.18,
          shadowRadius: 5,
          shadowOffset: { width: 0, height: 2 },
        }}
      />
    </View>
  );
}

export function FloatingToolPalette() {
  const workspaceContext = useDesktopNotesWorkspaceContext();
  const canvasContext = useCanvasContext();
  const { width, height } = useWindowDimensions();
  const [expanded, setExpanded] = React.useState<'pen' | 'highlight' | 'shape' | 'select' | null>('pen');
  const [collapsed, setCollapsed] = React.useState(false);
  const [position, setPosition] = React.useState({ x: 190, y: 96 });
  const startPositionRef = React.useRef(position);

  React.useEffect(() => {
    startPositionRef.current = position;
  }, [position]);

  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => {
      startPositionRef.current = position;
    },
    onPanResponderMove: (_, gesture) => {
      const nextX = Math.max(4, Math.min(width - 58, startPositionRef.current.x + gesture.dx));
      const nextY = Math.max(8, Math.min(height - 72, startPositionRef.current.y + gesture.dy));
      setPosition({ x: nextX, y: nextY });
    },
    onPanResponderRelease: (_, gesture) => {
      const releasedX = startPositionRef.current.x + gesture.dx;
      const releasedY = startPositionRef.current.y + gesture.dy;
      if (releasedY < 80) {
        setPosition({ x: Math.max(6, Math.min(width - 280, releasedX)), y: 10 });
        return;
      }
      if (releasedX < width * 0.16) {
        setPosition({ x: 10, y: Math.max(84, Math.min(height - 190, releasedY)) });
        return;
      }
      if (releasedX > width * 0.78) {
        setPosition({ x: Math.max(8, width - 58), y: Math.max(84, Math.min(height - 190, releasedY)) });
        return;
      }
      setPosition({
        x: Math.max(4, Math.min(width - 58, releasedX)),
        y: Math.max(8, Math.min(height - 72, releasedY)),
      });
    },
  }), [height, position, width]);

  const activatePreset = (preset: ToolPreset) => {
    canvasContext.setInkTool(preset.tool);
    canvasContext.setPenColor(preset.color);
    canvasContext.setPenWidth(preset.width);
    setExpanded(preset.kind);
    workspaceContext.setPageListOpen(false);
  };

  const activateTool = (tool: InkTool, nextExpanded: typeof expanded = null) => {
    canvasContext.setInkTool(tool);
    setExpanded(nextExpanded);
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

  const presetList = expanded === 'highlight' ? HIGHLIGHT_PRESETS : PEN_PRESETS;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        workspaceContext.styles.floatingToolPaletteWrap,
        {
          left: position.x,
          top: position.y,
        },
      ]}
    >
      <View style={workspaceContext.styles.floatingToolPalette}>
        <View {...panResponder.panHandlers} style={workspaceContext.styles.floatingToolDragHandle}>
          <MaterialCommunityIcons name="drag-horizontal-variant" size={18} color="#7E8798" />
        </View>
        <Pressable
          style={[workspaceContext.styles.floatingToolButton, collapsed && workspaceContext.styles.floatingToolButtonActive]}
          onPress={() => setCollapsed((current) => !current)}
        >
          <MaterialCommunityIcons name={collapsed ? 'chevron-right' : 'chevron-left'} size={20} color={collapsed ? '#2563EB' : '#283241'} />
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

      {!collapsed && (expanded === 'pen' || expanded === 'highlight') ? (
        <View style={workspaceContext.styles.floatingToolShelf}>
          {presetList.map((preset) => {
            const active = canvasContext.inkTool === preset.tool && canvasContext.penColor === preset.color && canvasContext.penWidth === preset.width;
            return (
              <Pressable
                key={preset.id}
                style={[workspaceContext.styles.floatingToolPreset, active && workspaceContext.styles.floatingToolPresetActive]}
                onPress={() => activatePreset(preset)}
              >
                <ToolImage preset={preset} active={active} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {!collapsed && expanded === 'shape' ? (
        <View style={workspaceContext.styles.floatingToolShelfCompact}>
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

      {!collapsed && expanded === 'select' && canvasContext.selectionRect ? (
        <View style={workspaceContext.styles.floatingSelectionShelf}>
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
  );
}
