import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar as NativeStatusBar, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BackendApiError, loginBackendUser, registerBackendUser, setBackendAuthToken } from '../services/backend-api';
import { S } from '../styles';
import { saveAuthSession } from './auth-storage';
import { resolveBackendHttpUrl } from './backend-url';
import type { AuthSession } from './types';

export function LoginScreen(props: {
  onLogin: (session: AuthSession) => void;
}) {
  const isWeb = Platform.OS === 'web';
  const { width } = useWindowDimensions();
  const useWideWebLayout = isWeb && width >= 900;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [studyDataConsent, setStudyDataConsent] = useState(false);
  const backendUrl = resolveBackendHttpUrl();

  const getAuthErrorMessage = (err: unknown) => {
    if (err instanceof BackendApiError) {
      if (err.detail) return err.detail;
      if (err.message === 'Backend server is unreachable.') {
        return `서버에 연결할 수 없습니다. 현재 주소: ${backendUrl}`;
      }
      if (err.message === 'Backend request timed out.') {
        return `서버와의 응답 시간이 초과됐습니다. 현재 주소를 확인해주세요: ${backendUrl}`;
      }
      if (err.message === 'Backend URL is not configured.') {
        return '백엔드 주소가 설정되지 않았습니다.';
      }
      if (err.status) return `로그인 요청에 실패했습니다. (${err.status})`;
      return err.message;
    }
    if (err instanceof Error && err.message) return err.message;
    return mode === 'register' ? '회원가입에 실패했습니다.' : '로그인에 실패했습니다.';
  };

  const submit = async () => {
    const normalizedLoginId = email.trim();
    if (!normalizedLoginId || !password.trim()) {
      setError('아이디와 비밀번호를 입력해주세요.');
      return;
    }
    if (mode === 'register' && !name.trim()) {
      setError('이름을 입력해주세요.');
      return;
    }
    if (mode === 'register' && !studyDataConsent) {
      setError('학습 데이터 활용 동의 후 회원가입을 진행해주세요.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = mode === 'register'
        ? await registerBackendUser({ email: normalizedLoginId, password, name })
        : await loginBackendUser({ email: normalizedLoginId, password });
      const session: AuthSession = {
        accessToken: result.access_token,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          provider: 'email',
        },
      };
      setBackendAuthToken(session.accessToken);
      props.onLogin(session);
      void saveAuthSession(session).catch(() => undefined);
    } catch (err: any) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={S.safe} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <NativeStatusBar barStyle="dark-content" />
        <KeyboardAvoidingView style={S.loginScreen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
          <ScrollView
            contentContainerStyle={S.loginScreenContent}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
          >
            <View style={[S.loginCard, useWideWebLayout && S.webLoginCard]}>
              {useWideWebLayout ? (
                <View style={S.webLoginIntro}>
                  <Text style={S.webLoginEyebrow}>B-SNAP WEB</Text>
                  <Text style={S.webLoginHeadline}>강의자료에서 바로 이어지는 나만의 학습 노트.</Text>
                  <Text style={S.webLoginBody}>
                    PDF, 판서, 캡처, Canvas Note를 한 작업공간에서 이어서 정리하세요.
                  </Text>
                  <View style={S.webLoginPreviewCard}>
                    <View style={S.webLoginPreviewHeader}>
                      <View style={S.webLoginPreviewDot} />
                      <Text style={S.webLoginPreviewTitle}>컴퓨터네트워크</Text>
                      <Text style={S.webLoginPreviewStatus}>저장됨</Text>
                    </View>
                    <View style={S.webLoginPreviewBody}>
                      <View style={S.webLoginPreviewPdf}>
                        <View style={S.webLoginPreviewPdfLineLarge} />
                        <View style={S.webLoginPreviewPdfLine} />
                        <View style={S.webLoginPreviewPdfLineShort} />
                      </View>
                      <View style={S.webLoginPreviewNote}>
                        <Text style={S.webLoginPreviewNoteTitle}>Canvas Note</Text>
                        <View style={S.webLoginPreviewNoteLine} />
                        <View style={S.webLoginPreviewNoteLineShort} />
                        <View style={S.webLoginPreviewChipRow}>
                          <Text style={S.webLoginPreviewChip}>AI 정리</Text>
                          <Text style={S.webLoginPreviewChip}>복습</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                  <View style={S.webLoginFeatureList}>
                    {['과목별 PDF 보관', 'Canvas AI 필기 정리', '캡처와 복습 흐름'].map((item) => (
                      <View key={item} style={S.webLoginFeatureRow}>
                        <View style={S.webLoginFeatureDot} />
                        <Text style={S.webLoginFeatureText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              <View style={useWideWebLayout ? S.webLoginForm : S.loginForm}>
                <View style={S.loginHeaderRow}>
                  <View style={S.loginLogoWrap}>
                    <Image source={require('../../assets/icon.png')} style={S.loginLogoImage} resizeMode="contain" />
                  </View>
                  <View style={S.loginHeaderCopy}>
                    <Text style={S.loginTitle}>B-SNAP</Text>
                    <Text style={S.loginSubtitle}>학습 작업공간에 로그인하세요.</Text>
                  </View>
                </View>

                <View style={S.loginToggleRow}>
                  <Pressable onPress={() => setMode('login')} style={[S.loginToggleButton, mode === 'login' && S.loginToggleButtonActive]}>
                    <Text style={[S.loginToggleText, mode === 'login' && S.loginToggleTextActive]}>로그인</Text>
                  </Pressable>
                  <Pressable onPress={() => setMode('register')} style={[S.loginToggleButton, mode === 'register' && S.loginToggleButtonActive]}>
                    <Text style={[S.loginToggleText, mode === 'register' && S.loginToggleTextActive]}>회원가입</Text>
                  </Pressable>
                </View>

                {mode === 'register' ? (
                  <View style={S.loginFieldGroup}>
                    <Text style={S.loginLabel}>이름</Text>
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      placeholder="이름"
                      placeholderTextColor="#9FA7B5"
                      autoCorrect={false}
                      autoCapitalize="words"
                      returnKeyType="next"
                      showSoftInputOnFocus
                      style={S.loginInput}
                    />
                  </View>
                ) : null}
                <View style={S.loginFieldGroup}>
                  <Text style={S.loginLabel}>아이디</Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="username"
                    autoComplete="username"
                    placeholder="ID"
                    placeholderTextColor="#9FA7B5"
                    returnKeyType="next"
                    showSoftInputOnFocus
                    style={S.loginInput}
                  />
                </View>
                <View style={S.loginFieldGroup}>
                  <Text style={S.loginLabel}>비밀번호</Text>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    placeholder="Password"
                    placeholderTextColor="#9FA7B5"
                    returnKeyType="done"
                    onSubmitEditing={submit}
                    showSoftInputOnFocus
                    style={S.loginInput}
                  />
                  <Text style={S.loginFieldHelp}>개인정보 보호를 위해 8자 이상, 영문과 숫자 조합을 권장합니다.</Text>
                </View>

                {error ? <Text style={S.loginError}>{error}</Text> : null}

                {mode === 'register' ? (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: studyDataConsent }}
                    onPress={() => setStudyDataConsent((value) => !value)}
                    style={[S.loginConsentBox, studyDataConsent && S.loginConsentBoxActive]}
                  >
                    <View style={[S.loginConsentCheck, studyDataConsent && S.loginConsentCheckActive]}>
                      <Text style={S.loginConsentCheckText}>{studyDataConsent ? '✓' : ''}</Text>
                    </View>
                    <Text style={S.loginConsentText}>
                      중요 페이지 추천과 학습 품질 향상을 위해 자료명, 페이지 정보, 필기·하이라이트·북마크·질문 등 학습 활동 데이터가 비식별화 및 집계된 형태로 활용될 수 있음에 동의합니다.
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  style={[S.loginButton, (loading || (mode === 'register' && !studyDataConsent)) && S.loginButtonDisabled]}
                  onPress={submit}
                  disabled={loading || (mode === 'register' && !studyDataConsent)}
                >
                  <Text style={S.loginButtonText}>{loading ? '처리 중...' : mode === 'register' ? '회원가입' : '로그인'}</Text>
                </Pressable>

                <Text style={S.loginHint}>Backend: {backendUrl}</Text>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
