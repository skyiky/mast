/**
 * ToolCallCard — Terminal-style compact tool invocation display.
 * Collapsed: one-liner `[tool] toolName checkmark`
 * Expanded: monospace args/result with show more/less for long results
 */

import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";
import AnimatedPressable from "./AnimatedPressable";

const RESULT_TRUNCATE_LENGTH = 500;

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
  const [resultExpanded, setResultExpanded] = useState(false);
  const { colors } = useTheme();

  const toggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsed(!collapsed);
  };

  const toggleResult = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setResultExpanded(!resultExpanded);
  };

  const isResultLong = result != null && result.length > RESULT_TRUNCATE_LENGTH;
  const displayResult = result
    ? isResultLong && !resultExpanded
      ? result.slice(0, RESULT_TRUNCATE_LENGTH)
      : result
    : undefined;

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
            {"\u2713"}
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
          {displayResult != null && (
            <View>
              <Text style={[styles.sectionLabel, { color: colors.dim }]}>
                result
              </Text>
              <Text style={[styles.resultContent, { color: colors.success }]}>
                {displayResult}
              </Text>
              {isResultLong && (
                <AnimatedPressable onPress={toggleResult} style={styles.showMore}>
                  <Text style={[styles.showMoreText, { color: colors.accent }]}>
                    {resultExpanded ? "[show less]" : "[show more]"}
                  </Text>
                </AnimatedPressable>
              )}
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
  showMore: {
    marginTop: 4,
    minHeight: 28,
    justifyContent: "center",
  },
  showMoreText: {
    fontFamily: fonts.medium,
    fontSize: 11,
  },
});

function formatArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}
