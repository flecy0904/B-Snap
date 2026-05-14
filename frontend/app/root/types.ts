export interface AuthUser {
  id: number;
  email: string;
  name: string;
  provider: 'email';
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}
