import { BackendApiError } from '../../../services/backend-api';

export function getAiBackendErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof BackendApiError) {
    const detail = error.detail?.toLowerCase() ?? '';

    if (error.message === 'Backend request timed out.') {
      return 'AI에게서 응답이 없어요. 잠시 후 다시 시도해주세요.';
    }

    if (error.status === null) {
      return '서버에 연결할 수 없어요. 서버 연결 상태를 확인해주세요.';
    }

    if (detail.includes('openai_api_key') || detail.includes('api key')) {
      return 'Warn: Please identify the API key';
    }

    if (error.status === 502 || detail.includes('openai') || detail.includes('gemini')) {
      return 'Warn: API quoter is limited.';
    }

    if (error.status === 409 && detail.includes('canvas')) {
      return 'Canvas는 노트당 최대 3개까지 만들 수 있습니다.';
    }

    if (error.status >= 500) {
      return 'Warn: DB connection is lost.';
    }
  }

  return fallbackMessage;
}
