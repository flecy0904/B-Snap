import React from 'react';
import { Text } from 'react-native';

type PageReferenceTextProps = {
  content: string;
  pageCount?: number | null;
  textStyle?: any;
  linkStyle?: any;
  boldStyle?: any;
  italicStyle?: any;
  strikeStyle?: any;
  inlineCodeStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
};

const PAGE_REFERENCE_PATTERN = /(\d{1,3})(?:\s*[-~–—]\s*(\d{1,3}))?\s*(페이지|쪽|p(?:age)?\.?)/gi;
const INLINE_MARKDOWN_PATTERN = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
const DEFAULT_BOLD_STYLE = { fontWeight: '900' as const };
const DEFAULT_ITALIC_STYLE = { fontStyle: 'italic' as const };
const DEFAULT_STRIKE_STYLE = { textDecorationLine: 'line-through' as const };
const DEFAULT_INLINE_CODE_STYLE = {
  fontFamily: 'monospace',
  fontWeight: '700' as const,
  backgroundColor: '#EEF2F7',
  color: '#263144',
};

function normalizeLine(line: string) {
  return line
    .replace(/^\s*[*-]\s+/, '• ')
    .replace(/^\s*\d+[.)]\s+/, (match) => match.trimEnd() + ' ');
}

function renderPageSegments(params: {
  text: string;
  maxPage: number;
  linkStyle?: any;
  segmentStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
  keyPrefix: string;
}) {
  const nodes: React.ReactNode[] = [];
  const pattern = new RegExp(PAGE_REFERENCE_PATTERN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(params.text)) !== null) {
    const pageNumber = Number(match[1]);
    const endPageNumber = match[2] ? Number(match[2]) : pageNumber;
    const matchedText = match[0];
    const validPage = Boolean(params.onOpenPage)
      && Number.isFinite(pageNumber)
      && Number.isFinite(endPageNumber)
      && pageNumber >= 1
      && pageNumber <= params.maxPage
      && endPageNumber >= pageNumber
      && endPageNumber <= params.maxPage;

    if (match.index > lastIndex) {
      const plainText = params.text.slice(lastIndex, match.index);
      nodes.push(params.segmentStyle ? (
        <Text key={`${params.keyPrefix}-plain-${lastIndex}`} style={params.segmentStyle}>{plainText}</Text>
      ) : plainText);
    }

    nodes.push(
      <Text
        key={`${params.keyPrefix}-page-${match.index}-${matchedText}`}
        style={[
          params.segmentStyle,
          validPage ? params.linkStyle : null,
        ]}
        onPress={validPage ? () => params.onOpenPage?.(pageNumber) : undefined}
      >
        {matchedText}
      </Text>,
    );
    lastIndex = match.index + matchedText.length;
  }

  if (lastIndex < params.text.length) {
    const plainText = params.text.slice(lastIndex);
    nodes.push(params.segmentStyle ? (
      <Text key={`${params.keyPrefix}-plain-${lastIndex}`} style={params.segmentStyle}>{plainText}</Text>
    ) : plainText);
  }

  if (nodes.length) return nodes;

  return params.segmentStyle
    ? [<Text key={`${params.keyPrefix}-plain`} style={params.segmentStyle}>{params.text}</Text>]
    : [params.text];
}

function parseInlineMarkdownToken(token: string, styles: {
  boldStyle?: any;
  italicStyle?: any;
  strikeStyle?: any;
  inlineCodeStyle?: any;
}) {
  if (token.startsWith('**') && token.endsWith('**')) {
    return { text: token.slice(2, -2), style: styles.boldStyle };
  }
  if (token.startsWith('~~') && token.endsWith('~~')) {
    return { text: token.slice(2, -2), style: styles.strikeStyle };
  }
  if (token.startsWith('`') && token.endsWith('`')) {
    return { text: token.slice(1, -1), style: styles.inlineCodeStyle };
  }
  if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
    return { text: token.slice(1, -1), style: styles.italicStyle };
  }
  return { text: token, style: null };
}

function renderInlineSegments(params: {
  text: string;
  lineIndex: number;
  maxPage: number;
  linkStyle?: any;
  boldStyle?: any;
  italicStyle?: any;
  strikeStyle?: any;
  inlineCodeStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
}) {
  const nodes: React.ReactNode[] = [];
  const pattern = new RegExp(INLINE_MARKDOWN_PATTERN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(params.text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...renderPageSegments({
        text: params.text.slice(lastIndex, match.index),
        maxPage: params.maxPage,
        linkStyle: params.linkStyle,
        onOpenPage: params.onOpenPage,
        keyPrefix: `${params.lineIndex}-${lastIndex}`,
      }));
    }

    const parsed = parseInlineMarkdownToken(match[0], {
      boldStyle: params.boldStyle,
      italicStyle: params.italicStyle,
      strikeStyle: params.strikeStyle,
      inlineCodeStyle: params.inlineCodeStyle,
    });
    nodes.push(...renderPageSegments({
      text: parsed.text,
      maxPage: params.maxPage,
      linkStyle: params.linkStyle,
      segmentStyle: parsed.style,
      onOpenPage: params.onOpenPage,
      keyPrefix: `${params.lineIndex}-bold-${match.index}`,
    }));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < params.text.length) {
    nodes.push(...renderPageSegments({
      text: params.text.slice(lastIndex),
      maxPage: params.maxPage,
      linkStyle: params.linkStyle,
      onOpenPage: params.onOpenPage,
      keyPrefix: `${params.lineIndex}-${lastIndex}`,
    }));
  }

  return nodes.length ? nodes : [params.text];
}

export function PageReferenceText({
  content,
  pageCount,
  textStyle,
  linkStyle,
  boldStyle = DEFAULT_BOLD_STYLE,
  italicStyle = DEFAULT_ITALIC_STYLE,
  strikeStyle = DEFAULT_STRIKE_STYLE,
  inlineCodeStyle = DEFAULT_INLINE_CODE_STYLE,
  onOpenPage,
}: PageReferenceTextProps) {
  const maxPage = pageCount && pageCount > 0 ? pageCount : Number.POSITIVE_INFINITY;
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  return (
    <Text style={textStyle}>
      {lines.map((line, lineIndex) => (
        <React.Fragment key={`${lineIndex}-${line}`}>
          {lineIndex > 0 ? '\n' : null}
          {renderInlineSegments({
            text: normalizeLine(line),
            lineIndex,
            maxPage,
            linkStyle,
            boldStyle,
            italicStyle,
            strikeStyle,
            inlineCodeStyle,
            onOpenPage,
          })}
        </React.Fragment>
      ))}
    </Text>
  );
}
