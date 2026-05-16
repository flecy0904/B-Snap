import React from 'react';
import { Text } from 'react-native';

type PageReferenceTextProps = {
  content: string;
  pageCount?: number | null;
  textStyle?: any;
  linkStyle?: any;
  onOpenPage?: (pageNumber: number) => void;
};

export function PageReferenceText({
  content,
  pageCount,
  textStyle,
  linkStyle,
  onOpenPage,
}: PageReferenceTextProps) {
  const pattern = /(\d{1,3})\s*(페이지|쪽|p(?:age)?\.?)/gi;
  const maxPage = pageCount && pageCount > 0 ? pageCount : Number.POSITIVE_INFINITY;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const pageNumber = Number(match[1]);
    const matchedText = match[0];
    const validPage = Boolean(onOpenPage)
      && Number.isFinite(pageNumber)
      && pageNumber >= 1
      && pageNumber <= maxPage;

    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }

    nodes.push(
      <Text
        key={`${match.index}-${matchedText}`}
        style={validPage ? linkStyle : undefined}
        onPress={validPage ? () => onOpenPage?.(pageNumber) : undefined}
      >
        {matchedText}
      </Text>,
    );
    lastIndex = match.index + matchedText.length;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return <Text style={textStyle}>{nodes.length ? nodes : content}</Text>;
}
