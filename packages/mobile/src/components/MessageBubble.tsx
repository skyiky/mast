/**
 * MessageBubble — Renders a single chat message.
 */

import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import type { ChatMessage, MessagePart } from "../stores/sessions";
import { useSettingsStore } from "../stores/settings";
import MarkdownContent from "./MarkdownContent";
import ToolCallCard from "./ToolCallCard";

interface MessageBubbleProps {
  message: ChatMessage;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const verbosity = useSettingsStore((s) => s.verbosity);
  const isUser = message.role === "user";

  const visibleParts = message.parts.filter((part) => {
    if (verbosity === "standard") {
      // Hide reasoning in standard mode
      if (part.type === "reasoning") return false;
      // Tool results are folded into tool cards
      if (part.type === "tool-result") return false;
    }
    return true;
  });

  return (
    <View
      className={`max-w-[85%] px-4 py-3 my-1 ${
        isUser
          ? "self-end rounded-2xl rounded-br-md bg-mast-600 dark:bg-mast-700"
          : "self-start rounded-2xl rounded-bl-md bg-gray-100 dark:bg-gray-800"
      }`}
    >
      {visibleParts.map((part, idx) => (
        <PartRenderer
          key={`${message.id}-${idx}`}
          part={part}
          isUser={isUser}
          verbosity={verbosity}
          allParts={message.parts}
        />
      ))}

      {visibleParts.length === 0 && message.streaming && (
        <Text className="text-gray-400 dark:text-gray-500 text-sm italic">
          Thinking...
        </Text>
      )}

      {message.streaming && (
        <ActivityIndicator
          size="small"
          color={isUser ? "#ffffff" : "#9ca3af"}
          className="mt-1 self-start"
        />
      )}
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
  switch (part.type) {
    case "text":
      if (isUser) {
        return (
          <Text className="text-white text-base leading-6">
            {part.content}
          </Text>
        );
      }
      return <MarkdownContent content={part.content} />;

    case "tool-invocation": {
      // Find matching tool-result
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
        <View className="mt-2 pl-3 border-l-2 border-gray-300 dark:border-gray-600">
          <Text className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
            Reasoning
          </Text>
          <Text className="text-sm text-gray-600 dark:text-gray-400 leading-5">
            {part.content}
          </Text>
        </View>
      );

    case "file":
      return (
        <View className="mt-2 bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2">
          <Text className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            {part.content}
          </Text>
        </View>
      );

    case "tool-result":
      // Rendered inline with tool-invocation in full mode
      if (verbosity === "full") {
        return (
          <View className="mt-1 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
            <Text className="text-xs text-green-700 dark:text-green-400 font-mono">
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
