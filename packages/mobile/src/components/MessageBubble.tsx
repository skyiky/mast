/**
 * MessageBubble — Terminal-style message block.
 *
 * No bubbles. Full-width blocks.
 * - User messages: cyan ">" prefix, bright white text
 * - Agent messages: thin green left border, standard text color
 *
 * Wrapped in React.memo — rendered inside FlashList.
 */

import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import type { ChatMessage, MessagePart } from "../stores/sessions";
import { useSettingsStore } from "../stores/settings";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";
import MarkdownContent from "./MarkdownContent";
import ToolCallCard from "./ToolCallCard";

interface MessageBubbleProps {
  message: ChatMessage;
}

function MessageBubbleInner({ message }: MessageBubbleProps) {
  const verbosity = useSettingsStore((s) => s.verbosity);
  const { colors } = useTheme();
  const isUser = message.role === "user";

  const visibleParts = message.parts.filter((part) => {
    if (verbosity === "standard") {
      if (part.type === "reasoning") return false;
      if (part.type === "tool-result") return false;
    }
    return true;
  });

  const hasVisibleContent = visibleParts.some(
    (part) => part.type !== "text" || part.content,
  );

  // Format timestamp
  const time = message.createdAt
    ? new Date(message.createdAt).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : null;

  return (
    <View
      style={[
        styles.container,
        {
          borderLeftWidth: isUser ? 0 : 2,
          borderLeftColor: isUser ? "transparent" : colors.success,
        },
      ]}
    >
      {/* Timestamp — right-aligned */}
      {time && (
        <Text style={[styles.timestamp, { color: colors.dim }]}>
          {time}
        </Text>
      )}

      {/* Message content */}
      <View style={isUser ? styles.contentUser : styles.contentAgent}>
        {visibleParts.map((part, idx) => (
          <PartRenderer
            key={`${message.id}-${idx}`}
            part={part}
            isUser={isUser}
            verbosity={verbosity}
            allParts={message.parts}
          />
        ))}

        {/* Thinking state — blinking-style dots */}
        {!hasVisibleContent && (
          <View style={styles.thinking}>
            <Text style={[styles.thinkingText, { color: colors.muted }]}>
              ...
            </Text>
            <ActivityIndicator size="small" color={colors.muted} />
          </View>
        )}

        {/* Streaming indicator */}
        {message.streaming && hasVisibleContent && (
          <ActivityIndicator
            size="small"
            color={isUser ? colors.accent : colors.success}
            style={styles.streamingIndicator}
          />
        )}
      </View>
    </View>
  );
}

const MessageBubble = React.memo(MessageBubbleInner);
MessageBubble.displayName = "MessageBubble";

export default MessageBubble;

// ---------------------------------------------------------------------------
// PartRenderer — renders individual message parts
// ---------------------------------------------------------------------------

const PartRenderer = React.memo(function PartRenderer({
  part,
  isUser,
  verbosity,
  allParts,
}: {
  part: MessagePart;
  isUser: boolean;
  verbosity: "standard" | "full";
  allParts: MessagePart[];
}) {
  const { colors } = useTheme();

  switch (part.type) {
    case "text":
      if (isUser) {
        return (
          <View style={styles.userTextRow}>
            <Text style={[styles.userPrompt, { color: colors.accent }]}>
              {">"}
            </Text>
            <Text style={[styles.userText, { color: colors.bright }]}>
              {part.content}
            </Text>
          </View>
        );
      }
      return <MarkdownContent content={part.content} />;

    case "tool-invocation": {
      const result = allParts.find(
        (p) => p.type === "tool-result" && p.toolName === part.toolName,
      );
      return (
        <ToolCallCard
          toolName={part.toolName ?? "Tool"}
          args={part.toolArgs}
          result={result?.content}
          collapsed={verbosity === "standard"}
        />
      );
    }

    case "reasoning":
      return (
        <View style={[styles.reasoningBox, { borderLeftColor: colors.border }]}>
          <Text style={[styles.reasoningLabel, { color: colors.muted }]}>
            reasoning
          </Text>
          <Text style={[styles.reasoningText, { color: colors.muted }]}>
            {part.content}
          </Text>
        </View>
      );

    case "file":
      return (
        <View style={[styles.fileBox, { backgroundColor: colors.surface }]}>
          <Text style={[styles.fileText, { color: colors.muted }]}>
            {part.content}
          </Text>
        </View>
      );

    case "tool-result":
      if (verbosity === "full") {
        return (
          <View style={[styles.toolResultBox, { backgroundColor: colors.successDim }]}>
            <Text style={[styles.toolResultText, { color: colors.success }]}>
              {part.content.length > 500
                ? part.content.slice(0, 500) + "..."
                : part.content}
            </Text>
          </View>
        );
      }
      return null;

    default:
      return null;
  }
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    paddingVertical: 6,
    paddingHorizontal: 0,
  },
  timestamp: {
    fontFamily: fonts.regular,
    fontSize: 10,
    textAlign: "right",
    marginBottom: 2,
    paddingRight: 4,
  },
  contentUser: {
    paddingLeft: 0,
  },
  contentAgent: {
    paddingLeft: 10,
  },
  thinking: {
    flexDirection: "row",
    alignItems: "center",
  },
  thinkingText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    fontStyle: "italic",
    marginRight: 6,
  },
  streamingIndicator: {
    marginTop: 4,
    alignSelf: "flex-start",
  },
  // PartRenderer styles
  userTextRow: {
    flexDirection: "row",
  },
  userPrompt: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    marginRight: 6,
  },
  userText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    flex: 1,
    lineHeight: 22,
  },
  reasoningBox: {
    marginTop: 6,
    paddingLeft: 10,
    borderLeftWidth: 2,
  },
  reasoningLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  reasoningText: {
    fontFamily: fonts.light,
    fontSize: 12,
    lineHeight: 18,
  },
  fileBox: {
    marginTop: 6,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  fileText: {
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  toolResultBox: {
    marginTop: 4,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toolResultText: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
  },
});
