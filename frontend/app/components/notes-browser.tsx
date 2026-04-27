import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { subjects as allSubjects } from '../data';
import { NoteEntry, NoteWorkspaceMode, StudyDocumentEntry, Subject } from '../types';
import { darkenHex } from '../ui-helpers';

export type NotesBrowserProps = {
  styles: any;
  compact: boolean;
  noteMode: NoteWorkspaceMode;
  query: string;
  sort: 'latest' | 'oldest';
  subjects: Subject[];
  selectedSubject: Subject | null;
  notes: NoteEntry[];
  allNotes: NoteEntry[];
  deletedNotes: NoteEntry[];
  studyDocuments: StudyDocumentEntry[];
  allStudyDocuments: StudyDocumentEntry[];
  deletedStudyDocuments: StudyDocumentEntry[];
  blueColor: string;
  onChangeMode: (mode: NoteWorkspaceMode) => void;
  onQuery: (value: string) => void;
  onSort: () => void;
  onCreateBlankNote: () => void;
  onUploadPdf: () => void;
  onReset: () => void;
  onOpenSubject: (id: number) => void;
  onOpenNote: (id: number) => void;
  onOpenStudyDocument: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onDeleteStudyDocument: (id: number) => void;
  onRestoreNote: (id: number) => void;
  onRestoreStudyDocument: (id: number) => void;
};

export function NotesBrowser(props: NotesBrowserProps) {
  const [recoveryOpen, setRecoveryOpen] = React.useState(false);
  const subjectById = React.useMemo(() => {
    const map = new Map<number, Subject>();
    allSubjects.forEach((subject) => map.set(subject.id, subject));
    props.subjects.forEach((subject) => map.set(subject.id, subject));
    return map;
  }, [props.subjects]);
  const activeDeletedNotes = React.useMemo(
    () => props.selectedSubject ? props.deletedNotes.filter((note) => note.subjectId === props.selectedSubject?.id) : props.deletedNotes,
    [props.deletedNotes, props.selectedSubject?.id],
  );
  const activeDeletedStudyDocuments = React.useMemo(
    () => props.selectedSubject ? props.deletedStudyDocuments.filter((document) => document.subjectId === props.selectedSubject?.id) : props.deletedStudyDocuments,
    [props.deletedStudyDocuments, props.selectedSubject?.id],
  );
  const recoverableCount = props.noteMode === 'photo' ? activeDeletedNotes.length : activeDeletedStudyDocuments.length;
  const findSubject = React.useCallback((subjectId: number) => subjectById.get(subjectId), [subjectById]);

  React.useEffect(() => {
    if (recoverableCount === 0) setRecoveryOpen(false);
  }, [recoverableCount]);

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={[props.styles.desktopPage, props.compact && props.styles.desktopPageCompact]}>
      <View style={props.styles.desktopNotesTopRow}>
        <View><Text style={[props.styles.desktopTitle, props.compact && props.styles.desktopTitleCompact]}>{props.noteMode === 'photo' ? 'Photo' : 'Note'}</Text></View>
        <View style={props.styles.desktopModeSegment}>
          <Pressable style={[props.styles.desktopModeButton, props.noteMode === 'photo' && props.styles.desktopModeButtonActive]} onPress={() => props.onChangeMode('photo')}><Text style={[props.styles.desktopModeButtonText, props.noteMode === 'photo' && props.styles.desktopModeButtonTextActive]}>Photo</Text></Pressable>
          <Pressable style={[props.styles.desktopModeButton, props.noteMode === 'note' && props.styles.desktopModeButtonActive]} onPress={() => props.onChangeMode('note')}><Text style={[props.styles.desktopModeButtonText, props.noteMode === 'note' && props.styles.desktopModeButtonTextActive]}>Note</Text></Pressable>
        </View>
      </View>
      <View style={props.styles.desktopFilters}>
        <View style={props.styles.desktopSearch}>
          <Text style={props.styles.searchIcon}>⌕</Text>
          <TextInput value={props.query} onChangeText={props.onQuery} placeholder={props.noteMode === 'photo' ? 'Photo 검색' : 'Note 검색'} placeholderTextColor="#C3C8D5" style={props.styles.searchInput} />
        </View>
        <Pressable style={props.styles.desktopFilterButton} onPress={props.onSort}><Text style={props.styles.desktopFilterButtonText}>{props.sort === 'latest' ? '최신순' : '오래된순'}</Text></Pressable>
        {recoverableCount ? (
          <Pressable style={[props.styles.desktopFilterButton, props.styles.recoveryFilterButton]} onPress={() => setRecoveryOpen((current) => !current)}>
            <Text style={props.styles.desktopFilterButtonText}>최근 삭제 {recoverableCount}</Text>
          </Pressable>
        ) : null}
        {props.noteMode === 'note' ? (
          <>
            <Pressable style={[props.styles.desktopFilterButton, props.styles.desktopPrimaryAction]} onPress={props.onCreateBlankNote}><Text style={[props.styles.desktopFilterButtonText, props.styles.desktopPrimaryActionText]}>+ 새 노트</Text></Pressable>
            <Pressable style={props.styles.desktopFilterButton} onPress={props.onUploadPdf}><Text style={props.styles.desktopFilterButtonText}>PDF 업로드</Text></Pressable>
          </>
        ) : null}
        <Pressable style={props.styles.desktopFilterButton} onPress={props.onReset}><Text style={props.styles.desktopFilterButtonText}>초기화</Text></Pressable>
      </View>
      {recoveryOpen && recoverableCount ? (
        <View style={props.styles.recoveryPanel}>
          <View style={props.styles.recoveryHeader}>
            <Text style={props.styles.recoveryTitle}>최근 삭제</Text>
            <Text style={props.styles.recoveryMeta}>{props.selectedSubject ? props.selectedSubject.name : '전체'} · {recoverableCount}개</Text>
          </View>
          {props.noteMode === 'photo' ? activeDeletedNotes.map((item) => {
            const subject = findSubject(item.subjectId);
            return (
              <View key={item.id} style={props.styles.recoveryRow}>
                <View style={props.styles.recoveryRowMeta}>
                  <Text style={props.styles.recoveryRowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={props.styles.recoveryRowBody} numberOfLines={1}>{subject?.name ?? '과목 없음'} · {item.date}</Text>
                </View>
                <Pressable style={props.styles.recoveryRestoreButton} onPress={() => props.onRestoreNote(item.id)}>
                  <Text style={props.styles.recoveryRestoreButtonText}>복구</Text>
                </Pressable>
              </View>
            );
          }) : activeDeletedStudyDocuments.map((item) => {
            const subject = findSubject(item.subjectId);
            return (
              <View key={item.id} style={props.styles.recoveryRow}>
                <View style={props.styles.recoveryRowMeta}>
                  <Text style={props.styles.recoveryRowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={props.styles.recoveryRowBody} numberOfLines={1}>{subject?.name ?? '과목 없음'} · {item.type === 'pdf' ? 'PDF' : '빈 노트'} · {item.pageCount}페이지</Text>
                </View>
                <Pressable style={props.styles.recoveryRestoreButton} onPress={() => props.onRestoreStudyDocument(item.id)}>
                  <Text style={props.styles.recoveryRestoreButtonText}>복구</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
      <View style={[props.styles.desktopNotesLayout, props.compact && props.styles.desktopNotesLayoutCompact]}>
        <View style={[props.styles.desktopSubjects, props.compact && props.styles.desktopSubjectsCompact]}>
          {props.subjects.map((item) => (
            <Pressable key={item.id} style={[props.styles.subjectRow, props.selectedSubject?.id === item.id && { borderColor: item.color, backgroundColor: '#FFFFFF' }, props.selectedSubject?.id === item.id && props.styles.subjectRowActive]} onPress={() => props.onOpenSubject(item.id)}>
              <View style={[props.styles.subjectIconBox, { backgroundColor: item.bgColor }, props.selectedSubject?.id === item.id && { backgroundColor: item.color }]}>
                <View style={[props.styles.subjectDot, { backgroundColor: darkenHex(item.bgColor, 0.28) }]} />
              </View>
              <View style={props.styles.fill}>
                <Text style={[props.styles.subjectTitle, props.selectedSubject?.id === item.id && props.styles.subjectTitleActive]}>{item.name}</Text>
                <Text style={[props.styles.subjectMeta, props.selectedSubject?.id === item.id && props.styles.subjectMetaActive]}>
                  {props.noteMode === 'photo' ? `${props.allNotes.filter((note) => note.subjectId === item.id).length}개 노트` : `${props.allStudyDocuments.filter((document) => document.subjectId === item.id).length}개 문서`}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
        <View style={props.styles.fill}>
          {props.noteMode === 'photo' ? (
            props.notes.length ? props.notes.map((item) => {
              const subject = findSubject(item.subjectId);
              const subjectColor = subject?.color ?? '#D6DCE8';
              return (
                <Pressable key={item.id} style={props.styles.noteListCard} onPress={() => props.onOpenNote(item.id)}>
                  <View style={[props.styles.noteListRail, { backgroundColor: subjectColor }]} />
                  <Image source={item.image} style={props.styles.noteListThumb} resizeMode="cover" />
                  <View style={props.styles.fill}>
                    <Text style={props.styles.noteListDate}>{item.date}</Text>
                    <Text style={props.styles.noteListTitle} numberOfLines={2}>{item.title}</Text>
                  </View>
                  <Pressable
                    style={props.styles.libraryDeleteButton}
                    onPress={(event) => {
                      event.stopPropagation();
                      props.onDeleteNote(item.id);
                    }}
                  >
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color="#C04B4B" />
                  </Pressable>
                </Pressable>
              );
            }) : <View style={props.styles.emptyCard}><Text style={props.styles.emptyTitle}>표시할 노트가 없습니다</Text><Text style={props.styles.emptyBody}>현재는 시간표와 과목 정보만 실제 데이터로 교체한 상태입니다.</Text></View>
          ) : (
            <View style={props.styles.desktopDocumentsPanel}>
              {props.studyDocuments.length ? props.studyDocuments.map((item) => {
                const subject = findSubject(item.subjectId);
                const subjectColor = subject?.color ?? '#D6DCE8';
                const isPdf = item.type === 'pdf';
                return (
                  <Pressable key={item.id} style={props.styles.documentListCard} onPress={() => props.onOpenStudyDocument(item.id)}>
                    <View style={[props.styles.documentListRail, { backgroundColor: subjectColor }]} />
                    <View style={[props.styles.documentThumb, { backgroundColor: isPdf ? '#F6F8FE' : '#EEF1F6' }]}>
                      <Text style={[props.styles.documentThumbText, { color: isPdf ? props.blueColor : '#6B7280' }]}>{isPdf ? 'PDF' : 'NOTE'}</Text>
                    </View>
                    <View style={props.styles.fill}>
                      <View style={props.styles.documentTitleRow}>
                        <Text style={props.styles.documentTitle} numberOfLines={1}>{item.title}</Text>
                        <View style={[props.styles.documentTypePill, { backgroundColor: isPdf ? '#EEF1FF' : '#F1F3F6' }]}>
                          <Text style={[props.styles.documentTypeText, { color: isPdf ? props.blueColor : '#6B7280' }]}>{isPdf ? 'PDF' : '빈 노트'}</Text>
                        </View>
                      </View>
                      <Text style={props.styles.documentMeta}>{item.updatedAt} · {item.pageCount}페이지</Text>
                    </View>
                    <Pressable
                      style={props.styles.libraryDeleteButton}
                      onPress={(event) => {
                        event.stopPropagation();
                        props.onDeleteStudyDocument(item.id);
                      }}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={18} color="#C04B4B" />
                    </Pressable>
                  </Pressable>
                );
              }) : <View style={props.styles.emptyCard}><Text style={props.styles.emptyTitle}>문서가 없습니다</Text></View>}
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
