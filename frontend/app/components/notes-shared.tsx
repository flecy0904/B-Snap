import React, { memo } from 'react';
import { Text, View } from 'react-native';
import { Path } from 'react-native-svg';
import { NoteEntry, NoteSummarySection, Subject } from '../types';
import { InkPoint, InkStroke, SelectionRect } from '../ui-types';

/**
 * Converts a set of points into a smooth SVG path string using Quadratic Bezier curves.
 */
export function getStrokePath(points: InkPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    path += ` Q ${points[i].x} ${points[i].y}, ${midX} ${midY}`;
  }

  const lastPoint = points[points.length - 1];
  path += ` L ${lastPoint.x} ${lastPoint.y}`;

  return path;
}

export const StaticStrokes = memo(({ strokes }: { strokes: InkStroke[] }) => {
  return (
    <>
      {strokes.map((stroke) => (
        <Path
          key={stroke.id}
          d={getStrokePath(stroke.points)}
          stroke={stroke.color}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </>
  );
});

export function buildAiResponse(question: string, selectionRect: SelectionRect | null, desktop: boolean) {
  const normalizedQuestion = question.trim();
  const isGraphMeaningQuestion =
    normalizedQuestion.includes('그래프') && (normalizedQuestion.includes('의미') || normalizedQuestion.includes('뭐야'));
  const isExamQuestion = normalizedQuestion.includes('시험');
  const isConceptQuestion = normalizedQuestion.includes('개념') || normalizedQuestion.includes('3개');
  const aiResponse = !selectionRect
    ? '먼저 선택 모드로 문서 영역을 드래그해 주세요.'
    : isGraphMeaningQuestion
      ? desktop
        ? '이 그래프는 트래픽 강도 La/R가 증가할수록 평균 큐잉 지연이 어떻게 변하는지를 보여줍니다. La/R가 작은 구간에서는 지연이 거의 없지만, 값이 커질수록 대기열이 쌓이며 지연도 함께 증가합니다. 특히 1에 가까워질수록 그래프가 급격히 치솟는데, 이는 네트워크가 한계 용량에 가까워질수록 작은 부하 증가만으로도 혼잡이 크게 심해질 수 있음을 의미합니다.'
        : '이 그래프는 트래픽 강도 La/R가 증가할수록 평균 큐잉 지연이 어떻게 변하는지를 보여줍니다. La/R가 작을 때는 지연이 거의 없지만, 1에 가까워질수록 평균 지연은 급격히 증가합니다.'
      : isExamQuestion
        ? desktop
          ? '시험 대비 관점에서는 La/R와 큐잉 지연의 관계를 이해하는 것이 핵심입니다. La/R가 1에 가까워질수록 평균 지연이 급격히 증가하고, 1을 넘으면 처리량보다 더 많은 패킷이 들어와 큐가 계속 누적됩니다. 즉 이 그래프는 네트워크 혼잡이 임계점 근처에서 왜 빠르게 악화되는지를 설명합니다.'
          : '시험 대비 관점에서는 La/R와 큐잉 지연의 관계를 이해하는 것이 핵심입니다. La/R가 1에 가까워질수록 지연이 급격히 커지고, 1을 넘으면 큐는 계속 누적됩니다.'
        : isConceptQuestion
          ? desktop
            ? '이 영역의 핵심 개념은 세 가지입니다. 첫째, La/R는 네트워크 부하를 나타내는 트래픽 강도입니다. 둘째, 트래픽 강도가 증가할수록 평균 큐잉 지연도 함께 증가합니다. 셋째, La/R가 1에 가까워지거나 이를 넘으면 큐가 빠르게 누적되어 혼잡이 급격히 심해집니다.'
            : '핵심 개념은 세 가지입니다. La/R는 트래픽 강도이고, 값이 커질수록 평균 큐잉 지연도 함께 증가합니다. 특히 1에 가까워지거나 이를 넘으면 혼잡이 빠르게 심해집니다.'
          : desktop
            ? '그래프 해석\n이 그래프는 트래픽 강도 La/R가 증가할수록 평균 큐잉 지연이 어떻게 변하는지를 보여준다. La/R가 작은 구간에서는 지연이 매우 작지만, 값이 커질수록 대기열이 쌓이기 시작하고 1에 가까워지면 평균 지연은 급격히 증가한다. La/R > 1이 되면 처리량보다 더 많은 패킷이 들어와 큐는 계속 누적된다.\n\n핵심 포인트\n중요한 점은 그래프가 직선이 아니라 오른쪽으로 갈수록 빠르게 상승하는 곡선이라는 것이다. 즉 네트워크는 한계 용량에 가까워질수록 작은 부하 증가만으로도 지연이 크게 늘어날 수 있으므로, La/R를 1보다 충분히 낮게 유지하는 것이 중요하다.'
            : '그래프 해석\n이 그래프는 트래픽 강도 La/R가 증가할수록 평균 큐잉 지연이 어떻게 변하는지를 보여준다. La/R가 작은 구간에서는 지연이 매우 작지만, 값이 커질수록 대기열이 쌓이기 시작하고 1에 가까워지면 평균 지연은 급격히 증가한다.\n\n핵심 포인트\n중요한 점은 그래프가 직선이 아니라 오른쪽으로 갈수록 빠르게 상승하는 곡선이라는 것이다. 즉 네트워크는 한계 용량에 가까워질수록 작은 부하 증가만으로도 지연이 크게 늘어날 수 있다.';

  const aiResponseSections = aiResponse.includes('\n\n')
    ? aiResponse.split('\n\n').map((section) => {
        const [title, ...bodyLines] = section.split('\n');
        return { title, body: bodyLines.join(' ').trim() };
      })
    : null;

  return { normalizedQuestion, aiResponse, aiResponseSections };
}

export function NoteSummaryContent(props: { note: NoteEntry; subject: Subject; styles: any }) {
  if (props.note.summarySections?.length) {
    return (
      <View>
        <Text style={props.styles.summaryTitle}>{props.note.title}</Text>
        <View style={[props.styles.summaryAccent, { backgroundColor: props.subject.color }]} />
        <Text style={props.styles.summaryIntro}>{props.note.preview}</Text>
        {props.note.summarySections.map((section, index) => (
          <View
            key={`${props.note.id}-${section.title}`}
            style={[
              props.styles.summarySectionBlock,
              index === props.note.summarySections!.length - 1 && props.styles.summarySectionBlockLast,
            ]}
          >
            <Text style={props.styles.summarySectionTitle}>{section.title}</Text>
            {section.tone === 'formula' ? (
              <View style={props.styles.summaryFormulaBox}>
                {section.body.split('\n').map((line) => (
                  <Text key={`${section.title}-${line}`} style={props.styles.summaryFormulaText}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : (
              <View>
                {section.body.split('\n').map((line) =>
                  line.startsWith('• ') ? (
                    <View key={`${section.title}-${line}`} style={props.styles.summaryBulletRow}>
                      <Text style={props.styles.summaryBulletDot}>•</Text>
                      <Text style={props.styles.summarySectionBody}>{line.slice(2)}</Text>
                    </View>
                  ) : (
                    <Text key={`${section.title}-${line}`} style={props.styles.summarySectionBody}>
                      {line}
                    </Text>
                  ),
                )}
              </View>
            )}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View>
      <Text style={props.styles.summaryTitle}>{props.note.title}</Text>
      <View style={[props.styles.summaryAccent, { backgroundColor: props.subject.color }]} />
      <Text style={props.styles.summaryLabel}>핵심 개념</Text>
      <View style={[props.styles.summaryBox, { backgroundColor: props.subject.bgColor }]}>
        <Text style={props.styles.summaryLead}>{props.note.preview}</Text>
      </View>
      <Text style={props.styles.summaryLabel}>요약</Text>
      {props.note.body.map((item, index) => (
        <View key={`${props.note.id}-${index}`} style={props.styles.summaryRow}>
          <View style={[props.styles.summaryBar, { backgroundColor: props.subject.color }]} />
          <Text style={props.styles.summaryBody}>{item}</Text>
        </View>
      ))}
      <Text style={props.styles.summaryLabel}>중요 포인트</Text>
      <View style={props.styles.keywordCard}>
        {props.note.keywords.map((keyword) => (
          <View key={keyword} style={props.styles.keywordRow}>
            <View style={props.styles.keywordDot} />
            <Text style={props.styles.keywordText}>{keyword}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function SummarySectionBlock(props: {
  section: NoteSummarySection;
  index: number;
  total: number;
  styles: any;
}) {
  return (
    <View
      style={[
        props.styles.summarySectionBlock,
        props.index === props.total - 1 && props.styles.summarySectionBlockLast,
      ]}
    >
      <Text style={props.styles.summarySectionTitle}>{props.section.title}</Text>
      {props.section.tone === 'formula' ? (
        <View style={props.styles.summaryFormulaBox}>
          {props.section.body.split('\n').map((line) => (
            <Text key={`${props.section.title}-${line}`} style={props.styles.summaryFormulaText}>
              {line}
            </Text>
          ))}
        </View>
      ) : (
        <View>
          {props.section.body.split('\n').map((line) =>
            line.startsWith('• ') ? (
              <View key={`${props.section.title}-${line}`} style={props.styles.summaryBulletRow}>
                <Text style={props.styles.summaryBulletDot}>•</Text>
                <Text style={props.styles.summarySectionBody}>{line.slice(2)}</Text>
              </View>
            ) : (
              <Text key={`${props.section.title}-${line}`} style={props.styles.summarySectionBody}>
                {line}
              </Text>
            ),
          )}
        </View>
      )}
    </View>
  );
}
