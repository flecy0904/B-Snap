import { BackendApiError } from '../../../services/backend-api';

export function getAiBackendErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof BackendApiError) {
    const detail = error.detail?.toLowerCase() ?? '';

    if (error.message === 'Backend request timed out.') {
      return 'AI 응답 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.';
    }

    if (error.status === null) {
      return '백엔드 서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.';
    }

    if (detail.includes('openai_api_key') || detail.includes('api key')) {
      return 'API Key를 확인해 주세요.';
    }

    if (error.status === 502 || detail.includes('openai') || detail.includes('gemini')) {
      return 'AI 제공자 응답을 받아오지 못했습니다. API 키, 결제/사용량 한도, 모델 설정을 확인해 주세요.';
    }

    if (error.status >= 500) {
      return 'DB 연결 상태를 확인해 주세요.';
    }
  }

  return fallbackMessage;
}
