import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { cleanAiDisplayText } from '../../../ui-helpers';
import { PageReferenceText } from './page-reference-text';

type AiResponseContentProps = {
  content: string;
  pageCount?: number | null;
  styles: any;
  textStyle?: any;
  linkStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
};

type TextBlock = {
  type: 'text';
  lines: string[];
};

type RecommendationItem = {
  pageNumber: number;
  body: string;
};

type RecommendationBlock = {
  type: 'recommendations';
  items: RecommendationItem[];
};

type SectionBlock = {
  type: 'section';
  title: string;
  lines: string[];
};

type AiContentBlock = TextBlock | RecommendationBlock | SectionBlock;

const RECOMMENDATION_HEADING_PATTERN = /^\s*(추천\s*페이지|먼저\s*볼\s*페이지|중요\s*페이지)\s*[:：]?\s*$/i;
const RECOMMENDATION_LINE_PATTERN = /^\s*(?:[•*-]\s*)?(\d{1,3})\s*(?:페이지|쪽|p(?:age)?\.?)\s*[:：-]\s*(.+)$/i;
const SECTION_HEADING_PATTERN = /^\s*(추천\s*이유|이유|근거|복습\s*순서|공부\s*순서|시험\s*포인트|핵심\s*포인트|다음\s*단계|먼저\s*볼\s*내용|정리)\s*[:：]?\s*$/i;
const INLINE_SECTION_PATTERN = /^\s*(추천\s*이유|이유|근거|복습\s*순서|공부\s*순서|시험\s*포인트|핵심\s*포인트|다음\s*단계|먼저\s*볼\s*내용|정리)\s*[:：]\s*(.+)$/i;

function normalizeAiLine(line: string) {
  return line.replace(/^\s*[*-]\s+/, '• ').trimEnd();
}

function parseRecommendationLine(line: string): RecommendationItem | null {
  const match = normalizeAiLine(line).match(RECOMMENDATION_LINE_PATTERN);
  if (!match) return null;

  const pageNumber = Number(match[1]);
  const body = match[2]?.trim();
  if (!Number.isFinite(pageNumber) || !body) return null;
  return { pageNumber, body };
}

function parseSectionHeading(line: string) {
  const normalized = normalizeAiLine(line);
  const inlineMatch = normalized.match(INLINE_SECTION_PATTERN);
  if (inlineMatch) {
    return { title: inlineMatch[1].replace(/\s+/g, ' '), firstLine: inlineMatch[2].trim() };
  }

  const headingMatch = normalized.match(SECTION_HEADING_PATTERN);
  if (headingMatch) {
    return { title: headingMatch[1].replace(/\s+/g, ' '), firstLine: null };
  }

  return null;
}

function pushTextBlock(blocks: AiContentBlock[], lines: string[]) {
  const hasContent = lines.some((line) => line.trim());
  if (!hasContent) return;
  blocks.push({ type: 'text', lines: [...lines] });
}

function parseAiContent(content: string): AiContentBlock[] {
  const lines = cleanAiDisplayText(content).replace(/\r\n/g, '\n').split('\n');
  const blocks: AiContentBlock[] = [];
  let textLines: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = normalizeAiLine(lines[index]);
    const recommendation = parseRecommendationLine(line);
    const startsRecommendationSection = RECOMMENDATION_HEADING_PATTERN.test(line);
    const sectionHeading = parseSectionHeading(line);

    if (startsRecommendationSection || recommendation) {
      pushTextBlock(blocks, textLines);
      textLines = [];

      const items: RecommendationItem[] = [];
      if (recommendation) items.push(recommendation);
      index += 1;

      while (index < lines.length) {
        const nextLine = normalizeAiLine(lines[index]);
        if (!nextLine.trim()) {
          index += 1;
          if (items.length) break;
          continue;
        }

        const nextRecommendation = parseRecommendationLine(nextLine);
        if (!nextRecommendation) break;
        items.push(nextRecommendation);
        index += 1;
      }

      if (items.length) {
        blocks.push({ type: 'recommendations', items });
        continue;
      }

      if (startsRecommendationSection) textLines.push(line);
      continue;
    }

    if (sectionHeading) {
      pushTextBlock(blocks, textLines);
      textLines = [];

      const sectionLines = sectionHeading.firstLine ? [sectionHeading.firstLine] : [];
      index += 1;

      while (index < lines.length) {
        const nextLine = normalizeAiLine(lines[index]);
        if (parseRecommendationLine(nextLine) || RECOMMENDATION_HEADING_PATTERN.test(nextLine) || parseSectionHeading(nextLine)) break;
        sectionLines.push(nextLine);
        index += 1;
      }

      if (sectionLines.some((value) => value.trim())) {
        blocks.push({ type: 'section', title: sectionHeading.title, lines: sectionLines });
      }
      continue;
    }

    textLines.push(line);
    index += 1;
  }

  pushTextBlock(blocks, textLines);
  return blocks.length ? blocks : [{ type: 'text', lines }];
}

function renderTextBlock(props: {
  block: TextBlock;
  blockIndex: number;
  pageCount?: number | null;
  styles: any;
  textStyle?: any;
  linkStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
}) {
  return props.block.lines
    .join('\n')
    .split(/\n{2,}/)
    .map((paragraph, paragraphIndex) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, paragraphIndex) => (
      <View key={`text-${props.blockIndex}-${paragraphIndex}`} style={props.styles.aiStructuredParagraph}>
        <PageReferenceText
          content={paragraph}
          pageCount={props.pageCount}
          textStyle={props.textStyle}
          linkStyle={props.linkStyle}
          onOpenPage={props.onOpenPage}
        />
      </View>
    ));
}

function getSectionIcon(title: string): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  if (title.includes('순서') || title.includes('단계')) return 'format-list-numbered';
  if (title.includes('시험')) return 'school-outline';
  if (title.includes('이유') || title.includes('근거')) return 'lightbulb-on-outline';
  return 'text-box-check-outline';
}

export function AiResponseContent({
  content,
  pageCount,
  styles,
  textStyle,
  linkStyle,
  onOpenPage,
}: AiResponseContentProps) {
  const maxPage = pageCount && pageCount > 0 ? pageCount : Number.POSITIVE_INFINITY;
  const blocks = React.useMemo(() => parseAiContent(content), [content]);

  return (
    <View style={styles.aiStructuredContent}>
      {blocks.map((block, blockIndex) => {
        if (block.type === 'text') {
          return renderTextBlock({
            block,
            blockIndex,
            pageCount,
            styles,
            textStyle,
            linkStyle,
            onOpenPage,
          });
        }

        if (block.type === 'section') {
          return (
            <View key={`section-${blockIndex}-${block.title}`} style={styles.aiStructuredSectionCard}>
              <View style={styles.aiStructuredSectionHeader}>
                <View style={styles.aiStructuredSectionIcon}>
                  <MaterialCommunityIcons name={getSectionIcon(block.title)} size={14} color="#4F68D2" />
                </View>
                <Text style={styles.aiStructuredSectionTitle}>{block.title}</Text>
              </View>
              <PageReferenceText
                content={block.lines.join('\n').trim()}
                pageCount={pageCount}
                textStyle={textStyle}
                linkStyle={linkStyle}
                onOpenPage={onOpenPage}
              />
            </View>
          );
        }

        return (
          <View key={`recommendations-${blockIndex}`} style={styles.aiPageRecommendationGroup}>
            <View style={styles.aiPageRecommendationHeader}>
              <MaterialCommunityIcons name="star-four-points" size={13} color="#5F79FF" />
              <Text style={styles.aiPageRecommendationTitle}>추천 페이지</Text>
            </View>
            <View style={styles.aiPageRecommendationList}>
              {block.items.map((item) => {
                const canOpen = Boolean(onOpenPage) && item.pageNumber >= 1 && item.pageNumber <= maxPage;
                return (
                  <Pressable
                    key={`${blockIndex}-${item.pageNumber}-${item.body}`}
                    style={styles.aiPageRecommendationItem}
                    onPress={canOpen ? () => onOpenPage?.(item.pageNumber) : undefined}
                    disabled={!canOpen}
                  >
                    <View style={styles.aiPageRecommendationPill}>
                      <Text style={styles.aiPageRecommendationPillText}>{item.pageNumber}p</Text>
                    </View>
                    <Text style={styles.aiPageRecommendationBody}>{item.body}</Text>
                    {canOpen ? (
                      <MaterialCommunityIcons name="chevron-right" size={16} color="#9AA5B7" />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}
