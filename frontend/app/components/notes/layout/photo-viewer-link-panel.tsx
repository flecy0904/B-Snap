import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { StudyDocumentEntry } from '../../../types';

export function PhotoViewerLinkPanel(props: {
  styles: any;
  assetId: string;
  documents: StudyDocumentEntry[];
  initialDocumentId?: number | null;
  initialPageNumber?: number | null;
  onLink: (assetId: string, documentId: number, pageNumber: number) => void;
}) {
  const [documentId, setDocumentId] = React.useState<number | null>(props.initialDocumentId ?? props.documents[0]?.id ?? null);
  const [pageText, setPageText] = React.useState(String(props.initialPageNumber ?? 1));

  React.useEffect(() => {
    setDocumentId(props.initialDocumentId ?? props.documents[0]?.id ?? null);
    setPageText(String(props.initialPageNumber ?? 1));
  }, [props.assetId, props.documents, props.initialDocumentId, props.initialPageNumber]);

  const selectedDocument = React.useMemo(
    () => props.documents.find((document) => document.id === documentId) ?? props.documents[0] ?? null,
    [documentId, props.documents],
  );
  const pageNumber = React.useMemo(() => {
    const parsed = Number.parseInt(pageText, 10);
    const maxPage = Math.max(1, selectedDocument?.pageCount ?? 1);
    return Math.max(1, Math.min(maxPage, Number.isFinite(parsed) ? parsed : 1));
  }, [pageText, selectedDocument?.pageCount]);

  if (!props.documents.length) {
    return <Text style={props.styles.photoViewerInfoValue}>연결 가능한 노트/PDF가 없습니다.</Text>;
  }

  return (
    <View style={props.styles.photoViewerLinkPanel}>
      <Text style={props.styles.photoViewerLinkLabel}>노트에 연결</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={props.styles.photoViewerDocumentChips}>
        {props.documents.map((document) => {
          const active = selectedDocument?.id === document.id;
          return (
            <Pressable
              key={document.id}
              style={[props.styles.photoViewerDocumentChip, active && props.styles.photoViewerDocumentChipActive]}
              onPress={() => {
                setDocumentId(document.id);
                setPageText((current) => {
                  const parsed = Number.parseInt(current, 10);
                  return String(Math.max(1, Math.min(document.pageCount, Number.isFinite(parsed) ? parsed : 1)));
                });
              }}
            >
              <Text style={[props.styles.photoViewerDocumentChipText, active && props.styles.photoViewerDocumentChipTextActive]} numberOfLines={1}>
                {document.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={props.styles.photoViewerLinkControls}>
        <Pressable
          style={props.styles.photoViewerPageStepper}
          onPress={() => setPageText(String(Math.max(1, pageNumber - 1)))}
        >
          <MaterialCommunityIcons name="minus" size={15} color="#4F68D2" />
        </Pressable>
        <TextInput
          value={String(pageNumber)}
          onChangeText={(value) => setPageText(value.replace(/[^\d]/g, '').slice(0, 4) || '1')}
          keyboardType="number-pad"
          style={props.styles.photoViewerPageInput}
        />
        <Pressable
          style={props.styles.photoViewerPageStepper}
          onPress={() => setPageText(String(Math.min(selectedDocument?.pageCount ?? pageNumber + 1, pageNumber + 1)))}
        >
          <MaterialCommunityIcons name="plus" size={15} color="#4F68D2" />
        </Pressable>
        <Text style={props.styles.photoViewerPageHint}>/ {selectedDocument?.pageCount ?? 1}페이지</Text>
        <Pressable
          style={[props.styles.photoViewerLinkButton, !selectedDocument && props.styles.photoViewerLinkButtonDisabled]}
          disabled={!selectedDocument}
          onPress={() => {
            if (!selectedDocument) return;
            props.onLink(props.assetId, selectedDocument.id, pageNumber);
          }}
        >
          <Text style={props.styles.photoViewerLinkButtonText}>연결</Text>
        </Pressable>
      </View>
    </View>
  );
}
