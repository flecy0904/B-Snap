import type { NoteSummarySection } from '../types';
import type { SelectionRect } from '../ui-types';

export type MockAiAnswer = {
  question: string;
  response: string;
  sections: NoteSummarySection[];
  createdAt: string;
};

function buildSections(question: string, selectionRect: SelectionRect | null, currentPageLabel: string): NoteSummarySection[] {
  const normalizedQuestion = question.trim();
  const selectedArea = selectionRect
    ? `${Math.round(selectionRect.width)} x ${Math.round(selectionRect.height)} 영역`
    : '현재 페이지 전체';

  if (normalizedQuestion.includes('시험')) {
    return [
      {
        title: '시험 포인트',
        body: `${currentPageLabel}의 ${selectedArea}에서 먼저 봐야 할 것은 개념 정의보다 조건과 결과의 연결입니다. 어떤 상황에서 식이나 그래프가 바뀌는지 설명할 수 있어야 합니다.`,
        tone: 'highlight',
      },
      {
        title: '암기보다 확인할 것',
        body: '기호의 의미, 단위, 증가/감소 방향, 예외 조건을 같이 적어두면 서술형과 계산형 모두에서 실수가 줄어듭니다.',
      },
    ];
  }

  if (normalizedQuestion.includes('개념') || normalizedQuestion.includes('3개')) {
    return [
      {
        title: '핵심 개념 3개',
        body: '첫째, 문제에서 쓰는 기준값을 먼저 잡습니다. 둘째, 기준값이 변할 때 결과가 어떻게 움직이는지 연결합니다. 셋째, 그 변화가 실제 예시에서 어떤 의미인지 한 문장으로 정리합니다.',
      },
      {
        title: '복습 질문',
        body: `${selectedArea}만 보고도 "왜 이 결과가 나오는가"를 설명할 수 있는지 확인하세요.`,
        tone: 'highlight',
      },
    ];
  }

  return [
    {
      title: '요약',
      body: `${currentPageLabel}의 ${selectedArea}를 기준으로 보면, 이 부분은 수업 흐름에서 앞 개념과 다음 적용 문제를 이어주는 중간 단계입니다.`,
    },
    {
      title: '다음 행동',
      body: '선택 영역 옆에 짧은 텍스트 메모를 붙이고, 관련 식이나 키워드는 형광펜으로 한 번 더 표시하는 것이 좋습니다.',
      tone: 'highlight',
    },
  ];
}

export async function requestMockAiAnswer(props: {
  question: string;
  selectionRect: SelectionRect | null;
  currentPageLabel: string;
}) {
  const question = props.question.trim() || '선택 영역 핵심만 요약해줘';
  const sections = buildSections(question, props.selectionRect, props.currentPageLabel);

  await new Promise((resolve) => setTimeout(resolve, 650));

  return {
    question,
    sections,
    response: sections.map((section) => `${section.title}\n${section.body}`).join('\n\n'),
    createdAt: new Date().toISOString(),
  } satisfies MockAiAnswer;
}
