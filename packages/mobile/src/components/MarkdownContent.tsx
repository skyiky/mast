/**
 * MarkdownContent — Renders agent response text as markdown.
 * Uses @ronradtke/react-native-markdown-display for native rendering.
 */

import React, { useMemo } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import Markdown from "react-native-markdown-display";

interface MarkdownContentProps {
  content: string;
}

const lightStyles = StyleSheet.create({
  body: { color: "#1a1a1a", fontSize: 15, lineHeight: 22 },
  heading1: { color: "#111827", fontSize: 22, fontWeight: "700" as const, marginTop: 8, marginBottom: 4 },
  heading2: { color: "#111827", fontSize: 19, fontWeight: "700" as const, marginTop: 6, marginBottom: 4 },
  heading3: { color: "#111827", fontSize: 16, fontWeight: "600" as const, marginTop: 4, marginBottom: 2 },
  paragraph: { marginTop: 0, marginBottom: 6 },
  link: { color: "#4c6ef5" },
  fence: {
    backgroundColor: "#f3f4f6",
    color: "#1f2937",
    borderColor: "#e5e7eb",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    fontSize: 13,
    fontFamily: "monospace",
  },
  code_inline: {
    backgroundColor: "#f3f4f6",
    color: "#1f2937",
    borderColor: "#e5e7eb",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 13,
    fontFamily: "monospace",
  },
  blockquote: {
    borderLeftColor: "#d1d5db",
    borderLeftWidth: 3,
    paddingLeft: 12,
    marginLeft: 0,
    backgroundColor: "transparent",
  },
  bullet_list_icon: { color: "#1a1a1a" },
  ordered_list_icon: { color: "#1a1a1a" },
});

const darkStyles = StyleSheet.create({
  body: { color: "#f3f4f6", fontSize: 15, lineHeight: 22 },
  heading1: { color: "#f9fafb", fontSize: 22, fontWeight: "700" as const, marginTop: 8, marginBottom: 4 },
  heading2: { color: "#f9fafb", fontSize: 19, fontWeight: "700" as const, marginTop: 6, marginBottom: 4 },
  heading3: { color: "#f9fafb", fontSize: 16, fontWeight: "600" as const, marginTop: 4, marginBottom: 2 },
  paragraph: { marginTop: 0, marginBottom: 6 },
  link: { color: "#748ffc" },
  fence: {
    backgroundColor: "#1f2937",
    color: "#e5e7eb",
    borderColor: "#374151",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    fontSize: 13,
    fontFamily: "monospace",
  },
  code_inline: {
    backgroundColor: "#1f2937",
    color: "#e5e7eb",
    borderColor: "#374151",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 13,
    fontFamily: "monospace",
  },
  blockquote: {
    borderLeftColor: "#4b5563",
    borderLeftWidth: 3,
    paddingLeft: 12,
    marginLeft: 0,
    backgroundColor: "transparent",
  },
  bullet_list_icon: { color: "#f3f4f6" },
  ordered_list_icon: { color: "#f3f4f6" },
});

export default function MarkdownContent({ content }: MarkdownContentProps) {
  const colorScheme = useColorScheme();
  const style = useMemo(
    () => (colorScheme === "dark" ? darkStyles : lightStyles),
    [colorScheme],
  );

  if (!content) return null;

  return <Markdown style={style}>{content}</Markdown>;
}
