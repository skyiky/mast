/**
 * ToolCallCard — Terminal-style compact tool invocation display.
 * Collapsed: one-liner `[tool] toolName ✓`
 * Expanded: monospace args/result
 */

import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";
import AnimatedPressable from "./AnimatedPressable";

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
    <View style={styles.wrapper}>
      <AnimatedPressable
        onPress={toggle}
        style={styles.header}
        pressScale={0.98}
      >
        <Text style={[styles.toggleIcon, { color: colors.muted }]}>
          {collapsed ? "+" : "-"}
        </Text>
        <Text style={[styles.label, { color: colors.dim }]}>
          [tool]
        </Text>
        <Text
          style={[styles.toolName, { color: colors.success }]}
          numberOfLines={1}
        >
          {toolName}
        </Text>
        {result && (
          <Text style={[styles.checkmark, { color: colors.success }]}>
            ✓
          </Text>
        )}
      </AnimatedPressable>

      {!collapsed && (
        <View style={[styles.body, { borderLeftColor: colors.border }]}>
          {args && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.dim }]}>
                args
              </Text>
              <Text style={[styles.sectionContent, { color: colors.muted }]}>
                {formatArgs(args)}
              </Text>
            </View>
          )}
          {result && (
            <View>
              <Text style={[styles.sectionLabel, { color: colors.dim }]}>
                result
              </Text>
              <Text style={[styles.resultContent, { color: colors.success }]}>
                {result.length > 500 ? result.slice(0, 500) + "..." : result}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginVertical: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    minHeight: 44,
  },
  toggleIcon: {
    fontFamily: fonts.regular,
    fontSize: 12,
    marginRight: 4,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  toolName: {
    fontFamily: fonts.medium,
    fontSize: 12,
    marginLeft: 4,
    flex: 1,
  },
  checkmark: {
    fontFamily: fonts.regular,
    fontSize: 12,
    marginLeft: 4,
  },
  body: {
    marginLeft: 16,
    paddingLeft: 8,
    borderLeftWidth: 1,
    marginTop: 2,
    marginBottom: 4,
  },
  section: {
    marginBottom: 4,
  },
  sectionLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  sectionContent: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
  },
  resultContent: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
  },
});

function formatArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}
