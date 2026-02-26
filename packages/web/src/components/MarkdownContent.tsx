/**
 * MarkdownContent — renders agent response text as markdown.
 * Uses react-markdown + remark-gfm for GitHub-flavored markdown.
 * Terminal-dark themed with monospace code blocks.
 */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
}

function MarkdownContentInner({ content }: MarkdownContentProps) {
  if (!content) return null;

  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export const MarkdownContent = memo(MarkdownContentInner);
MarkdownContent.displayName = "MarkdownContent";
