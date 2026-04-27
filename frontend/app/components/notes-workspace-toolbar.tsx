import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { InkTool } from '../ui-types';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';
import { DocumentPageView } from '../types';
import { getDocumentPageLabel, isSameDocumentPage } from '../ui-helpers';

const PRIMARY_TOOLS: Array<{
  value: InkTool;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}> = [
  { value: 'view', icon: 'cursor-default-outline' },
  { value: 'pen', icon: 'pencil-outline' },
  { value: 'highlight', icon: 'marker' },
  { value: 'erase', icon: 'eraser-variant' },
  { value: 'select', icon: 'selection-drag' },
];

const PEN_COLORS = ['#1F2937', '#2563EB', '#7C3AED', '#D9485F', '#F59E0B', '#16A34A'];
const HIGHLIGHT_COLORS = ['#FDE047', '#FB7185', '#86EFAC', '#67E8F9', '#FDBA74'];
const PEN_WIDTHS = [2, 3, 4, 6, 8, 10];
const HIGHLIGHT_WIDTHS = [10, 12, 14, 18, 22, 26];

type BrushTool = 'pen' | 'highlight';

function BrushPopover(props: {
  tool: BrushTool;
  styles: any;
  penColor: string;
  penWidth: number;
  onSelectColor: (tool: BrushTool, color: string) => void;
  onSelectWidth: (tool: BrushTool, width: number) => void;
}) {
  const widths = props.tool === 'highlight' ? HIGHLIGHT_WIDTHS : PEN_WIDTHS;

  return (
    <View style={props.styles.inkPopoverAnchor} pointerEvents="box-none">
      <View style={props.styles.inkPopoverInline}>
        <View style={props.styles.inkPopoverSection}>
          <Text style={props.styles.inkPopoverLabel}>{props.tool === 'highlight' ? '형광 색상' : '펜 색상'}</Text>
          <View style={props.styles.inkPresetGroup}>
            {(props.tool === 'highlight' ? HIGHLIGHT_COLORS : PEN_COLORS).map((color) => (
              <Pressable
                key={color}
                style={[
                  props.styles.inkColorSwatch,
                  { backgroundColor: color },
                  props.penColor === color && props.styles.inkColorSwatchActive,
                ]}
                onPress={() => props.onSelectColor(props.tool, color)}
              />
            ))}
          </View>
        </View>
        <View style={props.styles.inkPopoverSection}>
          <Text style={props.styles.inkPopoverLabel}>{props.tool === 'highlight' ? '형광 두께' : '펜 굵기'}</Text>
          <View style={props.styles.inkPresetGroup}>
            {widths.map((width) => (
              <Pressable
                key={width}
                style={[props.styles.inkWidthButton, props.penWidth === width && props.styles.inkWidthButtonActive]}
                onPress={() => props.onSelectWidth(props.tool, width)}
              >
                <View
                  style={[
                    props.styles.inkWidthDot,
                    {
                      width: props.tool === 'highlight' ? Math.min(24, Math.max(10, width)) : width + 2,
                      height: props.tool === 'highlight' ? 10 : width + 2,
                      borderRadius: 99,
                    },
                  ]}
                />
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

export function NotesPageListOverlay() {
  const workspace = useDesktopNotesWorkspaceContext();
  
  if (!workspace.pageListOpen) return null;

  const getPageLabel = (page: DocumentPageView) => (
    getDocumentPageLabel({
      page,
      pages: workspace.currentDocumentPages,
      memoPages: workspace.memoPages,
      pdfSuffix: '원본 PDF',
    })
  );

  const navigateToPage = (page: DocumentPageView) => {
    if (page.kind === 'pdf') workspace.onSetCurrentPdfPage(page.pageNumber);
    else workspace.onOpenGeneratedPage(page.pageId);
    workspace.setPageListOpen(false);
  };

  return (
    <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 9999, elevation: 99 }}>
      <Pressable style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.1)' }} onPress={() => workspace.setPageListOpen(false)} />
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 96, left: 40, width: 220, bottom: 0 }}>
        <View style={{ width: 220, maxHeight: 400, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E6EAF2', shadowColor: '#9098A8', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true} style={{ padding: 8, maxHeight: 380 }}>
            {workspace.currentDocumentPages.map((page) => {
              const isActive = isSameDocumentPage(workspace.currentDocumentPage, page);
              const bookmarked = workspace.bookmarks.some((bookmark) => isSameDocumentPage(bookmark.page, page));
              return (
                <Pressable 
                  key={`${page.kind}-${page.kind === 'pdf' ? page.pageNumber : page.pageId}`}
                  style={{ paddingVertical: 12, paddingHorizontal: 12, borderRadius: 6, backgroundColor: isActive ? '#F0F4FF' : 'transparent' }}
                  onPress={() => navigateToPage(page)}
                >
                  <Text style={{ fontSize: 13, fontWeight: isActive ? '800' : '600', color: isActive ? '#4F68D2' : '#556070' }}>
                    {bookmarked ? '★ ' : ''}{getPageLabel(page)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

export const NotesWorkspaceToolbar = React.memo(function NotesWorkspaceToolbar() {
  const workspace = useDesktopNotesWorkspaceContext();
  const [activeBrushPopover, setActiveBrushPopover] = React.useState<BrushTool | null>(null);

  React.useEffect(() => {
    if (workspace.inkTool !== 'pen' && workspace.inkTool !== 'highlight') setActiveBrushPopover(null);
  }, [workspace.inkTool]);

  const handleToolPress = (tool: InkTool) => {
    if (tool === 'pen' || tool === 'highlight') {
      workspace.onChangeInkTool(tool);
      setActiveBrushPopover((current) => (current === tool ? null : tool));
      workspace.setPageListOpen(false);
      return;
    }
    workspace.onChangeInkTool(tool);
    setActiveBrushPopover(null);
    workspace.setPageListOpen(false);
  };

  const handleBrushColorChange = (tool: BrushTool, color: string) => {
    workspace.onChangeInkTool(tool);
    workspace.onChangePenColor(color);
    setActiveBrushPopover(tool);
  };

  const handleBrushWidthChange = (tool: BrushTool, width: number) => {
    workspace.onChangeInkTool(tool);
    workspace.onChangePenWidth(width);
    setActiveBrushPopover(tool);
  };

  return (
    <View style={workspace.styles.inkToolbarWrap}>
      <View style={workspace.styles.inkToolbar}>
        <View style={[workspace.styles.documentPageNavigator, { position: 'relative' }]}>
          <Pressable style={workspace.styles.documentPageNavButton} onPress={workspace.onGoToPreviousDocumentPage}>
            <MaterialCommunityIcons name="chevron-left" size={18} color="#5B6474" />
          </Pressable>
          
          <Pressable 
            style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: workspace.pageListOpen ? '#F0F4FF' : 'transparent' }} 
            onPress={() => {
              workspace.setPageListOpen(!workspace.pageListOpen);
              setActiveBrushPopover(null);
            }}
          >
            <Text style={workspace.styles.documentPageLabel}>
              {workspace.currentPageLabel} <MaterialCommunityIcons name={workspace.pageListOpen ? "menu-up" : "menu-down"} size={14} color="#5B6474" />
            </Text>
          </Pressable>

          <Pressable style={workspace.styles.documentPageNavButton} onPress={workspace.onGoToNextDocumentPage}>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#5B6474" />
          </Pressable>
          
          <Pressable 
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F4FF', paddingHorizontal: 10, height: 34, borderRadius: 10, marginLeft: 12, gap: 4, borderWidth: 1, borderColor: '#DCE4FF' }} 
            onPress={workspace.onCreateMemoPage}
          >
            <MaterialCommunityIcons name="plus" size={16} color="#4F68D2" />
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#4F68D2' }}>빈 페이지 추가</Text>
          </Pressable>
          <Pressable
            style={[workspace.styles.inkActionButton, workspace.currentPageBookmarked && workspace.styles.inkToolButtonActive]}
            onPress={workspace.onToggleBookmarkCurrentPage}
          >
            <MaterialCommunityIcons name={workspace.currentPageBookmarked ? 'star' : 'star-outline'} size={18} color={workspace.currentPageBookmarked ? '#F59E0B' : '#556070'} />
          </Pressable>
          <Pressable style={workspace.styles.inkActionButton} onPress={workspace.onExportCurrentDocument}>
            <MaterialCommunityIcons name="share-variant-outline" size={18} color="#556070" />
          </Pressable>
        </View>

        <View style={workspace.styles.inkToolbarTools}>
          <View style={workspace.styles.inkToolCluster}>
            {PRIMARY_TOOLS.map((tool) => {
              const active = workspace.inkTool === tool.value;
              const popoverOpen = activeBrushPopover === tool.value;
              const isBrushTool = tool.value === 'pen' || tool.value === 'highlight';

              return (
                <View key={tool.value} style={workspace.styles.inkToolAnchor}>
                  <Pressable
                    style={[
                      workspace.styles.inkToolButton,
                      active && workspace.styles.inkToolButtonActive,
                      popoverOpen && workspace.styles.inkToolButtonPopoverOpen,
                    ]}
                    onPress={() => handleToolPress(tool.value)}
                  >
                    <MaterialCommunityIcons name={tool.icon} size={18} color={active ? workspace.blueColor : '#556070'} />
                  </Pressable>
                  {isBrushTool && popoverOpen ? (
                    <BrushPopover
                      tool={tool.value as BrushTool}
                      styles={workspace.styles}
                      penColor={workspace.penColor}
                      penWidth={workspace.penWidth}
                      onSelectColor={handleBrushColorChange}
                      onSelectWidth={handleBrushWidthChange}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>

          <View style={workspace.styles.inkToolbarDivider} />

          <View style={workspace.styles.inkSecondaryCluster}>
            {workspace.selectionRect ? (
              <Pressable
                style={[workspace.styles.inkActionButton, { flexDirection: 'row', gap: 4, width: 'auto', paddingHorizontal: 10 }]}
                onPress={workspace.deleteSelectedStrokes}
              >
                <MaterialCommunityIcons name="delete-outline" size={16} color="#EF4444" />
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#EF4444' }}>선택 지우기</Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={workspace.styles.inkActionButton} onPress={workspace.onUndoInk}>
                  <MaterialCommunityIcons name="undo-variant" size={18} color="#556070" />
                </Pressable>
                <Pressable style={workspace.styles.inkActionButton} onPress={workspace.onRedoInk}>
                  <MaterialCommunityIcons name="redo-variant" size={18} color="#556070" />
                </Pressable>
                <Pressable style={workspace.styles.inkActionButton} onPress={workspace.onClearInk}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color="#556070" />
                </Pressable>
              </>
            )}
          </View>

          <View style={workspace.styles.inkToolbarDivider} />

          <View style={workspace.styles.inkSecondaryCluster}>
            {/* 자료 및 독(Dock) 열기 버튼 */}
            <Pressable
              style={[workspace.styles.inkActionButton, workspace.styles.workspaceDockButton, workspace.showWorkspaceDock && workspace.styles.workspaceDockButtonActive]}
              onPress={workspace.onToggleWorkspaceDock}
            >
              <MaterialCommunityIcons
                name="image-multiple-outline"
                size={18}
                color={workspace.showWorkspaceDock ? '#5A74E8' : workspace.hasWorkspaceDockContent ? '#556EDB' : '#77839A'}
              />
              {workspace.hasWorkspaceDockContent ? <View style={workspace.styles.workspaceDockBadge} /> : null}
            </Pressable>
            <Pressable
              style={[workspace.styles.inkActionButton, workspace.styles.aiIconButton, workspace.aiPanelOpen && workspace.styles.aiIconButtonActive]}
              onPress={workspace.onToggleAiPanel}
            >
              <MaterialCommunityIcons name="star-four-points" size={18} color={workspace.aiPanelOpen ? '#5A74E8' : '#7786D8'} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
});
