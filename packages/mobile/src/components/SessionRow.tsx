/**
 * SessionRow — Enhanced session list card.
 * Shows nickname, description/prompt preview, project folder, and timestamp.
 * Long-press to delete.
 *
 * Wrapped in React.memo — rendered inside SectionList, must not re-render
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
  onLongPress?: () => void;
}

function SessionRowInner({ session, onPress, onLongPress }: SessionRowProps) {
  const { colors } = useTheme();
  const timeAgo = getTimeAgo(session.updatedAt || session.createdAt);

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
      style={[
        styles.container,
        {
          borderBottomColor: colors.border,
          backgroundColor: colors.bg,
        },
      ]}
    >
      {/* Activity dot */}
      <View style={styles.dotColumn}>
        <Text
          style={[
            styles.dot,
            { color: session.hasActivity ? colors.success : colors.dim },
          ]}
        >
          {session.hasActivity ? "\u25CF" : "\u25CB"}
        </Text>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* Top row: nickname + timestamp */}
        <View style={styles.topRow}>
          <Text
            style={[styles.title, { color: colors.text }]}
            numberOfLines={1}
          >
            {session.title || `${session.id.slice(0, 8)}...`}
          </Text>
          <Text style={[styles.time, { color: colors.dim }]}>
            {timeAgo}
          </Text>
        </View>

        {/* Last user prompt preview */}
        {session.lastMessagePreview ? (
          <Text
            style={[styles.preview, { color: colors.muted }]}
            numberOfLines={2}
          >
            {session.lastMessagePreview}
          </Text>
        ) : null}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dotColumn: {
    width: 16,
    paddingTop: 3,
  },
  dot: {
    fontFamily: fonts.regular,
    fontSize: 10,
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontFamily: fonts.medium,
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  time: {
    fontFamily: fonts.regular,
    fontSize: 11,
  },
  preview: {
    fontFamily: fonts.regular,
    fontSize: 12,
    marginTop: 3,
    lineHeight: 17,
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
