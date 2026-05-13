import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar as NativeStatusBar, Text, TextInput, View } from 'react-native';
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backendUrl = resolveBackendHttpUrl();

  const getAuthErrorMessage = (err: unknown) => {
    if (err instanceof BackendApiError) {
      if (err.detail) return err.detail;
      if (err.message === 'Backend server is unreachable.') {
        return `백엔드 서버에 연결할 수 없습니다. 현재 주소: ${backendUrl}`;
      }
      if (err.message === 'Backend request timed out.') {
        return `백엔드 응답 시간이 초과됐습니다. 현재 주소를 확인해주세요: ${backendUrl}`;
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
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View style={[S.loginCard, isWeb && S.webLoginCard]}>
              {isWeb ? (
                <View style={S.webLoginIntro}>
                  <Text style={S.webLoginEyebrow}>B-SNAP WEB</Text>
                  <Text style={S.webLoginHeadline}>수업 자료와 노트를 브라우저에서 바로 정리하세요.</Text>
                  <Text style={S.webLoginBody}>시간표, 캡처, PDF 정리, AI 요약 흐름을 데스크톱 작업공간처럼 구성한 웹 프리뷰입니다.</Text>
                  <View style={S.webLoginFeatureList}>
                    {['과목별 작업공간', 'PDF + 판서 정리 흐름', '실시간 캡처 inbox'].map((item) => (
                      <View key={item} style={S.webLoginFeatureRow}>
                        <View style={S.webLoginFeatureDot} />
                        <Text style={S.webLoginFeatureText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              <View style={isWeb ? S.webLoginForm : S.loginForm}>
                <View style={S.loginLogoWrap}>
                  <Image source={require('../../assets/icon.png')} style={S.loginLogoImage} resizeMode="contain" />
                </View>
                <Text style={S.loginTitle}>B-SNAP</Text>
                <Text style={S.loginSubtitle}>계정별로 자료와 필기를 분리해서 저장합니다.</Text>

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
                    placeholder="아이디"
                    placeholderTextColor="#9FA7B5"
                    returnKeyType="next"
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
                    placeholder="비밀번호"
                    placeholderTextColor="#9FA7B5"
                    returnKeyType="done"
                    onSubmitEditing={submit}
                    style={S.loginInput}
                  />
                  <Text style={S.loginFieldHelp}>8자 이상, 영문과 숫자 조합을 권장합니다.</Text>
                </View>

                {error ? <Text style={S.loginError}>{error}</Text> : null}

                <Pressable style={S.loginButton} onPress={submit} disabled={loading}>
                  <Text style={S.loginButtonText}>{loading ? '처리 중...' : mode === 'register' ? '회원가입' : '로그인'}</Text>
                </Pressable>

                <Text style={S.loginHint}>계정별로 업로드, 필기, AI 채팅 데이터가 분리됩니다.</Text>
                <Text style={S.loginHint}>Backend: {backendUrl}</Text>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
