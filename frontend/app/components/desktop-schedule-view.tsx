import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { GearIcon } from './navigation';
import type { DesktopScheduleProps } from '../screens/schedule';
import { visibleHours } from '../ui-helpers';
import { DesktopTimetableBoard } from './schedule-shared';
import type { TimetableSlotInput } from '../types';

const DAYS_OPTIONS = [
  { id: 'MON', label: '월' },
  { id: 'TUE', label: '화' },
  { id: 'WED', label: '수' },
  { id: 'THU', label: '목' },
  { id: 'FRI', label: '금' },
] as const;

type EditableTimeSlot = TimetableSlotInput & { id: number };

const createDefaultTimeSlot = (): EditableTimeSlot => ({ id: 1, day: 'MON', start: '09:00', end: '10:30', location: '' });

export function DesktopScheduleView(props: DesktopScheduleProps) {
  const { height } = useWindowDimensions();
  const hours = visibleHours(props.semester.entries);
  const reservedHeight = props.compact ? 170 : 196;
  const rowHeight = Math.max(props.compact ? 44 : 50, Math.min(props.compact ? 62 : 68, Math.floor((height - reservedHeight) / hours.length)));

  const [newSubjectName, setNewSubjectName] = useState('');
  const [timeSlots, setTimeSlots] = useState<EditableTimeSlot[]>([createDefaultTimeSlot()]);

  const addTimeSlot = () => {
    setTimeSlots([...timeSlots, { id: Date.now(), day: 'MON', start: '09:00', end: '10:30', location: '' }]);
  };

  const updateTimeSlot = <Field extends keyof TimetableSlotInput>(id: number, field: Field, value: TimetableSlotInput[Field]) => {
    setTimeSlots(timeSlots.map(slot => slot.id === id ? { ...slot, [field]: value } : slot));
  };

  const removeTimeSlot = (id: number) => {
    if (timeSlots.length > 1) {
      setTimeSlots(timeSlots.filter(slot => slot.id !== id));
    }
  };

  const handleSave = () => {
    if (!newSubjectName.trim()) return;
    props.onAddSubject(newSubjectName, timeSlots);
    setNewSubjectName('');
    setTimeSlots([createDefaultTimeSlot()]);
  };

  const closeModal = () => {
    setNewSubjectName('');
    setTimeSlots([createDefaultTimeSlot()]);
    props.onCloseAddModal();
  };

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={[props.styles.desktopPage, props.compact && props.styles.desktopPageCompact]}>
      {props.addModalOpen ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: 440, maxHeight: '85%', backgroundColor: '#fff', borderRadius: 16, padding: 32, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 12 }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#222', marginBottom: 24 }}>새 수업 추가</Text>
            
            <ScrollView showsVerticalScrollIndicator={false} style={{ marginBottom: 24 }}>
              <View style={{ marginBottom: 20 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#888', marginBottom: 8 }}>수업명</Text>
                <TextInput 
                  style={{ backgroundColor: '#f5f6f8', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#222' }} 
                  placeholder="예: 컴퓨터네트워크" 
                  placeholderTextColor="#bbb"
                  value={newSubjectName}
                  onChangeText={setNewSubjectName}
                />
              </View>

              <Text style={{ fontSize: 14, fontWeight: '600', color: '#888', marginBottom: 8 }}>시간 및 장소</Text>
              {timeSlots.map((slot) => (
                <View key={slot.id} style={{ backgroundColor: '#f5f6f8', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {DAYS_OPTIONS.map(d => (
                        <Pressable 
                          key={d.id} 
                          onPress={() => updateTimeSlot(slot.id, 'day', d.id)}
                          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: slot.day === d.id ? '#FF5252' : '#e4e6e9', justifyContent: 'center', alignItems: 'center' }}
                        >
                          <Text style={{ fontSize: 14, fontWeight: '600', color: slot.day === d.id ? '#fff' : '#666' }}>{d.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {timeSlots.length > 1 && (
                      <Pressable onPress={() => removeTimeSlot(slot.id)} style={{ padding: 4 }}>
                        <Text style={{ fontSize: 20, color: '#aaa', lineHeight: 22 }}>×</Text>
                      </Pressable>
                    )}
                  </View>
                  
                  <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                    <TextInput 
                      style={{ flex: 1, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#222', borderWidth: 1, borderColor: '#eee' }} 
                      placeholder="시작 (09:00)" 
                      placeholderTextColor="#bbb"
                      value={slot.start}
                      onChangeText={(t) => updateTimeSlot(slot.id, 'start', t)}
                    />
                    <Text style={{ color: '#aaa', alignSelf: 'center' }}>~</Text>
                    <TextInput 
                      style={{ flex: 1, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#222', borderWidth: 1, borderColor: '#eee' }} 
                      placeholder="종료 (10:30)" 
                      placeholderTextColor="#bbb"
                      value={slot.end}
                      onChangeText={(t) => updateTimeSlot(slot.id, 'end', t)}
                    />
                  </View>
                  <TextInput 
                    style={{ backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#222', borderWidth: 1, borderColor: '#eee' }} 
                    placeholder="장소 (예: 301관)" 
                    placeholderTextColor="#bbb"
                    value={slot.location}
                    onChangeText={(t) => updateTimeSlot(slot.id, 'location', t)}
                  />
                </View>
              ))}
              
              <Pressable onPress={addTimeSlot} style={{ alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#f0f2f5' }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#555' }}>+ 시간/장소 추가</Text>
              </Pressable>
            </ScrollView>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
              <Pressable onPress={closeModal} style={{ paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#f0f2f5' }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#666' }}>취소</Text>
              </Pressable>
              <Pressable onPress={handleSave} style={{ paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#FF5252' }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#fff' }}>저장</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      <View style={[props.styles.desktopHeader, props.compact && props.styles.desktopHeaderCompact, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
        <View>
          <Text style={props.styles.desktopCaption}>{props.semester.label}</Text>
          <Text style={[props.styles.desktopTitle, props.compact && props.styles.desktopTitleCompact]}>시간표</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={props.onOpenAddModal} style={[props.styles.heroIcon, { width: 36, height: 36, backgroundColor: '#f2f2f7', borderRadius: 18 }]}>
            <Text style={{ fontSize: 20, color: '#333', fontWeight: '400', lineHeight: 22, marginTop: -2 }}>＋</Text>
          </Pressable>
          <Pressable style={[props.styles.heroIcon, { width: 36, height: 36, backgroundColor: props.editMode ? '#e5e5ea' : '#f2f2f7', borderRadius: 18 }]} onPress={props.onToggleEditMode}>
            <GearIcon styles={props.styles} />
          </Pressable>
        </View>
      </View>

      <DesktopTimetableBoard
        semester={props.semester}
        subjects={props.subjects}
        hours={hours}
        rowHeight={rowHeight}
        compact={props.compact}
        editMode={props.editMode}
        onOpenSubject={props.onOpenSubject}
        onRemoveSubject={props.onRemoveSubject}
        styles={props.styles}
      />
    </ScrollView>
  );
}
