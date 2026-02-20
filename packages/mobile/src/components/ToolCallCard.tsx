/**
 * ToolCallCard — Collapsible display for tool invocations.
 */

import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import * as Haptics from "expo-haptics";

interface ToolCallCardProps {
  toolName: string;
  args?: string;
  result?: string;
  collapsed?: boolean;
}

export default function ToolCallCard({
  toolName,
  args,
  result,
  collapsed: initialCollapsed = true,
}: ToolCallCardProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsed(!collapsed);
  };

  return (
    <View className="my-1.5 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <TouchableOpacity
        onPress={toggle}
        className="flex-row items-center px-3 py-2 bg-gray-50 dark:bg-gray-800/50"
        activeOpacity={0.7}
      >
        <Text className="text-xs mr-1.5">{collapsed ? "+" : "-"}</Text>
        <View className="w-2 h-2 rounded-full bg-mast-500 mr-2" />
        <Text
          className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1"
          numberOfLines={1}
        >
          {toolName}
        </Text>
        {result && (
          <View className="w-1.5 h-1.5 rounded-full bg-green-500 ml-2" />
        )}
      </TouchableOpacity>

      {!collapsed && (
        <View className="px-3 py-2 bg-white dark:bg-gray-900">
          {args && (
            <View className="mb-2">
              <Text className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
                Arguments
              </Text>
              <Text className="text-xs font-mono text-gray-600 dark:text-gray-400 leading-4">
                {formatArgs(args)}
              </Text>
            </View>
          )}
          {result && (
            <View>
              <Text className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
                Result
              </Text>
              <Text className="text-xs font-mono text-green-700 dark:text-green-400 leading-4">
                {result.length > 500 ? result.slice(0, 500) + "..." : result}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function formatArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}
