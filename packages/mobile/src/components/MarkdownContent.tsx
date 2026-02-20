/**
 * MarkdownContent — Renders agent response text as markdown.
 * Uses react-native-enriched-markdown (Software Mansion) for native text rendering.
 */

import React from "react";
import { View, useColorScheme } from "react-native";
import {
  EnrichedMarkdownText,
  type MarkdownStyle,
} from "react-native-enriched-markdown";

interface MarkdownContentProps {
  content: string;
}

const lightStyle: MarkdownStyle = {
  paragraph: { color: "#1a1a1a", fontSize: 15, lineHeight: 22 },
  h1: { color: "#111827", fontSize: 22, fontWeight: "700" },
  h2: { color: "#111827", fontSize: 19, fontWeight: "700" },
  h3: { color: "#111827", fontSize: 16, fontWeight: "600" },
  link: { color: "#4c6ef5" },
  codeBlock: {
    backgroundColor: "#f3f4f6",
    color: "#1f2937",
    borderColor: "#e5e7eb",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    fontSize: 13,
  },
  code: {
    backgroundColor: "#f3f4f6",
    color: "#1f2937",
    borderColor: "#e5e7eb",
  },
  blockquote: {
    borderColor: "#d1d5db",
    borderWidth: 3,
    color: "#6b7280",
    fontSize: 14,
  },
};

const darkStyle: MarkdownStyle = {
  paragraph: { color: "#f3f4f6", fontSize: 15, lineHeight: 22 },
  h1: { color: "#f9fafb", fontSize: 22, fontWeight: "700" },
  h2: { color: "#f9fafb", fontSize: 19, fontWeight: "700" },
  h3: { color: "#f9fafb", fontSize: 16, fontWeight: "600" },
  link: { color: "#748ffc" },
  codeBlock: {
    backgroundColor: "#1f2937",
    color: "#e5e7eb",
    borderColor: "#374151",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    fontSize: 13,
  },
  code: {
    backgroundColor: "#1f2937",
    color: "#e5e7eb",
    borderColor: "#374151",
  },
  blockquote: {
    borderColor: "#4b5563",
    borderWidth: 3,
    color: "#9ca3af",
    fontSize: 14,
  },
};

export default function MarkdownContent({ content }: MarkdownContentProps) {
  const colorScheme = useColorScheme();
  const style = colorScheme === "dark" ? darkStyle : lightStyle;

  if (!content) return null;

  return (
    <View>
      <EnrichedMarkdownText markdown={content} markdownStyle={style} />
    </View>
  );
}
