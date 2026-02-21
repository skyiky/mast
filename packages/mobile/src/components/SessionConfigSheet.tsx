/**
 * SessionConfigSheet — Terminal-style bottom sheet for session controls.
 *
 * Uses @gorhom/bottom-sheet instead of React Native Modal to avoid
 * hidden Modals stealing the gesture responder (Bug 4) and provides
 * native swipe-to-dismiss (Bug 5).
 *
 * Exposed via the `...` icon in chat header. Contains:
 * - Session info (status, project, created, messages)
 * - Verbosity toggle (standard/full)
 * - Mode toggle (build/plan — prepends "PLAN MODE:" to prompts)
 * - Abort button (red, only when agent is working)
 * - View diff (opens DiffSheet modal)
 * - Model selector (filtered to connected providers, deduplicated)
 * - Revert last (with confirmation + message re-fetch)
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { useShallow } from "zustand/react/shallow";
import { useTheme } from "../lib/ThemeContext";
import { type ThemeColors, fonts } from "../lib/themes";
import { useSettingsStore, type Verbosity, type SessionMode } from "../stores/settings";
import { useSessionStore, type ChatMessage } from "../stores/sessions";
import { useApi } from "../hooks/useApi";
import AnimatedPressable from "./AnimatedPressable";
import DiffSheet from "./DiffSheet";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelEntry {
  id: string;
  name: string;
}

interface ProviderGroup {
  provider: string;
  models: ModelEntry[];
  defaultModel: string;
}

interface SessionConfigSheetProps {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  /** Called when user reverts — returns the user prompt text to pre-fill */
  onRevert?: (promptText: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SessionConfigSheet({
  visible,
  onClose,
  sessionId,
  onRevert,
}: SessionConfigSheetProps) {
  const { colors } = useTheme();
  const api = useApi();
  const sheetRef = useRef<BottomSheet>(null);

  // Two snap points: 60% default, 90% expanded
  const snapPoints = useMemo(() => ["60%", "90%"], []);

  // Settings
  const verbosity = useSettingsStore((s) => s.verbosity);
  const setVerbosity = useSettingsStore((s) => s.setVerbosity);
  const sessionMode = useSettingsStore((s) => s.sessionMode);
  const setSessionMode = useSettingsStore((s) => s.setSessionMode);

  // Session data — useShallow prevents infinite re-render from unstable [] reference
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === sessionId));
  const sessionCreatedAt = session?.createdAt;
  const sessionDirectory = session?.directory;
  const messages = useSessionStore(useShallow((s) => s.messagesBySession[sessionId] ?? []));
  const setMessages = useSessionStore((s) => s.setMessages);
  const isStreaming = messages.some((m: ChatMessage) => m.streaming);

  // Fetched state
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [providerGroups, setProviderGroups] = useState<ProviderGroup[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [diffVisible, setDiffVisible] = useState(false);

  // -----------------------------------------------------------------------
  // Sheet control
  // -----------------------------------------------------------------------

  // Open/close the sheet based on the visible prop
  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  // Notify parent when sheet closes (swipe-down or backdrop tap)
  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) {
        onClose();
      }
    },
    [onClose],
  );

  // Semi-transparent backdrop — tap to close
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.6}
        pressBehavior="close"
      />
    ),
    [],
  );

  // -----------------------------------------------------------------------
  // Data fetching on open
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!visible) return;

    api.projectCurrent().then((res) => {
      if (res.status === 200 && res.body) {
        // OpenCode returns { worktree: "..." }, not { root } or { path }
        const p = res.body as { worktree?: string; path?: string; root?: string };
        setProjectPath(p.worktree ?? p.root ?? p.path ?? null);
      } else if (sessionDirectory) {
        // Fallback: use directory from session list API
        setProjectPath(sessionDirectory);
      }
    }).catch(() => {
      // API failed — use session directory as fallback
      if (sessionDirectory) setProjectPath(sessionDirectory);
    });

    // Bug 1 fix: build grouped model list from all[] for connected providers
    api.providers().then((res) => {
      if (res.status === 200 && res.body) {
        const data = res.body as {
          all?: Array<{
            id: string;
            models?: Record<string, { name?: string }>;
          }>;
          default?: Record<string, string>;
          connected?: string[];
        };
        const allProviders = data.all ?? [];
        const defaults = data.default ?? {};
        const connected = new Set(data.connected ?? []);

        const groups: ProviderGroup[] = [];

        for (const provider of allProviders) {
          if (!connected.has(provider.id)) continue;
          const modelsMap = provider.models;
          if (!modelsMap || typeof modelsMap !== "object") continue;

          const models: ModelEntry[] = Object.entries(modelsMap).map(
            ([id, info]) => ({
              id,
              name: (info && typeof info === "object" && info.name) || id,
            }),
          );
          // Sort alphabetically by display name
          models.sort((a, b) => a.name.localeCompare(b.name));

          groups.push({
            provider: provider.id,
            models,
            defaultModel: defaults[provider.id] ?? "",
          });
        }

        // Sort provider groups: most models first
        groups.sort((a, b) => b.models.length - a.models.length);
        setProviderGroups(groups);

        // Set initial selected model to the first connected provider's default
        if (!modelName && groups.length > 0) {
          setModelName(groups[0].defaultModel || groups[0].models[0]?.id || null);
        }
      }
    }).catch(() => {});
  }, [visible]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  // Abort
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

  // Bug 2 fix: revert removes both messages, pre-fills text box via onRevert
  const handleRevert = useCallback(() => {
    const lastAssistant = [...messages]
      .reverse()
      .find((m: ChatMessage) => m.role === "assistant");
    if (!lastAssistant) {
      Alert.alert("nothing to revert", "no assistant messages in this session.");
      return;
    }

    // Find the user message that triggered this assistant response
    const assistantIdx = messages.findIndex((m) => m.id === lastAssistant.id);
    let userPromptText = "";
    if (assistantIdx > 0) {
      const preceding = messages[assistantIdx - 1];
      if (preceding.role === "user") {
        const textPart = preceding.parts.find((p) => p.type === "text");
        userPromptText = textPart?.content ?? "";
      }
    }

    Alert.alert(
      "revert last response",
      "this will undo the agent's last response and any file changes it made. your prompt will be restored to the input box.",
      [
        { text: "cancel", style: "cancel" },
        {
          text: "revert",
          style: "destructive",
          onPress: async () => {
            setReverting(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            try {
              await api.revert(sessionId, lastAssistant.id);

              // Remove the assistant message + preceding user message locally
              const updated = messages.filter((m) => {
                if (m.id === lastAssistant.id) return false;
                if (assistantIdx > 0 && m.id === messages[assistantIdx - 1].id && m.role === "user") return false;
                return true;
              });
              setMessages(sessionId, updated);

              // Pre-fill the text box with the reverted user prompt
              if (userPromptText && onRevert) {
                onRevert(userPromptText);
              }

              // Close sheet after successful revert
              sheetRef.current?.close();
            } catch (err) {
              console.error("[config] revert failed:", err);
              Alert.alert("revert failed", "could not revert the last response.");
            } finally {
              setReverting(false);
            }
          },
        },
      ],
    );
  }, [api, sessionId, messages, setMessages, onRevert]);

  // Model select
  const handleModelSelect = useCallback((modelId: string) => {
    setModelName(modelId);
    setModelPickerOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // Look up display name for selected model
  const selectedModelDisplay = useMemo(() => {
    if (!modelName) return "...";
    for (const group of providerGroups) {
      const found = group.models.find((m) => m.id === modelName);
      if (found) return found.name;
    }
    // Fallback: use the ID itself
    return modelName;
  }, [modelName, providerGroups]);

  // Format created time
  const createdAgo = sessionCreatedAt
    ? formatTimeAgo(new Date(sessionCreatedAt))
    : "unknown";

  // Shorten project path for display
  const displayPath = projectPath
    ? projectPath.replace(/^\/home\/[^/]+/, "~").replace(/^C:\\Users\\[^\\]+/, "~")
    : "...";

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <>
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose={true}
        onChange={handleSheetChange}
        backdropComponent={renderBackdrop}
        backgroundStyle={{
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
        handleIndicatorStyle={{
          backgroundColor: colors.dim,
          width: 36,
          height: 4,
        }}
      >
        <BottomSheetScrollView
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
                {selectedModelDisplay}
              </Text>
            </Pressable>

            {/* Model dropdown — grouped by provider */}
            {modelPickerOpen && providerGroups.length > 0 && (
              <View
                style={[
                  styles.dropdown,
                  { backgroundColor: colors.bg, borderColor: colors.border },
                ]}
              >
                {providerGroups.map((group) => (
                  <View key={group.provider}>
                    <Text
                      style={[
                        styles.providerHeader,
                        { color: colors.muted },
                      ]}
                    >
                      {`// ${group.provider} (${group.models.length})`}
                    </Text>
                    {group.models.map((model) => {
                      const isSelected = model.id === modelName;
                      const isDefault = model.id === group.defaultModel;
                      return (
                        <AnimatedPressable
                          key={`${group.provider}/${model.id}`}
                          onPress={() => handleModelSelect(model.id)}
                          style={[
                            styles.dropdownItem,
                            isSelected && {
                              backgroundColor: colors.accentDim,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.dropdownText,
                              {
                                color: isSelected
                                  ? colors.accent
                                  : colors.text,
                              },
                            ]}
                            numberOfLines={1}
                          >
                            {model.name}
                            {isDefault ? " *" : ""}
                          </Text>
                        </AnimatedPressable>
                      );
                    })}
                  </View>
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
                  style={styles.spinner}
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
            {/* Revert — Bug 2 fix: loading spinner + re-fetch */}
            <AnimatedPressable
              onPress={handleRevert}
              disabled={messages.length === 0 || reverting}
              style={[
                styles.actionRow,
                (messages.length === 0 || reverting) && styles.disabledRow,
              ]}
            >
              {reverting ? (
                <ActivityIndicator
                  size="small"
                  color={colors.warning}
                  style={styles.spinner}
                />
              ) : (
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
              )}
            </AnimatedPressable>
          </View>

          {/* Bottom padding */}
          <View style={styles.bottomPad} />
        </BottomSheetScrollView>
      </BottomSheet>

      {/* Bug 4 fix: DiffSheet only mounted when visible (no hidden Modal) */}
      {diffVisible && (
        <DiffSheet
          visible={diffVisible}
          onClose={() => setDiffVisible(false)}
          sessionId={sessionId}
        />
      )}
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
    flexShrink: 1,
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
  spinner: {
    marginLeft: 0,
  },
  dropdown: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  providerHeader: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
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
