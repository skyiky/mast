/**
 * SessionRow — Terminal-style session list entry.
 * ● active / ○ idle. Monospace throughout.
 *
 * Wrapped in React.memo — rendered inside FlashList, must not re-render
 * unless props change.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Session } from "../stores/sessions";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";
import AnimatedPressable from "./AnimatedPressable";

interface SessionRowProps {
  session: Session;
  onPress: () => void;
}

function SessionRowInner({ session, onPress }: SessionRowProps) {
  const { colors } = useTheme();
  const timeAgo = getTimeAgo(session.updatedAt || session.createdAt);

  return (
    <AnimatedPressable
      onPress={onPress}
      style={[
        styles.container,
        {
          borderBottomColor: colors.border,
          backgroundColor: colors.bg,
        },
      ]}
    >
      {/* Activity dot */}
      <Text
        style={[
          styles.dot,
          { color: session.hasActivity ? colors.success : colors.dim },
        ]}
      >
        {session.hasActivity ? "●" : "○"}
      </Text>

      {/* Content */}
      <View style={styles.content}>
        <Text
          style={[styles.title, { color: colors.text }]}
          numberOfLines={1}
        >
          {session.title || `${session.id.slice(0, 8)}...`}
        </Text>
        {session.lastMessagePreview && (
          <Text
            style={[styles.preview, { color: colors.muted }]}
            numberOfLines={1}
          >
            {session.lastMessagePreview}
          </Text>
        )}
      </View>

      {/* Timestamp */}
      <Text style={[styles.time, { color: colors.dim }]}>
        {timeAgo}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  dot: {
    fontFamily: fonts.regular,
    fontSize: 10,
    width: 16,
  },
  content: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  preview: {
    fontFamily: fonts.regular,
    fontSize: 12,
    marginTop: 2,
  },
  time: {
    fontFamily: fonts.regular,
    fontSize: 11,
  },
});

const SessionRow = React.memo(SessionRowInner);
SessionRow.displayName = "SessionRow";

export default SessionRow;

function getTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}
