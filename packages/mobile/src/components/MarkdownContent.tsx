/**
 * MarkdownContent — Renders agent response text as markdown.
 * Terminal dark theme only. JetBrains Mono. Theme-aware colors.
 */

import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import Markdown from "react-native-markdown-display";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";

interface MarkdownContentProps {
  content: string;
}

function MarkdownContent({ content }: MarkdownContentProps) {
  const { colors } = useTheme();

  const style = useMemo(
    () =>
      StyleSheet.create({
        body: {
          color: colors.text,
          fontSize: 14,
          lineHeight: 21,
          fontFamily: fonts.regular,
        },
        heading1: {
          color: colors.bright,
          fontSize: 20,
          fontFamily: fonts.bold,
          marginTop: 8,
          marginBottom: 4,
        },
        heading2: {
          color: colors.bright,
          fontSize: 17,
          fontFamily: fonts.bold,
          marginTop: 6,
          marginBottom: 4,
        },
        heading3: {
          color: colors.bright,
          fontSize: 15,
          fontFamily: fonts.semibold,
          marginTop: 4,
          marginBottom: 2,
        },
        paragraph: { marginTop: 0, marginBottom: 6 },
        link: { color: colors.accent },
        fence: {
          backgroundColor: colors.surface,
          color: colors.text,
          borderColor: colors.border,
          borderRadius: 4,
          borderWidth: 1,
          padding: 10,
          fontSize: 12,
          fontFamily: fonts.regular,
        },
        code_inline: {
          backgroundColor: colors.surface,
          color: colors.accent,
          borderColor: colors.border,
          borderRadius: 2,
          paddingHorizontal: 4,
          paddingVertical: 1,
          fontSize: 12,
          fontFamily: fonts.regular,
        },
        blockquote: {
          borderLeftColor: colors.border,
          borderLeftWidth: 2,
          paddingLeft: 10,
          marginLeft: 0,
          backgroundColor: "transparent",
        },
        bullet_list_icon: { color: colors.success },
        ordered_list_icon: { color: colors.success },
        strong: {
          color: colors.bright,
          fontFamily: fonts.bold,
        },
        em: {
          color: colors.muted,
          fontFamily: fonts.light,
          fontStyle: "italic" as const,
        },
        hr: {
          backgroundColor: colors.border,
          height: 1,
        },
        list_item: {
          color: colors.text,
          fontFamily: fonts.regular,
        },
      }),
    [colors],
  );

  if (!content) return null;

  return <Markdown style={style}>{content}</Markdown>;
}

export default React.memo(MarkdownContent);
