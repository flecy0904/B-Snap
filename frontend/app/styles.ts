import { StyleSheet } from 'react-native';
import { C, sharedStyles } from './styles/shared';
import { scheduleStyles } from './styles/schedule';
import { notesStyles } from './styles/notes';
import { captureStyles } from './styles/capture';
import { profileStyles } from './styles/profile';

export { C };

const rawStyles = {
  ...sharedStyles,
  ...scheduleStyles,
  ...notesStyles,
  ...captureStyles,
  ...profileStyles,
};

export const S = StyleSheet.create(rawStyles as any);
