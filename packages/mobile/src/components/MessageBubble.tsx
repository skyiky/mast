/**
 * MessageBubble — Terminal-style message block.
 *
 * No bubbles. Full-width blocks.
 * - User messages: cyan ">" prefix, bright white text
 * - Agent messages: thin green left border, standard text color
 */

import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import type { ChatMessage, MessagePart } from "../stores/sessions";
import { useSettingsStore } from "../stores/settings";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";
import MarkdownContent from "./MarkdownContent";
import ToolCallCard from "./ToolCallCard";

interface MessageBubbleProps {
  message: ChatMessage;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
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
        {
          paddingVertical: 6,
          paddingHorizontal: 0,
          borderLeftWidth: isUser ? 0 : 2,
          borderLeftColor: isUser ? "transparent" : colors.success,
        },
      ]}
    >
      {/* Timestamp — right-aligned */}
      {time && (
        <Text
          style={{
            fontFamily: fonts.regular,
            fontSize: 10,
            color: colors.dim,
            textAlign: "right",
            marginBottom: 2,
            paddingRight: 4,
          }}
        >
          {time}
        </Text>
      )}

      {/* Message content */}
      <View style={{ paddingLeft: isUser ? 0 : 10 }}>
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
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text
              style={{
                fontFamily: fonts.regular,
                fontSize: 13,
                color: colors.muted,
                fontStyle: "italic",
                marginRight: 6,
              }}
            >
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
            style={{ marginTop: 4, alignSelf: "flex-start" }}
          />
        )}
      </View>
    </View>
  );
}

function PartRenderer({
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
          <View style={{ flexDirection: "row" }}>
            <Text
              style={{
                fontFamily: fonts.semibold,
                fontSize: 15,
                color: colors.accent,
                marginRight: 6,
              }}
            >
              {">"}
            </Text>
            <Text
              style={{
                fontFamily: fonts.regular,
                fontSize: 15,
                color: colors.bright,
                flex: 1,
                lineHeight: 22,
              }}
            >
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
        <View
          style={{
            marginTop: 6,
            paddingLeft: 10,
            borderLeftWidth: 2,
            borderLeftColor: colors.border,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.medium,
              fontSize: 10,
              color: colors.muted,
              marginBottom: 2,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            reasoning
          </Text>
          <Text
            style={{
              fontFamily: fonts.light,
              fontSize: 12,
              color: colors.muted,
              lineHeight: 18,
            }}
          >
            {part.content}
          </Text>
        </View>
      );

    case "file":
      return (
        <View
          style={{
            marginTop: 6,
            backgroundColor: colors.surface,
            borderRadius: 4,
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.regular,
              fontSize: 12,
              color: colors.muted,
            }}
          >
            {part.content}
          </Text>
        </View>
      );

    case "tool-result":
      if (verbosity === "full") {
        return (
          <View
            style={{
              marginTop: 4,
              backgroundColor: colors.successDim,
              borderRadius: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.regular,
                fontSize: 11,
                color: colors.success,
                lineHeight: 16,
              }}
            >
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
}
