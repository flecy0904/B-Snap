export interface AuthUser {
  id: string;
  email: string;
  provider: 'email' | 'google' | 'naver' | 'kakao';
}
