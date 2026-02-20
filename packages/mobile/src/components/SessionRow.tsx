/**
 * SessionRow — Terminal-style session list entry.
 * ● active / ○ idle. Monospace throughout.
 */

import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { Session } from "../stores/sessions";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";

interface SessionRowProps {
  session: Session;
  onPress: () => void;
}

export default function SessionRow({ session, onPress }: SessionRowProps) {
  const { colors } = useTheme();
  const timeAgo = getTimeAgo(session.updatedAt || session.createdAt);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      {/* Activity dot */}
      <Text
        style={{
          fontFamily: fonts.regular,
          fontSize: 10,
          color: session.hasActivity ? colors.success : colors.dim,
          width: 16,
        }}
      >
        {session.hasActivity ? "●" : "○"}
      </Text>

      {/* Content */}
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text
          style={{
            fontFamily: fonts.medium,
            fontSize: 14,
            color: colors.text,
          }}
          numberOfLines={1}
        >
          {session.title || `${session.id.slice(0, 8)}...`}
        </Text>
        {session.lastMessagePreview && (
          <Text
            style={{
              fontFamily: fonts.regular,
              fontSize: 12,
              color: colors.muted,
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            {session.lastMessagePreview}
          </Text>
        )}
      </View>

      {/* Timestamp */}
      <Text
        style={{
          fontFamily: fonts.regular,
          fontSize: 11,
          color: colors.dim,
        }}
      >
        {timeAgo}
      </Text>
    </TouchableOpacity>
  );
}

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
