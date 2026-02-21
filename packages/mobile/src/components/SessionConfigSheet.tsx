/**
 * SessionConfigSheet — Terminal-style bottom sheet for session controls.
 *
 * Exposed via the `...` icon in chat header. Contains:
 * - Session info (status, project, created, messages)
 * - Verbosity toggle (standard/full)
 * - Mode toggle (build/plan — prepends "PLAN MODE:" to prompts)
 * - Abort button (red, only when agent is working)
 * - View diff (opens DiffSheet modal)
 * - Model selector (dropdown from GET /provider)
 * - Revert last (with confirmation)
 *
 * Uses React Native Modal with slide animation.
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  Alert,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useShallow } from "zustand/react/shallow";
import { useTheme } from "../lib/ThemeContext";
import { type ThemeColors, fonts } from "../lib/themes";
import { useSettingsStore, type Verbosity, type SessionMode } from "../stores/settings";
import { useSessionStore, type ChatMessage } from "../stores/sessions";
import { useApi } from "../hooks/useApi";
import AnimatedPressable from "./AnimatedPressable";
import DiffSheet from "./DiffSheet";

interface SessionConfigSheetProps {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
}

export default function SessionConfigSheet({
  visible,
  onClose,
  sessionId,
}: SessionConfigSheetProps) {
  const { colors } = useTheme();
  const api = useApi();

  // Settings
  const verbosity = useSettingsStore((s) => s.verbosity);
  const setVerbosity = useSettingsStore((s) => s.setVerbosity);
  const sessionMode = useSettingsStore((s) => s.sessionMode);
  const setSessionMode = useSettingsStore((s) => s.setSessionMode);

  // Session data — useShallow prevents infinite re-render from unstable [] reference
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === sessionId));
  const messages = useSessionStore(useShallow((s) => s.messagesBySession[sessionId] ?? []));
  const isStreaming = messages.some((m: ChatMessage) => m.streaming);

  // Fetched state
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [diffVisible, setDiffVisible] = useState(false);

  // Fetch project info and provider on open
  useEffect(() => {
    if (!visible) return;
    api.projectCurrent().then((res) => {
      if (res.status === 200 && res.body) {
        const p = res.body as { path?: string; root?: string };
        setProjectPath(p.root ?? p.path ?? null);
      }
    }).catch(() => {});

    api.providers().then((res) => {
      if (res.status === 200 && res.body) {
        const data = res.body as {
          default?: Record<string, string>;
          connected?: string[];
        };
        // Get current default model
        const defaults = data.default ?? {};
        const firstModel = Object.values(defaults)[0] ?? null;
        setModelName(firstModel);

        // Build list of available models from all defaults
        const models = Object.values(defaults).filter(Boolean);
        setAvailableModels(models);
      }
    }).catch(() => {});
  }, [visible]);

  // Abort handler
  const handleAbort = useCallback(async () => {
    setAborting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await api.abort(sessionId);
    } catch (err) {
      console.error("[config] abort failed:", err);
    } finally {
      setAborting(false);
    }
  }, [api, sessionId]);

  // Revert handler
  const handleRevert = useCallback(() => {
    // Find last assistant message
    const lastAssistant = [...messages]
      .reverse()
      .find((m: ChatMessage) => m.role === "assistant");
    if (!lastAssistant) {
      Alert.alert("nothing to revert", "no assistant messages in this session.");
      return;
    }

    Alert.alert(
      "revert last response",
      "this will undo the agent's last response and any file changes it made. continue?",
      [
        { text: "cancel", style: "cancel" },
        {
          text: "revert",
          style: "destructive",
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            try {
              await api.revert(sessionId, lastAssistant.id);
            } catch (err) {
              console.error("[config] revert failed:", err);
            }
          },
        },
      ],
    );
  }, [api, sessionId, messages]);

  // Model select handler
  const handleModelSelect = useCallback((model: string) => {
    setModelName(model);
    setModelPickerOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Note: model is applied per-prompt in chat screen via settings store
    // For now we just track it locally — will be sent with next prompt
  }, []);

  // Format created time
  const createdAgo = session?.createdAt
    ? formatTimeAgo(new Date(session.createdAt))
    : "unknown";

  // Shorten project path for display
  const displayPath = projectPath
    ? projectPath.replace(/^\/home\/[^/]+/, "~").replace(/^C:\\Users\\[^\\]+/, "~")
    : "...";

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <View />
        </Pressable>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
            },
          ]}
        >
          {/* Drag handle */}
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.dim }]} />
          </View>

          <ScrollView
            style={styles.scrollContent}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            {/* // session */}
            <SectionHeader title="// session" colors={colors} />
            <View style={[styles.card, { borderColor: colors.border }]}>
              <InfoRow
                label="status"
                value={isStreaming ? "working" : "idle"}
                dot={isStreaming ? "yellow" : "green"}
                colors={colors}
              />
              <Divider colors={colors} />
              <InfoRow label="project" value={displayPath} colors={colors} />
              <Divider colors={colors} />
              <InfoRow label="created" value={createdAgo} colors={colors} />
              <Divider colors={colors} />
              <InfoRow
                label="messages"
                value={String(messages.length)}
                colors={colors}
              />
            </View>

            {/* // controls */}
            <SectionHeader title="// controls" colors={colors} />
            <View style={[styles.card, { borderColor: colors.border }]}>
              <ToggleRow
                label="verbosity"
                options={[
                  { value: "standard" as Verbosity, label: "std" },
                  { value: "full" as Verbosity, label: "full" },
                ]}
                selected={verbosity}
                onSelect={(v) => {
                  setVerbosity(v as Verbosity);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                colors={colors}
              />
              <Divider colors={colors} />
              <ToggleRow
                label="mode"
                options={[
                  { value: "build" as SessionMode, label: "build" },
                  { value: "plan" as SessionMode, label: "plan" },
                ]}
                selected={sessionMode}
                onSelect={(v) => {
                  setSessionMode(v as SessionMode);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                colors={colors}
              />
              <Divider colors={colors} />

              {/* Model selector */}
              <Pressable
                onPress={() => setModelPickerOpen(!modelPickerOpen)}
                style={styles.actionRow}
              >
                <Text style={[styles.actionLabel, { color: colors.text }]}>
                  model
                </Text>
                <Text
                  style={[styles.actionValue, { color: colors.accent }]}
                  numberOfLines={1}
                >
                  {modelName
                    ? modelName.split("/").pop() ?? modelName
                    : "..."}
                </Text>
              </Pressable>

              {/* Model dropdown */}
              {modelPickerOpen && availableModels.length > 0 && (
                <View
                  style={[
                    styles.dropdown,
                    { backgroundColor: colors.bg, borderColor: colors.border },
                  ]}
                >
                  {availableModels.map((model) => (
                    <AnimatedPressable
                      key={model}
                      onPress={() => handleModelSelect(model)}
                      style={[
                        styles.dropdownItem,
                        model === modelName && {
                          backgroundColor: colors.accentDim,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dropdownText,
                          {
                            color:
                              model === modelName ? colors.accent : colors.text,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {model.split("/").pop() ?? model}
                      </Text>
                    </AnimatedPressable>
                  ))}
                </View>
              )}
            </View>

            {/* // inspect */}
            <SectionHeader title="// inspect" colors={colors} />
            <View style={[styles.card, { borderColor: colors.border }]}>
              <AnimatedPressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDiffVisible(true);
                }}
                style={styles.actionRow}
              >
                <Text style={[styles.actionLabel, { color: colors.text }]}>
                  view diff
                </Text>
                <Text style={[styles.chevron, { color: colors.dim }]}>
                  {"\u2192"}
                </Text>
              </AnimatedPressable>
            </View>

            {/* // actions */}
            <SectionHeader title="// actions" colors={colors} />
            <View style={[styles.card, { borderColor: colors.border }]}>
              {/* Abort — only when streaming */}
              <AnimatedPressable
                onPress={handleAbort}
                disabled={!isStreaming || aborting}
                style={[
                  styles.actionRow,
                  (!isStreaming || aborting) && styles.disabledRow,
                ]}
              >
                {aborting ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.danger}
                    style={styles.abortSpinner}
                  />
                ) : (
                  <Text
                    style={[
                      styles.dangerLabel,
                      {
                        color: isStreaming ? colors.danger : colors.dim,
                      },
                    ]}
                  >
                    [abort execution]
                  </Text>
                )}
              </AnimatedPressable>
              <Divider colors={colors} />
              {/* Revert */}
              <AnimatedPressable
                onPress={handleRevert}
                disabled={messages.length === 0}
                style={[
                  styles.actionRow,
                  messages.length === 0 && styles.disabledRow,
                ]}
              >
                <Text
                  style={[
                    styles.dangerLabel,
                    {
                      color:
                        messages.length > 0 ? colors.warning : colors.dim,
                    },
                  ]}
                >
                  [revert last response]
                </Text>
              </AnimatedPressable>
            </View>

            {/* Bottom padding */}
            <View style={styles.bottomPad} />
          </ScrollView>
        </View>
      </Modal>

      {/* Diff popup */}
      <DiffSheet
        visible={diffVisible}
        onClose={() => setDiffVisible(false)}
        sessionId={sessionId}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({
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

function Divider({ colors }: { colors: ThemeColors }) {
  return (
    <View style={[styles.divider, { backgroundColor: colors.border }]} />
  );
}

function InfoRow({
  label,
  value,
  dot,
  colors,
}: {
  label: string;
  value: string;
  dot?: "green" | "yellow" | "red";
  colors: ThemeColors;
}) {
  const dotColor = dot
    ? { green: colors.success, yellow: colors.warning, red: colors.danger }[dot]
    : null;

  return (
    <View style={styles.infoRow}>
      {dotColor && (
        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      )}
      <Text style={[styles.infoLabel, { color: colors.text }]}>{label}</Text>
      <Text
        style={[styles.infoValue, { color: colors.muted }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function ToggleRow<T extends string>({
  label,
  options,
  selected,
  onSelect,
  colors,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.toggleButtons}>
        {options.map((opt) => (
          <AnimatedPressable
            key={opt.value}
            onPress={() => onSelect(opt.value)}
            pressScale={0.95}
            style={[
              styles.toggleBtn,
              {
                borderColor:
                  selected === opt.value ? colors.accent : colors.border,
                backgroundColor:
                  selected === opt.value ? colors.accentDim : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.toggleBtnText,
                {
                  color:
                    selected === opt.value ? colors.accent : colors.muted,
                },
              ]}
            >
              {opt.label}
            </Text>
          </AnimatedPressable>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  sheet: {
    borderTopWidth: 1,
    maxHeight: "75%",
  },
  handleRow: {
    alignItems: "center",
    paddingVertical: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  scrollContent: {
    paddingHorizontal: 0,
  },
  sectionHeader: {
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 1,
    paddingHorizontal: 18,
    paddingVertical: 6,
    marginTop: 2,
  },
  card: {
    marginHorizontal: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  divider: {
    height: 1,
    marginLeft: 14,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  infoLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    flex: 1,
  },
  infoValue: {
    fontFamily: fonts.regular,
    fontSize: 12,
    maxWidth: 200,
  },
  toggleRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toggleLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    marginBottom: 8,
  },
  toggleButtons: {
    flexDirection: "row",
    gap: 8,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  toggleBtnText: {
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
  },
  disabledRow: {
    opacity: 0.4,
  },
  actionLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    flex: 1,
  },
  actionValue: {
    fontFamily: fonts.regular,
    fontSize: 12,
    maxWidth: 180,
  },
  chevron: {
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  dangerLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  abortSpinner: {
    marginLeft: 0,
  },
  dropdown: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
  },
  dropdownText: {
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  bottomPad: {
    height: 20,
  },
});
