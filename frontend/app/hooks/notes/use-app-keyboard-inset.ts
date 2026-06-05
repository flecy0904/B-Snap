import React from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

function getKeyboardOverlap(event: any) {
  const windowHeight = Dimensions.get('window').height;
  const screenY = event?.endCoordinates?.screenY;
  const keyboardHeight = Number(event?.endCoordinates?.height ?? 0);
  const keyboardBottom = typeof screenY === 'number' && keyboardHeight > 0 ? screenY + keyboardHeight : null;
  const coordinateHeight = Math.max(windowHeight, keyboardBottom ?? windowHeight);
  const rawOverlap = typeof screenY === 'number'
    ? Math.max(0, coordinateHeight - screenY)
    : Math.max(0, keyboardHeight);
  const maxUsefulOverlap = Math.floor(windowHeight * 0.72);
  return Math.min(rawOverlap, maxUsefulOverlap);
}

export function useAppKeyboardInset(enabled: boolean) {
  const [keyboardInset, setKeyboardInset] = React.useState(0);

  React.useEffect(() => {
    if (!enabled || Platform.OS === 'web') {
      setKeyboardInset(0);
      return undefined;
    }

    const updateInset = (event: any) => {
      setKeyboardInset(getKeyboardOverlap(event));
    };
    const clearInset = () => setKeyboardInset(0);
    const listeners = Platform.OS === 'ios'
      ? [
          Keyboard.addListener('keyboardWillChangeFrame', updateInset),
          Keyboard.addListener('keyboardWillHide', clearInset),
          Keyboard.addListener('keyboardDidHide', clearInset),
        ]
      : [
          Keyboard.addListener('keyboardDidShow', updateInset),
          Keyboard.addListener('keyboardDidHide', clearInset),
        ];

    return () => {
      listeners.forEach((listener) => listener.remove());
    };
  }, [enabled]);

  return keyboardInset;
}
