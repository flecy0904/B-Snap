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
  onRequestMoreRecommendations?: () => void;
  moreRecommendationsDisabled?: boolean;
};

type TextBlock = {
  type: 'text';
  lines: string[];
};

type RecommendationItem = {
  startPageNumber: number;
  endPageNumber: number;
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
const RECOMMENDATION_LINE_PATTERN = /^\s*(?:[•*-]\s*)?(?:\d+[.)]\s*)?(\d{1,3})(?:\s*[-~–—]\s*(\d{1,3}))?\s*(?:페이지|쪽|p(?:age)?\.?)\s*[:：-]\s*(.+)$/i;
const SECTION_HEADING_PATTERN = /^\s*(추천\s*이유|이유|근거|복습\s*순서|공부\s*순서|시험\s*포인트|핵심\s*포인트|다음\s*단계|먼저\s*볼\s*내용|정리)\s*[:：]?\s*$/i;
const INLINE_SECTION_PATTERN = /^\s*(추천\s*이유|이유|근거|복습\s*순서|공부\s*순서|시험\s*포인트|핵심\s*포인트|다음\s*단계|먼저\s*볼\s*내용|정리)\s*[:：]\s*(.+)$/i;
const MARKDOWN_HEADING_PATTERN = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const MARKDOWN_TABLE_DIVIDER_PATTERN = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const MARKDOWN_FENCE_PATTERN = /^\s*```/;
const MARKDOWN_RULE_PATTERN = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

function normalizeAiLine(line: string) {
  return line
    .replace(/^\s*[*-]\s+/, '• ')
    .replace(/^\s*\d+[.)]\s+/, (match) => match.trimEnd() + ' ')
    .trimEnd();
}

function parseRecommendationLine(line: string): RecommendationItem | null {
  const match = normalizeAiLine(line).match(RECOMMENDATION_LINE_PATTERN);
  if (!match) return null;

  const startPageNumber = Number(match[1]);
  const rawEndPageNumber = match[2] ? Number(match[2]) : startPageNumber;
  const body = match[3]?.trim();
  if (!Number.isFinite(startPageNumber) || !Number.isFinite(rawEndPageNumber) || !body) return null;
  const endPageNumber = Math.max(startPageNumber, rawEndPageNumber);
  return { startPageNumber, endPageNumber, body };
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
  return renderStructuredLines({
    content: props.block.lines.join('\n'),
    keyPrefix: `text-${props.blockIndex}`,
    pageCount: props.pageCount,
    styles: props.styles,
    textStyle: props.textStyle,
    linkStyle: props.linkStyle,
    onOpenPage: props.onOpenPage,
  });
}

function splitMarkdownTableRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return [];
  const withoutOuterPipes = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return withoutOuterPipes.split('|').map((cell) => cell.trim());
}

function readMarkdownTable(lines: string[], startIndex: number) {
  if (startIndex + 1 >= lines.length) return null;
  const headerCells = splitMarkdownTableRow(lines[startIndex]);
  if (headerCells.length < 2 || !MARKDOWN_TABLE_DIVIDER_PATTERN.test(lines[startIndex + 1])) return null;

  const rows: string[][] = [headerCells];
  let index = startIndex + 2;
  while (index < lines.length) {
    const cells = splitMarkdownTableRow(lines[index]);
    if (cells.length !== headerCells.length) break;
    rows.push(cells);
    index += 1;
  }

  return rows.length > 1 ? { rows, nextIndex: index } : null;
}

function renderInlineText(params: {
  content: string;
  pageCount?: number | null;
  styles: any;
  textStyle?: any;
  linkStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
}) {
  return (
    <PageReferenceText
      content={params.content}
      pageCount={params.pageCount}
      textStyle={params.textStyle}
      linkStyle={params.linkStyle}
      inlineCodeStyle={params.styles.aiMarkdownInlineCode}
      onOpenPage={params.onOpenPage}
    />
  );
}

function renderMarkdownTable(params: {
  rows: string[][];
  keyPrefix: string;
  pageCount?: number | null;
  styles: any;
  linkStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
}) {
  return (
    <View key={params.keyPrefix} style={params.styles.aiMarkdownTable}>
      {params.rows.map((row, rowIndex) => (
        <View
          key={`${params.keyPrefix}-row-${rowIndex}`}
          style={[
            params.styles.aiMarkdownTableRow,
            rowIndex === 0 && params.styles.aiMarkdownTableHeaderRow,
            rowIndex === params.rows.length - 1 && params.styles.aiMarkdownTableLastRow,
          ]}
        >
          {row.map((cell, cellIndex) => (
            <View
              key={`${params.keyPrefix}-cell-${rowIndex}-${cellIndex}`}
              style={[
                params.styles.aiMarkdownTableCell,
                cellIndex === row.length - 1 && params.styles.aiMarkdownTableLastCell,
              ]}
            >
              <PageReferenceText
                content={cell}
                pageCount={params.pageCount}
                textStyle={[
                  params.styles.aiMarkdownTableText,
                  rowIndex === 0 && params.styles.aiMarkdownTableHeaderText,
                ]}
                linkStyle={params.linkStyle}
                inlineCodeStyle={params.styles.aiMarkdownInlineCode}
                onOpenPage={params.onOpenPage}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function renderStructuredLines(props: {
  content: string;
  keyPrefix: string;
  pageCount?: number | null;
  styles: any;
  textStyle?: any;
  linkStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
}) {
  const lines = props.content
    .replace(/\r\n/g, '\n')
    .split('\n');

  if (!lines.length) return null;

  const nodes: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = normalizeAiLine(rawLine).trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (MARKDOWN_FENCE_PATTERN.test(rawLine)) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !MARKDOWN_FENCE_PATTERN.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(
        <View key={`${props.keyPrefix}-code-${index}`} style={props.styles.aiMarkdownCodeBlock}>
          <Text style={props.styles.aiMarkdownCodeText}>{codeLines.join('\n').trimEnd()}</Text>
        </View>,
      );
      continue;
    }

    if (MARKDOWN_RULE_PATTERN.test(rawLine)) {
      nodes.push(<View key={`${props.keyPrefix}-rule-${index}`} style={props.styles.aiMarkdownRule} />);
      index += 1;
      continue;
    }

    const table = readMarkdownTable(lines, index);
    if (table) {
      nodes.push(renderMarkdownTable({
        rows: table.rows,
        keyPrefix: `${props.keyPrefix}-table-${index}`,
        pageCount: props.pageCount,
        styles: props.styles,
        linkStyle: props.linkStyle,
        onOpenPage: props.onOpenPage,
      }));
      index = table.nextIndex;
      continue;
    }

    const heading = line.match(MARKDOWN_HEADING_PATTERN);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      nodes.push(
        <View key={`${props.keyPrefix}-heading-${index}`} style={props.styles.aiMarkdownHeadingWrap}>
          <PageReferenceText
            content={heading[2]}
            pageCount={props.pageCount}
            textStyle={[
              props.styles.aiMarkdownHeading,
              level === 1 && props.styles.aiMarkdownHeading1,
              level === 2 && props.styles.aiMarkdownHeading2,
              level >= 3 && props.styles.aiMarkdownHeading3,
            ]}
            linkStyle={props.linkStyle}
            inlineCodeStyle={props.styles.aiMarkdownInlineCode}
            onOpenPage={props.onOpenPage}
          />
        </View>,
      );
      index += 1;
      continue;
    }

    const quote = line.match(/^>\s*(.+)$/);
    if (quote) {
      nodes.push(
        <View key={`${props.keyPrefix}-quote-${index}`} style={props.styles.aiMarkdownQuote}>
          {renderInlineText({
            content: quote[1],
            pageCount: props.pageCount,
            styles: props.styles,
            textStyle: [props.textStyle, props.styles.aiMarkdownQuoteText],
            linkStyle: props.linkStyle,
            onOpenPage: props.onOpenPage,
          })}
        </View>,
      );
      index += 1;
      continue;
    }

    const ordered = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      nodes.push(
        <View key={`${props.keyPrefix}-ordered-${index}`} style={props.styles.aiStructuredBulletRow}>
          <Text style={props.styles.aiStructuredOrderedMarker}>{ordered[1]}.</Text>
          <PageReferenceText
            content={ordered[2]}
            pageCount={props.pageCount}
            textStyle={[props.textStyle, props.styles.aiStructuredBulletText]}
            linkStyle={props.linkStyle}
            inlineCodeStyle={props.styles.aiMarkdownInlineCode}
            onOpenPage={props.onOpenPage}
          />
        </View>,
      );
      index += 1;
      continue;
    }

    const bullet = line.match(/^•\s*(.+)$/);
    if (bullet) {
      nodes.push(
        <View key={`${props.keyPrefix}-bullet-${index}`} style={props.styles.aiStructuredBulletRow}>
          <Text style={props.styles.aiStructuredBulletDot}>•</Text>
          <PageReferenceText
            content={bullet[1]}
            pageCount={props.pageCount}
            textStyle={[props.textStyle, props.styles.aiStructuredBulletText]}
            linkStyle={props.linkStyle}
            inlineCodeStyle={props.styles.aiMarkdownInlineCode}
            onOpenPage={props.onOpenPage}
          />
        </View>,
      );
      index += 1;
      continue;
    }

    nodes.push(
      <View key={`${props.keyPrefix}-paragraph-${index}`} style={props.styles.aiStructuredParagraph}>
        <PageReferenceText
          content={line}
          pageCount={props.pageCount}
          textStyle={props.textStyle}
          linkStyle={props.linkStyle}
          inlineCodeStyle={props.styles.aiMarkdownInlineCode}
          onOpenPage={props.onOpenPage}
        />
      </View>,
    );
    index += 1;
  }

  return nodes;
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
  onRequestMoreRecommendations,
  moreRecommendationsDisabled,
}: AiResponseContentProps) {
  const maxPage = pageCount && pageCount > 0 ? pageCount : Number.POSITIVE_INFINITY;
  const blocks = React.useMemo(() => parseAiContent(content), [content]);
  const getRecommendationPageLabel = (item: RecommendationItem) => (
    item.startPageNumber === item.endPageNumber
      ? `${item.startPageNumber}p`
      : `${item.startPageNumber}-${item.endPageNumber}p`
  );

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
              <View style={styles.aiStructuredSectionBody}>
                {renderStructuredLines({
                  content: block.lines.join('\n').trim(),
                  keyPrefix: `section-${blockIndex}-${block.title}`,
                  pageCount,
                  styles,
                  textStyle,
                  linkStyle,
                  onOpenPage,
                })}
              </View>
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
                const canOpen = Boolean(onOpenPage) && item.startPageNumber >= 1 && item.startPageNumber <= maxPage;
                return (
                  <Pressable
                    key={`${blockIndex}-${item.startPageNumber}-${item.endPageNumber}-${item.body}`}
                    style={styles.aiPageRecommendationItem}
                    onPress={canOpen ? () => onOpenPage?.(item.startPageNumber) : undefined}
                    disabled={!canOpen}
                  >
                    <View style={styles.aiPageRecommendationPill}>
                      <Text style={styles.aiPageRecommendationPillText}>{getRecommendationPageLabel(item)}</Text>
                    </View>
                    <Text style={styles.aiPageRecommendationBody}>{item.body}</Text>
                    {canOpen ? (
                      <MaterialCommunityIcons name="chevron-right" size={16} color="#9AA5B7" />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            {onRequestMoreRecommendations ? (
              <Pressable
                style={[
                  styles.aiPageRecommendationMoreButton,
                  moreRecommendationsDisabled && styles.aiPageRecommendationMoreButtonDisabled,
                ]}
                onPress={onRequestMoreRecommendations}
                disabled={moreRecommendationsDisabled}
              >
                <MaterialCommunityIcons name="plus" size={14} color="#4F68D2" />
                <Text style={styles.aiPageRecommendationMoreText}>추가로 보기</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
