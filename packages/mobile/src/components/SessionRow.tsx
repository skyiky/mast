/**
 * SessionRow — Renders a single session in the session list.
 */

import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { Session } from "../stores/sessions";

interface SessionRowProps {
  session: Session;
  onPress: () => void;
}

export default function SessionRow({ session, onPress }: SessionRowProps) {
  const timeAgo = getTimeAgo(session.updatedAt || session.createdAt);

  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 active:bg-gray-50 dark:active:bg-gray-800"
    >
      {/* Activity indicator dot */}
      <View className="w-8 items-center">
        {session.hasActivity && (
          <View className="w-2.5 h-2.5 rounded-full bg-mast-500" />
        )}
      </View>

      {/* Content */}
      <View className="flex-1 mr-3">
        <Text
          className="text-base font-medium text-gray-900 dark:text-gray-100"
          numberOfLines={1}
        >
          {session.title || `${session.id.slice(0, 8)}...`}
        </Text>
        {session.lastMessagePreview && (
          <Text
            className="text-sm text-gray-500 dark:text-gray-400 mt-0.5"
            numberOfLines={2}
          >
            {session.lastMessagePreview}
          </Text>
        )}
      </View>

      {/* Timestamp */}
      <Text className="text-xs text-gray-400 dark:text-gray-500">
        {timeAgo}
      </Text>

      {/* Chevron */}
      <Text className="text-gray-300 dark:text-gray-600 ml-2 text-lg">
        {">"}
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
