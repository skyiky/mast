/**
 * MessageBubble — Terminal-style message block.
 * - User messages: cyan ">" prefix, bright white text
 * - Agent messages: thin green left border, standard text color
 * Renders parts: text, tool-invocation, reasoning, file, tool-result.
 */

import { memo } from "react";
import type { ChatMessage, MessagePart } from "../lib/types.js";
import { formatTimestamp } from "../lib/chat-utils.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { ToolCallCard } from "./ToolCallCard.js";

interface MessageBubbleProps {
  message: ChatMessage;
  verbosity: "standard" | "full";
}

function MessageBubbleInner({ message, verbosity }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const time = formatTimestamp(message.createdAt);

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

  return (
    <div className={`message-bubble ${isUser ? "user" : "assistant"}`}>
      {/* Timestamp */}
      {time && <div className="message-time">{time}</div>}

      {/* Message content */}
      <div className={`message-content ${isUser ? "user" : "assistant"}`}>
        {visibleParts.map((part, idx) => (
          <PartRenderer
            key={`${message.id}-${idx}`}
            part={part}
            isUser={isUser}
            verbosity={verbosity}
            allParts={message.parts}
          />
        ))}

        {/* Thinking state — streaming with no content yet */}
        {message.streaming && !hasVisibleContent && (
          <div className="message-thinking">
            <span className="thinking-text">...</span>
            <span className="thinking-dot" />
          </div>
        )}

        {/* Streaming indicator — streaming with content */}
        {message.streaming && hasVisibleContent && (
          <span className="streaming-indicator" />
        )}
      </div>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleInner);
MessageBubble.displayName = "MessageBubble";

// ---------------------------------------------------------------------------
// PartRenderer — renders individual message parts
// ---------------------------------------------------------------------------

const PartRenderer = memo(function PartRenderer({
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
          <div className="user-text-row">
            <span className="user-prompt">{">"}</span>
            <span className="user-text">{part.content}</span>
          </div>
        );
      }
      return <MarkdownContent content={part.content} />;

    case "tool-invocation": {
      // Check for legacy separate tool-result part
      const legacyResult = allParts.find(
        (p) => p.type === "tool-result" && p.toolName === part.toolName,
      );
      const result = part.content || legacyResult?.content;
      return (
        <ToolCallCard
          toolName={part.toolName ?? "Tool"}
          args={part.toolArgs}
          result={result || undefined}
          collapsed={verbosity === "standard"}
        />
      );
    }

    case "reasoning":
      return (
        <div className="reasoning-box">
          <div className="reasoning-label">reasoning</div>
          <div className="reasoning-text">{part.content}</div>
        </div>
      );

    case "file":
      return (
        <div className="file-box">
          <span className="file-text">{part.content}</span>
        </div>
      );

    case "tool-result":
      if (verbosity === "full") {
        return (
          <div className="tool-result-box">
            <pre className="tool-result-text">
              {part.content.length > 500
                ? part.content.slice(0, 500) + "..."
                : part.content}
            </pre>
          </div>
        );
      }
      return null;

    default:
      return null;
  }
});
