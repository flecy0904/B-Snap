import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { cleanAiDisplayText } from '../../../ui-helpers';
import { getCaptureOriginalImageSource, getPageCaptureReferenceImageSource } from '../shared/capture-assets';
import type { CaptureAsset, NotebookPage, PageCaptureReference } from '../../../types';

export function NotebookPaperBackground({ page }: { page: NotebookPage }) {
  const isSummary = page.kind === 'summary';

  if (!isSummary) {
    return (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF' }}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: '#F2F5FA' }} />
      </View>
    );
  }

  const lines = Array.from({ length: 24 }, (_, index) => index);

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#FFFDF8' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 42, backgroundColor: '#FFF4E0', borderRightWidth: 1, borderRightColor: '#F0E5D2' }} />
      {lines.map((line) => (
        <View
          key={line}
          style={{
            position: 'absolute',
            left: 58,
            right: 40,
            top: 82 + line * 34,
            height: 1,
            backgroundColor: '#F0E5D2',
          }}
        />
      ))}
      <Text style={{ position: 'absolute', top: 30, left: 58, fontSize: 13, fontWeight: '900', color: '#B7791F' }}>
        AI 정리 페이지
      </Text>
    </View>
  );
}

function AdaptiveReferenceImage(props: {
  source: any;
  frameStyle: any;
  imageStyle: any;
  minHeight?: number;
  maxHeight?: number;
}) {
  const [frameWidth, setFrameWidth] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const minHeight = props.minHeight ?? 220;
  const maxHeight = props.maxHeight ?? 430;
  const dynamicHeight = frameWidth > 0 && aspectRatio
    ? Math.round(Math.max(minHeight, Math.min(maxHeight, frameWidth / aspectRatio)))
    : undefined;

  return (
    <View
      style={[props.frameStyle, dynamicHeight ? { height: dynamicHeight } : null]}
      onLayout={(event) => setFrameWidth(Math.round(event.nativeEvent.layout.width))}
    >
      <Image
        source={props.source}
        style={props.imageStyle}
        resizeMode="contain"
        fadeDuration={0}
        onLoad={(event) => {
          const source = (event.nativeEvent as any)?.source ?? {};
          const width = Number(source.width);
          const height = Number(source.height);
          if (width > 0 && height > 0) setAspectRatio(width / height);
        }}
      />
    </View>
  );
}

export function PdfPageReferenceCluster(props: {
  references: PageCaptureReference[];
  activeReference: PageCaptureReference | null;
  styles: any;
  onToggleFirstReference: () => void;
}) {
  if (!props.references.length) return null;
  const imageReferenceCount = props.references.filter((reference) => reference.type === 'image').length;
  const referenceButtonLabel = imageReferenceCount > 0 ? `사진 ${imageReferenceCount}` : `자료 ${props.references.length}`;

  return (
    <View pointerEvents="box-none" style={props.styles.pdfPageReferenceCluster}>
      <Pressable
        style={[props.styles.pdfPageReferenceSticker, props.activeReference && props.styles.pdfPageReferenceStickerActive]}
        onPress={props.onToggleFirstReference}
      >
        <MaterialCommunityIcons name="image-multiple-outline" size={14} color="#4F68D2" />
        <Text style={props.styles.pdfPageReferenceStickerText}>{referenceButtonLabel}</Text>
      </Pressable>
    </View>
  );
}

export function PdfPageReferencePopover(props: {
  reference: PageCaptureReference | null;
  references: PageCaptureReference[];
  activeReferenceIndex: number;
  styles: any;
  onClose: () => void;
  onSelectReference: (referenceId: string) => void;
  onAskAiAboutPageCaptureReference?: (referenceId: string) => void;
}) {
  if (!props.reference) return null;
  const activeReferenceImage = getPageCaptureReferenceImageSource(props.reference);

  return (
    <View style={props.styles.pdfPageReferencePopover}>
      <View style={props.styles.pdfPageReferencePopoverHeader}>
        <View style={props.styles.pdfPageReferencePopoverTitleBox}>
          <Text style={props.styles.pdfPageReferencePopoverLabel}>{props.reference.pageLabel}</Text>
          <Text style={props.styles.pdfPageReferencePopoverTitle} numberOfLines={1}>{props.reference.title}</Text>
        </View>
        <Pressable style={props.styles.pdfPageReferencePopoverClose} onPress={props.onClose}>
          <MaterialCommunityIcons name="close" size={16} color="#6B7280" />
        </Pressable>
      </View>
      {activeReferenceImage ? (
        <AdaptiveReferenceImage
          source={activeReferenceImage}
          frameStyle={props.styles.pdfPageReferencePopoverImageFrame}
          imageStyle={props.styles.pdfPageReferencePopoverImage}
          minHeight={280}
          maxHeight={560}
        />
      ) : (
        <View style={props.styles.pdfPageReferencePopoverFallback}>
          <MaterialCommunityIcons name={props.reference.type === 'pdf' ? 'file-pdf-box' : 'image-outline'} size={24} color="#6D7BD9" />
          <Text style={props.styles.pdfPageReferencePopoverFallbackText}>미리보기 없음</Text>
        </View>
      )}
      <View style={props.styles.pdfPageReferencePopoverAnswer}>
        <View style={props.styles.pdfPageReferencePopoverAnswerHeader}>
          <MaterialCommunityIcons name="star-four-points" size={14} color="#5F79FF" />
          <Text style={props.styles.pdfPageReferencePopoverAnswerTitle}>AI 설명</Text>
        </View>
        <Text style={props.styles.pdfPageReferencePopoverAnswerText} numberOfLines={7}>
          {cleanAiDisplayText(props.reference.aiSummary || props.reference.summary)}
        </Text>
      </View>
      <View style={props.styles.pdfPageReferencePopoverActions}>
        {props.references.length > 1 ? (
          <Pressable
            style={props.styles.pdfPageReferencePopoverIconAction}
            onPress={() => {
              const nextIndex = props.activeReferenceIndex <= 0 ? props.references.length - 1 : props.activeReferenceIndex - 1;
              props.onSelectReference(props.references[nextIndex].id);
            }}
          >
            <MaterialCommunityIcons name="chevron-left" size={17} color="#4F68D2" />
          </Pressable>
        ) : null}
        <Pressable
          style={props.styles.pdfPageReferencePopoverPrimaryAction}
          onPress={() => props.onAskAiAboutPageCaptureReference?.(props.reference!.id)}
        >
          <Text style={props.styles.pdfPageReferencePopoverPrimaryText}>AI로 더 보기</Text>
        </Pressable>
        {props.references.length > 1 ? (
          <Pressable
            style={props.styles.pdfPageReferencePopoverIconAction}
            onPress={() => {
              const nextIndex = props.activeReferenceIndex >= props.references.length - 1 ? 0 : props.activeReferenceIndex + 1;
              props.onSelectReference(props.references[nextIndex].id);
            }}
          >
            <MaterialCommunityIcons name="chevron-right" size={17} color="#4F68D2" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function PdfIncomingCapturePopover(props: {
  incomingAsset: CaptureAsset | null;
  styles: any;
  onAcceptIncomingAsset?: () => void;
  onArchiveIncomingAsset?: () => void;
  onDismissIncomingAsset?: () => void;
}) {
  if (!props.incomingAsset) return null;
  const incomingAssetImage = getCaptureOriginalImageSource(props.incomingAsset);
  const incomingAssetSummary = cleanAiDisplayText(props.incomingAsset.analysisSummary || props.incomingAsset.summary);

  return (
    <View style={props.styles.pdfIncomingCapturePopover}>
      <View style={props.styles.pdfIncomingCaptureHeader}>
        <View style={props.styles.pdfIncomingCaptureIcon}>
          <MaterialCommunityIcons name={props.incomingAsset.type === 'image' ? 'camera-outline' : 'file-pdf-box'} size={17} color="#4F68D2" />
        </View>
        <View style={props.styles.pdfIncomingCaptureTitleBox}>
          <Text style={props.styles.pdfIncomingCaptureLabel}>새 {props.incomingAsset.type === 'image' ? '사진' : '자료'} 도착</Text>
          <Text style={props.styles.pdfIncomingCaptureTitle} numberOfLines={1}>{props.incomingAsset.title}</Text>
        </View>
        <Pressable style={props.styles.pdfIncomingCaptureClose} onPress={props.onDismissIncomingAsset}>
          <MaterialCommunityIcons name="close" size={15} color="#6B7280" />
        </Pressable>
      </View>
      {incomingAssetImage ? (
        <AdaptiveReferenceImage
          source={incomingAssetImage}
          frameStyle={props.styles.pdfIncomingCaptureImageFrame}
          imageStyle={props.styles.pdfIncomingCaptureImage}
          minHeight={320}
          maxHeight={600}
        />
      ) : null}
      <View style={props.styles.pdfIncomingCaptureAnswer}>
        <View style={props.styles.pdfIncomingCaptureAnswerHeader}>
          <MaterialCommunityIcons name="star-four-points" size={13} color="#5F79FF" />
          <Text style={props.styles.pdfIncomingCaptureAnswerTitle}>AI 설명</Text>
        </View>
        <Text style={props.styles.pdfIncomingCaptureAnswerText} numberOfLines={6}>{incomingAssetSummary}</Text>
      </View>
      <View style={props.styles.pdfIncomingCaptureActions}>
        <Pressable style={props.styles.pdfIncomingCapturePrimaryAction} onPress={props.onAcceptIncomingAsset}>
          <Text style={props.styles.pdfIncomingCapturePrimaryText}>현재 페이지 연결</Text>
        </Pressable>
        <Pressable style={props.styles.pdfIncomingCaptureSecondaryAction} onPress={props.onArchiveIncomingAsset}>
          <Text style={props.styles.pdfIncomingCaptureSecondaryText}>나중에</Text>
        </Pressable>
      </View>
    </View>
  );
}
