import { C } from './shared';

export const profileStyles = {
  profileCard: { flexDirection: 'row' as const, alignItems: 'center' as const, marginBottom: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECEEF5', borderRadius: 14, padding: 14 },
  profileAvatar: { width: 58, height: 58, borderRadius: 99, backgroundColor: '#EFF2FF', alignItems: 'center' as const, justifyContent: 'center' as const, marginRight: 14 },
  profileAvatarText: { color: C.blue, fontSize: 24, fontWeight: '700' as const },
  profileName: { fontSize: 16, fontWeight: '800' as const, color: C.text, marginBottom: 4 },
  profileDept: { fontSize: 12, color: '#A2A8B5', fontWeight: '600' as const, marginBottom: 10 },
  profileStats: { flexDirection: 'row' as const, gap: 14 },
  profileStat: { fontSize: 12, color: '#7F8897', fontWeight: '700' as const },
  settingsSection: { marginBottom: 18 },
  settingsTitle: { fontSize: 11, fontWeight: '800' as const, color: '#B2B8C5', marginBottom: 8 },
  settingsCard: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#ECEEF5', overflow: 'hidden' as const },
  settingsRow: { minHeight: 54, paddingHorizontal: 16, flexDirection: 'row' as const, alignItems: 'center' as const },
  settingsRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F0F2F7' },
  settingsLabel: { flex: 1, fontSize: 15, fontWeight: '700' as const, color: '#3A4250' },
  settingsValue: { fontSize: 13, color: '#A0A7B4', fontWeight: '700' as const },
  logoutButton: { height: 44, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: '#ECEEF5', backgroundColor: '#FFFFFF', marginTop: 8, marginBottom: 18 },
  logoutButtonText: { color: '#F16D6D', fontSize: 15, fontWeight: '800' as const },
  footerMeta: { textAlign: 'center' as const, color: '#D0D4DD', fontSize: 11, fontWeight: '600' as const, marginBottom: 2 },
};
