/**
 * ToolCallCard — Terminal-style compact tool invocation display.
 * Collapsed: one-liner `[tool] toolName ✓`
 * Expanded: monospace args/result
 */

import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";

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
  const { colors } = useTheme();

  const toggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsed(!collapsed);
  };

  return (
    <View style={{ marginVertical: 2 }}>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.7}
        style={{ flexDirection: "row", alignItems: "center", paddingVertical: 2 }}
      >
        <Text
          style={{
            fontFamily: fonts.regular,
            fontSize: 12,
            color: colors.muted,
            marginRight: 4,
          }}
        >
          {collapsed ? "+" : "-"}
        </Text>
        <Text
          style={{
            fontFamily: fonts.regular,
            fontSize: 12,
            color: colors.dim,
          }}
        >
          [tool]
        </Text>
        <Text
          style={{
            fontFamily: fonts.medium,
            fontSize: 12,
            color: colors.success,
            marginLeft: 4,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {toolName}
        </Text>
        {result && (
          <Text
            style={{
              fontFamily: fonts.regular,
              fontSize: 12,
              color: colors.success,
              marginLeft: 4,
            }}
          >
            ✓
          </Text>
        )}
      </TouchableOpacity>

      {!collapsed && (
        <View
          style={{
            marginLeft: 16,
            paddingLeft: 8,
            borderLeftWidth: 1,
            borderLeftColor: colors.border,
            marginTop: 2,
            marginBottom: 4,
          }}
        >
          {args && (
            <View style={{ marginBottom: 4 }}>
              <Text
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 10,
                  color: colors.dim,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 2,
                }}
              >
                args
              </Text>
              <Text
                style={{
                  fontFamily: fonts.regular,
                  fontSize: 11,
                  color: colors.muted,
                  lineHeight: 16,
                }}
              >
                {formatArgs(args)}
              </Text>
            </View>
          )}
          {result && (
            <View>
              <Text
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 10,
                  color: colors.dim,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 2,
                }}
              >
                result
              </Text>
              <Text
                style={{
                  fontFamily: fonts.regular,
                  fontSize: 11,
                  color: colors.success,
                  lineHeight: 16,
                }}
              >
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
