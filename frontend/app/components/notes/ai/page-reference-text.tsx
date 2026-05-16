import React from 'react';
import { Text } from 'react-native';

type PageReferenceTextProps = {
  content: string;
  pageCount?: number | null;
  textStyle?: any;
  linkStyle?: any;
  boldStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
};

const PAGE_REFERENCE_PATTERN = /(\d{1,3})\s*(페이지|쪽|p(?:age)?\.?)/gi;
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;
const DEFAULT_BOLD_STYLE = { fontWeight: '900' as const };

function normalizeLine(line: string) {
  return line
    .replace(/^\s*[*-]\s+/, '• ')
    .replace(/^\s*\d+[.)]\s+/, (match) => match.trimEnd() + ' ');
}

function renderPageSegments(params: {
  text: string;
  bold: boolean;
  maxPage: number;
  linkStyle?: any;
  boldStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
  keyPrefix: string;
}) {
  const nodes: React.ReactNode[] = [];
  const pattern = new RegExp(PAGE_REFERENCE_PATTERN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(params.text)) !== null) {
    const pageNumber = Number(match[1]);
    const matchedText = match[0];
    const validPage = Boolean(params.onOpenPage)
      && Number.isFinite(pageNumber)
      && pageNumber >= 1
      && pageNumber <= params.maxPage;

    if (match.index > lastIndex) {
      const plainText = params.text.slice(lastIndex, match.index);
      nodes.push(params.bold ? (
        <Text key={`${params.keyPrefix}-plain-${lastIndex}`} style={params.boldStyle}>{plainText}</Text>
      ) : plainText);
    }

    nodes.push(
      <Text
        key={`${params.keyPrefix}-page-${match.index}-${matchedText}`}
        style={[
          params.bold ? params.boldStyle : null,
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
    nodes.push(params.bold ? (
      <Text key={`${params.keyPrefix}-plain-${lastIndex}`} style={params.boldStyle}>{plainText}</Text>
    ) : plainText);
  }

  if (nodes.length) return nodes;

  return params.bold
    ? [<Text key={`${params.keyPrefix}-plain`} style={params.boldStyle}>{params.text}</Text>]
    : [params.text];
}

function renderInlineSegments(params: {
  text: string;
  lineIndex: number;
  maxPage: number;
  linkStyle?: any;
  boldStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
}) {
  const nodes: React.ReactNode[] = [];
  const pattern = new RegExp(BOLD_PATTERN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(params.text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...renderPageSegments({
        text: params.text.slice(lastIndex, match.index),
        bold: false,
        maxPage: params.maxPage,
        linkStyle: params.linkStyle,
        boldStyle: params.boldStyle,
        onOpenPage: params.onOpenPage,
        keyPrefix: `${params.lineIndex}-${lastIndex}`,
      }));
    }

    nodes.push(...renderPageSegments({
      text: match[1],
      bold: true,
      maxPage: params.maxPage,
      linkStyle: params.linkStyle,
      boldStyle: params.boldStyle,
      onOpenPage: params.onOpenPage,
      keyPrefix: `${params.lineIndex}-bold-${match.index}`,
    }));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < params.text.length) {
    nodes.push(...renderPageSegments({
      text: params.text.slice(lastIndex),
      bold: false,
      maxPage: params.maxPage,
      linkStyle: params.linkStyle,
      boldStyle: params.boldStyle,
      onOpenPage: params.onOpenPage,
      keyPrefix: `${params.lineIndex}-${lastIndex}`,
    }));
  }

  return nodes.length ? nodes : [params.text.replace(/\*\*/g, '')];
}

export function PageReferenceText({
  content,
  pageCount,
  textStyle,
  linkStyle,
  boldStyle = DEFAULT_BOLD_STYLE,
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
            onOpenPage,
          })}
        </React.Fragment>
      ))}
    </Text>
  );
}
