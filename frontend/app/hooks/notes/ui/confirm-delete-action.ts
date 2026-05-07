import { Alert, Platform } from 'react-native';

export function confirmDeleteAction(params: {
  title: string;
  message: string;
  confirmText: string;
  onConfirm: () => void;
}) {
  if (Platform.OS === 'web') {
    const confirmed = typeof globalThis.confirm === 'function'
      ? globalThis.confirm(`${params.title}\n\n${params.message}`)
      : false;
    if (confirmed) params.onConfirm();
    return;
  }

  Alert.alert(
    params.title,
    params.message,
    [
      { text: '취소', style: 'cancel' },
      { text: params.confirmText, style: 'destructive', onPress: params.onConfirm },
    ],
  );
}
