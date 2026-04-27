import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image, Platform, Pressable, StatusBar as NativeStatusBar, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { S } from '../styles';
import type { AuthUser } from './types';

export function LoginScreen(props: {
  onLogin: (user: AuthUser) => void;
}) {
  const isWeb = Platform.OS === 'web';
  const [email, setEmail] = useState('student@b-snap.app');
  const [password, setPassword] = useState('bsnap1234');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password.trim()) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }

    setError(null);
    props.onLogin({
      id: 'mock-user',
      email: normalizedEmail,
      provider: 'email',
    });
  };

  const loginWithProvider = (provider: AuthUser['provider']) => {
    if (provider === 'email') {
      submit();
      return;
    }

    setError(null);
    props.onLogin({
      id: `mock-${provider}-user`,
      email: `${provider}@b-snap.app`,
      provider,
    });
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={S.safe} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <NativeStatusBar barStyle="dark-content" />
        <View style={S.loginScreen}>
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
            <View style={isWeb ? S.webLoginForm : null}>
              <View style={S.loginLogoWrap}>
                <Image source={require('../../assets/icon.png')} style={S.loginLogoImage} resizeMode="contain" />
              </View>
              <Text style={S.loginTitle}>B-SNAP</Text>
              <Text style={S.loginSubtitle}>수업 자료와 노트를 한 번에 정리하세요.</Text>

              <View style={S.loginFieldGroup}>
                <Text style={S.loginLabel}>이메일</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="student@b-snap.app"
                  placeholderTextColor="#B8BFCC"
                  style={S.loginInput}
                />
              </View>
              <View style={S.loginFieldGroup}>
                <Text style={S.loginLabel}>비밀번호</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="비밀번호"
                  placeholderTextColor="#B8BFCC"
                  style={S.loginInput}
                />
              </View>

              {error ? <Text style={S.loginError}>{error}</Text> : null}

              <Pressable style={S.loginButton} onPress={submit}>
                <Text style={S.loginButtonText}>로그인</Text>
              </Pressable>

              <View style={S.loginDividerRow}>
                <View style={S.loginDividerLine} />
                <Text style={S.loginDividerText}>또는</Text>
                <View style={S.loginDividerLine} />
              </View>

              <Pressable style={S.socialLoginButton} onPress={() => loginWithProvider('google')}>
                <View style={[S.socialLoginMark, S.socialLoginMarkGoogle]}>
                  <Text style={S.socialLoginMarkText}>G</Text>
                </View>
                <Text style={S.socialLoginButtonText}>Google로 계속하기</Text>
              </Pressable>
              <Pressable style={S.socialLoginButton} onPress={() => loginWithProvider('naver')}>
                <View style={[S.socialLoginMark, S.socialLoginMarkNaver]}>
                  <Text style={S.socialLoginMarkText}>N</Text>
                </View>
                <Text style={S.socialLoginButtonText}>Naver로 계속하기</Text>
              </Pressable>
              <Pressable style={S.socialLoginButton} onPress={() => loginWithProvider('kakao')}>
                <View style={[S.socialLoginMark, S.socialLoginMarkKakao]}>
                  <Text style={S.socialLoginMarkKakaoText}>K</Text>
                </View>
                <Text style={S.socialLoginButtonText}>Kakao로 계속하기</Text>
              </Pressable>
              <Text style={S.loginHint}>현재는 mock 로그인으로 메인 앱에 진입합니다.</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
