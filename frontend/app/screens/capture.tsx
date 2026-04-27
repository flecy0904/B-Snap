import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { subjects as fallbackSubjects } from '../data';
import { CaptureAsset, Subject } from '../types';

export function MobileCapture(props: {
  captureId: number;
  subjects: Subject[];
  recentUploads: CaptureAsset[];
  pickerOpen: boolean;
  onCaptureId: (id: number) => void;
  onTogglePicker: () => void;
  pendingAction: 'camera' | 'library' | 'pdf' | null;
  captureFeedback: string | null;
  captureError: string | null;
  onCaptureFromCamera: () => Promise<void>;
  onPickFromLibrary: () => Promise<void>;
  onPickPdf: () => Promise<void>;
  styles: any;
}) {
  const current = props.subjects.find((item) => item.id === props.captureId) ?? props.subjects[0] ?? fallbackSubjects[0];

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={props.styles.mobilePage}>
      <Text style={props.styles.pageTitle}>촬영</Text>
      <View style={props.styles.currentClassCard}>
        <View style={props.styles.currentClassBadge}>
          <Text style={props.styles.currentClassBadgeIcon}>◔</Text>
          <Text style={props.styles.currentClassBadgeText}>현재 수업</Text>
        </View>
        <Text style={props.styles.currentClassTitle}>{current.name}</Text>
        <Text style={props.styles.currentClassText}>수업 시간 기준으로 자동 선택되었어요</Text>
      </View>

      <Text style={props.styles.fieldLabel}>과목 선택</Text>
      <Pressable style={[props.styles.selectBox, props.pickerOpen && props.styles.selectBoxOpen]} onPress={props.onTogglePicker}>
        <Text style={props.styles.selectText}>{current.name}</Text>
        <Text style={props.styles.selectArrow}>{props.pickerOpen ? '⌃' : '⌄'}</Text>
      </Pressable>

      {props.pickerOpen ? (
        <View style={props.styles.dropdown}>
          {props.subjects.map((item) => {
            const active = item.id === props.captureId;
            return (
              <Pressable key={item.id} style={[props.styles.dropdownRow, active && props.styles.dropdownRowActive]} onPress={() => props.onCaptureId(item.id)}>
                <Text style={[props.styles.dropdownText, active && props.styles.dropdownTextActive]}>{item.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={props.styles.captureActions}>
        <Pressable style={props.styles.primaryButton} onPress={props.onCaptureFromCamera}>
          <Text style={props.styles.primaryButtonText}>◉ 촬영 시작</Text>
        </Pressable>
        <Pressable style={props.styles.secondaryButton} onPress={props.onPickFromLibrary}>
          <Text style={props.styles.secondaryButtonText}>⌲ 사진첩에서 불러오기</Text>
        </Pressable>
        <Pressable style={props.styles.tertiaryButton} onPress={props.onPickPdf}>
          <Text style={props.styles.tertiaryButtonText}>PDF 가져오기</Text>
        </Pressable>
      </View>

      <View style={props.styles.captureMockCard}>
        <Text style={props.styles.captureMockTitle}>업로드 상태</Text>
        {props.pendingAction ? <Text style={props.styles.capturePendingText}>현재 작업: {props.pendingAction}</Text> : null}
        {props.captureFeedback ? <Text style={props.styles.captureFeedbackText}>{props.captureFeedback}</Text> : null}
        {props.captureError ? <Text style={props.styles.captureErrorText}>{props.captureError}</Text> : null}
      </View>
      {props.recentUploads.length ? (
        <View style={props.styles.captureRecentCard}>
          <Text style={props.styles.captureRecentTitle}>최근 업로드</Text>
          {props.recentUploads.map((asset, index) => (
            <View key={asset.id} style={[props.styles.captureRecentRow, index === 0 && props.styles.captureRecentRowFirst]}>
              <View style={props.styles.captureRecentMeta}>
                <Text style={props.styles.captureRecentType}>{asset.type === 'image' ? 'IMAGE' : 'PDF'}</Text>
                <Text style={props.styles.captureRecentName} numberOfLines={1}>{asset.title}</Text>
                <Text style={props.styles.captureRecentTime} numberOfLines={1}>
                  {asset.createdAt}
                  {asset.pageCount ? ` · ${asset.pageCount}페이지` : ''}
                </Text>
              </View>
              <View style={props.styles.captureRecentStatusPill}>
                <Text style={props.styles.captureRecentStatusText}>전송됨</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={props.styles.captureEmptyCard}>
          <Text style={props.styles.captureEmptyTitle}>아직 업로드된 자료가 없습니다</Text>
          <Text style={props.styles.captureEmptyBody}>사진을 찍거나 사진첩, PDF 가져오기를 사용하면 최근 업로드 기록이 여기에 쌓입니다.</Text>
        </View>
      )}

      <Text style={props.styles.captureHint}>최근 촬영한 노트는 각 과목 페이지에서 확인할 수 있어요</Text>
    </ScrollView>
  );
}

export function DesktopCapture(props: {
  compact: boolean;
  captureId: number;
  subjects: Subject[];
  recentUploads: CaptureAsset[];
  onCaptureId: (id: number) => void;
  pendingAction: 'camera' | 'library' | 'pdf' | null;
  captureFeedback: string | null;
  captureError: string | null;
  onCaptureFromCamera: () => Promise<void>;
  onPickFromLibrary: () => Promise<void>;
  onPickPdf: () => Promise<void>;
  styles: any;
  isWeb?: boolean;
}) {
  const current = props.subjects.find((item) => item.id === props.captureId) ?? props.subjects[0] ?? fallbackSubjects[0];
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={[props.styles.desktopPage, props.compact && props.styles.desktopPageCompact, props.isWeb && props.styles.webDesktopPage]}>
      <View style={props.isWeb ? props.styles.webPageHeader : [props.styles.desktopHeader, props.compact && props.styles.desktopHeaderCompact]}>
        {props.isWeb ? (
          <>
            <View style={props.styles.webPageHeaderMeta}>
              <Text style={props.styles.webPageEyebrow}>CAPTURE HUB</Text>
              <Text style={props.styles.webPageTitle}>자료 캡처</Text>
              <Text style={props.styles.webPageBody}>사진, PDF, 외부 자료를 과목별로 정리해 노트 작업공간에 바로 연결합니다.</Text>
            </View>
            <View style={props.styles.webHeaderBadgeRow}>
              <View style={props.styles.webHeaderBadge}>
                <Text style={props.styles.webHeaderBadgeText}>최근 업로드 {props.recentUploads.length}건</Text>
              </View>
            </View>
          </>
        ) : (
          <Text style={[props.styles.desktopTitle, props.compact && props.styles.desktopTitleCompact]}>촬영</Text>
        )}
      </View>
      <View style={[props.styles.desktopCaptureForm, props.compact && props.styles.desktopCaptureFormCompact, props.isWeb && props.styles.webCaptureGrid]}>
        <View style={[props.styles.currentClassCard, props.compact && props.styles.currentClassCardCompact]}>
          <View style={props.styles.currentClassBadge}>
            <Text style={props.styles.currentClassBadgeIcon}>◔</Text>
            <Text style={props.styles.currentClassBadgeText}>현재 수업</Text>
          </View>
          <Text style={props.styles.currentClassTitle}>{current.name}</Text>
          <Text style={props.styles.currentClassText}>시간표와 연결되는 촬영 흐름에 맞춰 과목이 선택되어 있습니다.</Text>
        </View>

        <Text style={props.styles.fieldLabel}>과목 선택</Text>
        <Pressable style={[props.styles.selectBox, pickerOpen && props.styles.selectBoxOpen]} onPress={() => setPickerOpen((value) => !value)}>
          <Text style={props.styles.selectText}>{current.name}</Text>
          <Text style={props.styles.selectArrow}>{pickerOpen ? '⌃' : '⌄'}</Text>
        </Pressable>

        {pickerOpen ? (
          <View style={[props.styles.dropdown, props.styles.desktopDropdown]}>
            {props.subjects.map((item) => {
              const active = item.id === props.captureId;
              return (
                <Pressable
                  key={item.id}
                  style={[props.styles.dropdownRow, active && props.styles.dropdownRowActive]}
                  onPress={() => {
                    props.onCaptureId(item.id);
                    setPickerOpen(false);
                  }}
                >
                  <Text style={[props.styles.dropdownText, active && props.styles.dropdownTextActive]}>{item.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={props.styles.desktopCaptureActions}>
          <Pressable style={props.styles.primaryButton} onPress={props.onCaptureFromCamera}>
            <Text style={props.styles.primaryButtonText}>◉ 촬영 시작</Text>
          </Pressable>
          <Pressable style={props.styles.secondaryButton} onPress={props.onPickFromLibrary}>
            <Text style={props.styles.secondaryButtonText}>⌲ 사진첩에서 불러오기</Text>
          </Pressable>
          <Pressable style={props.styles.tertiaryButton} onPress={props.onPickPdf}>
            <Text style={props.styles.tertiaryButtonText}>PDF 가져오기</Text>
          </Pressable>
        </View>
        <View style={props.styles.captureMockCard}>
          <Text style={props.styles.captureMockTitle}>업로드 상태</Text>
          {props.pendingAction ? <Text style={props.styles.capturePendingText}>현재 작업: {props.pendingAction}</Text> : null}
          {props.captureFeedback ? <Text style={props.styles.captureFeedbackText}>{props.captureFeedback}</Text> : null}
          {props.captureError ? <Text style={props.styles.captureErrorText}>{props.captureError}</Text> : null}
        </View>
        {props.recentUploads.length ? (
          <View style={props.styles.captureRecentCard}>
            <Text style={props.styles.captureRecentTitle}>최근 업로드</Text>
            {props.recentUploads.map((asset, index) => (
              <View key={asset.id} style={[props.styles.captureRecentRow, index === 0 && props.styles.captureRecentRowFirst]}>
                <View style={props.styles.captureRecentMeta}>
                  <Text style={props.styles.captureRecentType}>{asset.type === 'image' ? 'IMAGE' : 'PDF'}</Text>
                  <Text style={props.styles.captureRecentName} numberOfLines={1}>{asset.title}</Text>
                  <Text style={props.styles.captureRecentTime} numberOfLines={1}>
                    {asset.createdAt}
                    {asset.pageCount ? ` · ${asset.pageCount}페이지` : ''}
                  </Text>
                </View>
                <View style={props.styles.captureRecentStatusPill}>
                  <Text style={props.styles.captureRecentStatusText}>전송됨</Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={props.styles.captureEmptyCard}>
            <Text style={props.styles.captureEmptyTitle}>아직 업로드된 자료가 없습니다</Text>
            <Text style={props.styles.captureEmptyBody}>카메라, 사진첩, PDF 가져오기 중 하나를 실행하면 최근 업로드 기록이 여기에 표시됩니다.</Text>
          </View>
        )}
        <Text style={props.styles.captureHint}>최근 촬영한 노트는 각 과목 페이지에서 확인할 수 있어요</Text>
      </View>
    </ScrollView>
  );
}
