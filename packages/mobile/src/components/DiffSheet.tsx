/**
 * DiffSheet — Full-screen modal showing file diffs for a session.
 *
 * Fetches from GET /sessions/:id/diff and renders as terminal-style
 * unified diff output. Opens as a modal for fast back-and-forth
 * with the chat screen.
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";
import { useApi } from "../hooks/useApi";
import AnimatedPressable from "./AnimatedPressable";

interface DiffEntry {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface DiffSheetProps {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
}

export default function DiffSheet({
  visible,
  onClose,
  sessionId,
}: DiffSheetProps) {
  const { colors } = useTheme();
  const api = useApi();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(false);
  const [diffs, setDiffs] = useState<DiffEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Fetch diffs when opened
  useEffect(() => {
    if (!visible) {
      setDiffs([]);
      setError(null);
      setExpandedFiles(new Set());
      return;
    }
    setLoading(true);
    api
      .diff(sessionId)
      .then((res) => {
        if (res.status === 200 && Array.isArray(res.body)) {
          setDiffs(res.body as DiffEntry[]);
        } else {
          setError("failed to load diff");
        }
      })
      .catch(() => setError("failed to load diff"))
      .finally(() => setLoading(false));
  }, [visible, sessionId]);

  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.bg,
            paddingTop: insets.top,
          },
        ]}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.title, { color: colors.bright }]}>
            // diff
          </Text>
          <AnimatedPressable onPress={onClose} style={styles.closeBtn}>
            <Text style={[styles.closeText, { color: colors.accent }]}>
              [close]
            </Text>
          </AnimatedPressable>
        </View>

        {/* Content */}
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        )}

        {error && (
          <View style={styles.center}>
            <Text style={[styles.errorText, { color: colors.danger }]}>
              {error}
            </Text>
          </View>
        )}

        {!loading && !error && diffs.length === 0 && (
          <View style={styles.center}>
            <Text style={[styles.emptyText, { color: colors.dim }]}>
              no changes
            </Text>
          </View>
        )}

        {!loading && !error && diffs.length > 0 && (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          >
            {/* Summary */}
            <View style={styles.summary}>
              <Text style={[styles.summaryText, { color: colors.muted }]}>
                {diffs.length} file{diffs.length !== 1 ? "s" : ""} changed
              </Text>
              <Text style={[styles.summaryAdded, { color: colors.success }]}>
                +{diffs.reduce((sum, d) => sum + d.additions, 0)}
              </Text>
              <Text style={[styles.summaryRemoved, { color: colors.danger }]}>
                -{diffs.reduce((sum, d) => sum + d.deletions, 0)}
              </Text>
            </View>

            {/* File list */}
            {diffs.map((diff) => (
              <View
                key={diff.path}
                style={[styles.fileBlock, { borderColor: colors.border }]}
              >
                {/* File header — tap to expand/collapse */}
                <Pressable
                  onPress={() => diff.patch && toggleFile(diff.path)}
                  style={styles.fileHeader}
                >
                  <Text
                    style={[
                      styles.fileStatus,
                      {
                        color:
                          diff.status === "added"
                            ? colors.success
                            : diff.status === "deleted"
                              ? colors.danger
                              : colors.warning,
                      },
                    ]}
                  >
                    {diff.status === "added"
                      ? "A"
                      : diff.status === "deleted"
                        ? "D"
                        : "M"}
                  </Text>
                  <Text
                    style={[styles.filePath, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {diff.path}
                  </Text>
                  <Text style={[styles.fileStats, { color: colors.success }]}>
                    +{diff.additions}
                  </Text>
                  <Text style={[styles.fileStats, { color: colors.danger }]}>
                    -{diff.deletions}
                  </Text>
                  {diff.patch && (
                    <Text style={[styles.expandIcon, { color: colors.dim }]}>
                      {expandedFiles.has(diff.path) ? "\u25BC" : "\u25B6"}
                    </Text>
                  )}
                </Pressable>

                {/* Patch content */}
                {expandedFiles.has(diff.path) && diff.patch && (
                  <ScrollView
                    horizontal
                    style={[
                      styles.patchScroll,
                      { backgroundColor: colors.bg, borderTopColor: colors.border },
                    ]}
                  >
                    <View style={styles.patchContent}>
                      {diff.patch.split("\n").map((line, idx) => {
                        let lineColor = colors.text;
                        if (line.startsWith("+")) lineColor = colors.success;
                        else if (line.startsWith("-")) lineColor = colors.danger;
                        else if (line.startsWith("@@"))
                          lineColor = colors.accent;

                        return (
                          <Text
                            key={idx}
                            style={[styles.patchLine, { color: lineColor }]}
                          >
                            {line}
                          </Text>
                        );
                      })}
                    </View>
                  </ScrollView>
                )}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  closeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 44,
    justifyContent: "center",
  },
  closeText: {
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    fontStyle: "italic",
  },
  scroll: {
    flex: 1,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  summaryText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    flex: 1,
  },
  summaryAdded: {
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  summaryRemoved: {
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  fileBlock: {
    marginHorizontal: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 44,
    gap: 8,
  },
  fileStatus: {
    fontFamily: fonts.bold,
    fontSize: 12,
    width: 16,
    textAlign: "center",
  },
  filePath: {
    fontFamily: fonts.regular,
    fontSize: 12,
    flex: 1,
  },
  fileStats: {
    fontFamily: fonts.regular,
    fontSize: 11,
  },
  expandIcon: {
    fontFamily: fonts.regular,
    fontSize: 10,
    width: 16,
    textAlign: "center",
  },
  patchScroll: {
    maxHeight: 300,
    borderTopWidth: 1,
    borderTopColor: undefined, // set via inline style with colors.border
  },
  patchContent: {
    padding: 10,
    minWidth: "100%",
  },
  patchLine: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
  },
});
