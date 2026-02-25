/**
 * ProjectFilterBar — horizontal scrollable filter chips for multi-project.
 * Shows "all" + one chip per project. Tapping selects a filter.
 * Only renders when there are 2+ projects.
 */

import React from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";

interface ProjectFilterBarProps {
  projects: string[];
  selected: string | null; // null = "all"
  onSelect: (project: string | null) => void;
}

function ProjectFilterBarInner({
  projects,
  selected,
  onSelect,
}: ProjectFilterBarProps) {
  const { colors } = useTheme();

  // Don't render if only one project — no filtering needed
  if (projects.length < 2) return null;

  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <Chip
          label="all"
          active={selected === null}
          onPress={() => onSelect(null)}
        />
        {projects.map((name) => (
          <Chip
            key={name}
            label={name}
            active={selected === name}
            onPress={() => onSelect(name)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function Chip({ label, active, onPress }: ChipProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={[
        styles.chip,
        {
          borderColor: active ? colors.accent : colors.border,
          backgroundColor: active ? colors.accentDim : "transparent",
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: active ? colors.accent : colors.muted },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 14,
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    minHeight: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    fontFamily: fonts.regular,
    fontSize: 11,
    textTransform: "lowercase",
  },
});

const ProjectFilterBar = React.memo(ProjectFilterBarInner);
ProjectFilterBar.displayName = "ProjectFilterBar";

export default ProjectFilterBar;
