import React, { memo } from 'react';
import { Text, View } from 'react-native';
import { Path } from 'react-native-svg';
import { NoteEntry, NoteSummarySection, Subject } from '../../../types';
import { InkPoint, InkStroke, SelectionRect } from '../../../ui-types';

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
  const aiResponse = !selectionRect
    ? '먼저 선택 모드로 문서 영역을 드래그해 주세요.'
    : desktop
      ? '메시지를 보내면 선택 영역이나 현재 페이지를 바탕으로 백엔드 AI가 답변합니다.'
      : '응답 생성을 누르면 백엔드 AI가 답변합니다.';

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
