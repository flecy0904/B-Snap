import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { CaptureAsset, PageCaptureReference, StudyDocumentEntry } from '../../../types';
import { cleanAiDisplayText } from '../../../ui-helpers';
import { formatCaptureDate, getCaptureOriginalImageSource, getCaptureReferences } from '../shared/capture-assets';
import { PhotoViewerLinkPanel } from './photo-viewer-link-panel';

export function PhotoViewerModal(props: {
  asset: CaptureAsset | null;
  references: PageCaptureReference[];
  documents: StudyDocumentEntry[];
  styles: any;
  onClose: () => void;
  onInsertInboxAsset: (assetId: string) => void;
  onLinkCaptureAssetToPage: (assetId: string, documentId: number, pageNumber: number) => boolean;
  onOpenPageCaptureReference: (referenceId: string) => void;
  onAskAiAboutPageCaptureReference: (referenceId: string) => void;
  onRemoveCaptureAsset: (assetId: string) => void;
}) {
  const asset = props.asset;
  const previewImageSource = asset ? getCaptureOriginalImageSource(asset) : null;
  const previewReferences = React.useMemo(
    () => asset ? getCaptureReferences(asset, props.references) : [],
    [asset, props.references],
  );
  const previewPrimaryReference = previewReferences[0] ?? null;
  const linkableDocuments = React.useMemo(() => {
    if (!asset) return [];
    return props.documents
      .filter((document) => document.subjectId === asset.subjectId && document.type !== 'image' && document.pageCount > 0)
      .sort((left, right) => (left.id === previewPrimaryReference?.documentId ? -1 : right.id === previewPrimaryReference?.documentId ? 1 : right.id - left.id));
  }, [asset, previewPrimaryReference?.documentId, props.documents]);
  const selectedLinkDocument = React.useMemo(
    () => linkableDocuments.find((document) => document.id === previewPrimaryReference?.documentId) ?? linkableDocuments[0] ?? null,
    [linkableDocuments, previewPrimaryReference?.documentId],
  );
  const selectedLinkInitialPageNumber = previewPrimaryReference?.page.kind === 'pdf' ? previewPrimaryReference.page.pageNumber : 1;

  return (
    <Modal
      visible={!!asset}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
    >
      <View style={props.styles.photoViewerOverlay}>
        <Pressable style={props.styles.photoViewerBackdrop} onPress={props.onClose} />
        {asset ? (
          <View style={props.styles.photoViewerCard}>
            <View style={props.styles.photoViewerHeader}>
              <View style={props.styles.fill}>
                <Text style={props.styles.photoViewerTitle} numberOfLines={1}>{asset.title || '크롭 사진'}</Text>
                <View style={props.styles.photoViewerMetaRow}>
                  <View style={props.styles.photoViewerMetaPill}>
                    <MaterialCommunityIcons name="calendar-clock-outline" size={13} color="#7E8798" />
                    <Text style={props.styles.photoViewerMetaPillText}>{formatCaptureDate(asset.createdAt)}</Text>
                  </View>
                  <View style={[props.styles.photoViewerMetaPill, previewReferences.length > 0 && props.styles.photoViewerMetaPillLinked]}>
                    <MaterialCommunityIcons name={previewReferences.length ? 'link-variant' : 'link-off'} size={13} color={previewReferences.length ? '#4F68D2' : '#7E8798'} />
                    <Text style={[props.styles.photoViewerMetaPillText, previewReferences.length > 0 && props.styles.photoViewerMetaPillTextLinked]}>
                      {previewReferences.length ? `${previewReferences.length}곳 연결` : '미연결'}
                    </Text>
                  </View>
                </View>
              </View>
              <Pressable style={props.styles.photoViewerCloseButton} onPress={props.onClose}>
                <MaterialCommunityIcons name="close" size={20} color="#5F6876" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={props.styles.photoViewerBody} showsVerticalScrollIndicator={false}>
              <View style={props.styles.photoViewerImageFrame}>
                {previewImageSource ? (
                  <Image source={previewImageSource} style={props.styles.photoViewerImage} resizeMode="contain" />
                ) : (
                  <View style={props.styles.photoViewerFallback}>
                    <MaterialCommunityIcons name="image-off-outline" size={36} color="#9AA6B8" />
                  </View>
                )}
              </View>
              <View style={props.styles.photoViewerInfo}>
                <View style={props.styles.photoViewerInfoCard}>
                  <View style={props.styles.photoViewerInfoHeader}>
                    <MaterialCommunityIcons name="file-link-outline" size={15} color="#5F79FF" />
                    <Text style={props.styles.photoViewerInfoTitle}>연결 위치</Text>
                  </View>
                  {previewReferences.length ? (
                    <View style={props.styles.photoViewerReferenceRow}>
                      {previewReferences.map((reference) => (
                        <Pressable
                          key={reference.id}
                          style={props.styles.photoViewerReferencePill}
                          onPress={() => {
                            props.onOpenPageCaptureReference(reference.id);
                            props.onClose();
                          }}
                        >
                          <Text style={props.styles.photoViewerReferencePillText}>{reference.pageLabel}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={props.styles.photoViewerInfoValue}>아직 노트 페이지에 연결되지 않았습니다.</Text>
                  )}
                  <PhotoViewerLinkPanel
                    styles={props.styles}
                    assetId={asset.id}
                    documents={linkableDocuments}
                    initialDocumentId={selectedLinkDocument?.id ?? null}
                    initialPageNumber={selectedLinkInitialPageNumber}
                    onLink={(assetId, documentId, pageNumber) => {
                      props.onLinkCaptureAssetToPage(assetId, documentId, pageNumber);
                      props.onClose();
                    }}
                  />
                </View>
                <View style={props.styles.photoViewerInfoCard}>
                  <View style={props.styles.photoViewerInfoHeader}>
                    <MaterialCommunityIcons name="star-four-points" size={15} color="#5F79FF" />
                    <Text style={props.styles.photoViewerInfoTitle}>AI 설명</Text>
                  </View>
                  <Text style={props.styles.photoViewerInfoValue}>
                    {cleanAiDisplayText(asset.analysisSummary ?? asset.summary)}
                  </Text>
                </View>
              </View>
            </ScrollView>
            <View style={props.styles.photoViewerActionRow}>
              {previewPrimaryReference ? (
                <Pressable
                  style={props.styles.photoViewerActionButton}
                  onPress={() => {
                    props.onAskAiAboutPageCaptureReference(previewPrimaryReference.id);
                    props.onClose();
                  }}
                >
                  <MaterialCommunityIcons name="star-four-points" size={16} color="#4F68D2" />
                  <Text style={props.styles.photoViewerActionText}>AI에게 질문하기</Text>
                </Pressable>
              ) : null}
              {previewPrimaryReference ? (
                <Pressable
                  style={[props.styles.photoViewerActionButton, props.styles.photoViewerActionButtonPrimary]}
                  onPress={() => {
                    props.onOpenPageCaptureReference(previewPrimaryReference.id);
                    props.onClose();
                  }}
                >
                  <MaterialCommunityIcons name="notebook-outline" size={16} color="#FFFFFF" />
                  <Text style={[props.styles.photoViewerActionText, props.styles.photoViewerActionTextPrimary]}>노트에서 열기</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={props.styles.photoViewerActionButton}
                onPress={() => {
                  props.onInsertInboxAsset(asset.id);
                  props.onClose();
                }}
              >
                <MaterialCommunityIcons name="file-image-plus-outline" size={16} color="#4F68D2" />
                <Text style={props.styles.photoViewerActionText}>이미지 노트 만들기</Text>
              </Pressable>
              <Pressable
                style={[props.styles.photoViewerActionButton, props.styles.photoViewerActionButtonDanger]}
                onPress={() => {
                  props.onRemoveCaptureAsset(asset.id);
                  props.onClose();
                }}
              >
                <MaterialCommunityIcons name="trash-can-outline" size={16} color="#D64B4B" />
                <Text style={[props.styles.photoViewerActionText, props.styles.photoViewerActionTextDanger]}>삭제</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
