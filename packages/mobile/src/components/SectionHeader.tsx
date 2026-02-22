/**
 * SectionHeader + Divider — shared layout primitives for settings-style screens.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { type ThemeColors, fonts } from "../lib/themes";

export function SectionHeader({
  title,
  colors,
}: {
  title: string;
  colors: ThemeColors;
}) {
  return (
    <Text style={[styles.sectionHeader, { color: colors.muted }]}>
      {title}
    </Text>
  );
}

export function Divider({ colors }: { colors: ThemeColors }) {
  return (
    <View style={[styles.divider, { backgroundColor: colors.border }]} />
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 1,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginTop: 4,
  },
  divider: {
    height: 1,
    marginLeft: 14,
  },
});
