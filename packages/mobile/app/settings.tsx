/**
 * Settings screen — terminal style. Connection status, projects, preferences, re-pair.
 */

import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, Alert, Modal, Pressable, TextInput, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useConnectionStore } from "../src/stores/connection";
import { useSettingsStore, type Verbosity } from "../src/stores/settings";
import { useApi } from "../src/hooks/useApi";
import { useTheme } from "../src/lib/ThemeContext";
import { type ThemeColors, fonts } from "../src/lib/themes";
import { supabase } from "../src/lib/supabase";
import AnimatedPressable from "../src/components/AnimatedPressable";
import { SectionHeader, Divider } from "../src/components/SectionHeader";
import type { Project } from "../src/lib/api";

export default function SettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [urlPopupVisible, setUrlPopupVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addProjectVisible, setAddProjectVisible] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDir, setProjectDir] = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const paired = useConnectionStore((s) => s.paired);
  const wsConnected = useConnectionStore((s) => s.wsConnected);
  const daemonConnected = useConnectionStore((s) => s.daemonConnected);
  const opencodeReady = useConnectionStore((s) => s.opencodeReady);
  const reset = useConnectionStore((s) => s.reset);

  const verbosity = useSettingsStore((s) => s.verbosity);
  const setVerbosity = useSettingsStore((s) => s.setVerbosity);

  const api = useApi();

  // Fetch projects on mount
  const loadProjects = useCallback(async () => {
    if (!paired || !serverUrl) return;
    setLoadingProjects(true);
    try {
      const res = await api.projects();
      if (res.status === 200 && Array.isArray(res.body)) {
        setProjects(res.body as Project[]);
      }
    } catch (err) {
      console.error("[settings] Failed to load projects:", err);
    } finally {
      setLoadingProjects(false);
    }
  }, [api, paired, serverUrl]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleRepair = () => {
    Alert.alert(
      "re-pair device",
      "this will disconnect and require re-pairing. continue?",
      [
        { text: "cancel", style: "cancel" },
        {
          text: "re-pair",
          style: "destructive",
          onPress: () => {
            reset();
            router.replace("/pair");
          },
        },
      ],
    );
  };

  const handleSignOut = () => {
    Alert.alert(
      "sign out",
      "this will sign you out. your device pairing will be preserved. continue?",
      [
        { text: "cancel", style: "cancel" },
        {
          text: "sign out",
          style: "destructive",
          onPress: async () => {
            await supabase.auth.signOut();
            useConnectionStore.getState().signOut();
            router.replace("/login");
          },
        },
      ],
    );
  };

  const handleCopyUrl = async () => {
    if (serverUrl) {
      await Clipboard.setStringAsync(serverUrl);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleAddProject = async () => {
    const name = projectName.trim();
    const dir = projectDir.trim();
    if (!name || !dir) {
      Alert.alert("error", "both name and directory are required.");
      return;
    }
    setAddingProject(true);
    try {
      const res = await api.addProject(name, dir);
      if (res.status === 200) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setAddProjectVisible(false);
        setProjectName("");
        setProjectDir("");
        await loadProjects();
      } else {
        const msg = (res.body as any)?.error ?? "failed to add project";
        Alert.alert("error", msg);
      }
    } catch (err) {
      Alert.alert("error", "failed to add project. check connection.");
    } finally {
      setAddingProject(false);
    }
  };

  const handleRemoveProject = (project: Project) => {
    Alert.alert(
      "remove project",
      `stop managing "${project.name}"?\nthis will shut down its opencode instance.`,
      [
        { text: "cancel", style: "cancel" },
        {
          text: "remove",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await api.removeProject(project.name);
              if (res.status === 200) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                await loadProjects();
              } else {
                const msg = (res.body as any)?.error ?? "failed to remove project";
                Alert.alert("error", msg);
              }
            } catch (err) {
              Alert.alert("error", "failed to remove project.");
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* Connection Status */}
      <SectionHeader title="// connection" colors={colors} />
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Pressable onPress={() => setUrlPopupVisible(true)}>
          <StatusRow
            label="server"
            value={serverUrl || "not configured"}
            status={wsConnected ? "green" : "red"}
            colors={colors}
          />
        </Pressable>
        <Divider colors={colors} />
        <StatusRow
          label="daemon"
          value={daemonConnected ? "connected" : "offline"}
          status={daemonConnected ? "green" : "red"}
          colors={colors}
        />
        <Divider colors={colors} />
        <StatusRow
          label="opencode"
          value={opencodeReady ? "ready" : "not ready"}
          status={opencodeReady ? "green" : daemonConnected ? "yellow" : "red"}
          colors={colors}
        />
      </View>

      {/* Projects */}
      <SectionHeader title="// projects" colors={colors} />
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        {loadingProjects ? (
          <View style={styles.projectLoading}>
            <ActivityIndicator size="small" color={colors.muted} />
          </View>
        ) : projects.length === 0 ? (
          <View style={styles.projectEmpty}>
            <Text style={[styles.projectEmptyText, { color: colors.dim }]}>
              no projects configured
            </Text>
          </View>
        ) : (
          projects.map((project, index) => (
            <React.Fragment key={project.name}>
              {index > 0 && <Divider colors={colors} />}
              <AnimatedPressable
                onLongPress={() => handleRemoveProject(project)}
                delayLongPress={500}
                style={styles.projectRow}
              >
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: project.ready ? colors.success : colors.warning },
                  ]}
                />
                <View style={styles.projectInfo}>
                  <Text style={[styles.projectName, { color: colors.text }]}>
                    {project.name}
                  </Text>
                  <Text
                    style={[styles.projectDir, { color: colors.dim }]}
                    numberOfLines={1}
                  >
                    {project.directory}
                  </Text>
                </View>
                <Text style={[styles.projectStatus, { color: project.ready ? colors.success : colors.warning }]}>
                  {project.ready ? "ready" : "starting"}
                </Text>
              </AnimatedPressable>
            </React.Fragment>
          ))
        )}
        <Divider colors={colors} />
        <AnimatedPressable
          onPress={() => setAddProjectVisible(true)}
          style={styles.addProjectBtn}
        >
          <Text style={[styles.addProjectText, { color: colors.accent }]}>
            [add project]
          </Text>
        </AnimatedPressable>
      </View>

      {/* Display */}
      <SectionHeader title="// display" colors={colors} />
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <OptionRow
          label="verbosity"
          options={[
            { value: "standard" as Verbosity, label: "std" },
            { value: "full" as Verbosity, label: "full" },
          ]}
          selected={verbosity}
          onSelect={(v) => setVerbosity(v as Verbosity)}
          colors={colors}
        />
      </View>

      {/* Device */}
      <SectionHeader title="// device" colors={colors} />
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <AnimatedPressable
          onPress={handleRepair}
          style={styles.repairBtn}
        >
          <Text style={[styles.repairText, { color: colors.danger }]}>
            [re-pair device]
          </Text>
        </AnimatedPressable>
        <Divider colors={colors} />
        <AnimatedPressable
          onPress={handleSignOut}
          style={styles.repairBtn}
        >
          <Text style={[styles.repairText, { color: colors.danger }]}>
            [sign out]
          </Text>
        </AnimatedPressable>
      </View>

      {/* About */}
      <SectionHeader title="// about" colors={colors} />
      <View style={[styles.cardLast, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <View style={styles.aboutContent}>
          <Text style={[styles.aboutTitle, { color: colors.bright }]}>
            mast
          </Text>
          <Text style={[styles.aboutVersion, { color: colors.dim }]}>
            v0.0.1 — phase 5 dogfood
          </Text>
        </View>
      </View>

      {/* Server URL popup */}
      <Modal
        visible={urlPopupVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setUrlPopupVisible(false)}
      >
        <Pressable
          style={styles.popupOverlay}
          onPress={() => setUrlPopupVisible(false)}
        >
          <View
            style={[
              styles.popupCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.popupLabel, { color: colors.muted }]}>
              // server url
            </Text>
            <Text
              style={[styles.popupUrl, { color: colors.bright }]}
              selectable
            >
              {serverUrl || "not configured"}
            </Text>
            <View style={styles.popupActions}>
              <AnimatedPressable
                onPress={handleCopyUrl}
                style={[
                  styles.popupBtn,
                  {
                    borderColor: copied ? colors.success : colors.accent,
                    backgroundColor: copied ? colors.successDim : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.popupBtnText,
                    { color: copied ? colors.success : colors.accent },
                  ]}
                >
                  {copied ? "copied" : "copy"}
                </Text>
              </AnimatedPressable>
              <AnimatedPressable
                onPress={() => setUrlPopupVisible(false)}
                style={[styles.popupBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.popupBtnText, { color: colors.muted }]}>
                  close
                </Text>
              </AnimatedPressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Add Project modal */}
      <Modal
        visible={addProjectVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddProjectVisible(false)}
      >
        <Pressable
          style={styles.popupOverlay}
          onPress={() => setAddProjectVisible(false)}
        >
          <Pressable
            style={[
              styles.popupCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            onPress={() => {}} // prevent dismiss when tapping inside card
          >
            <Text style={[styles.popupLabel, { color: colors.muted }]}>
              // add project
            </Text>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              name
            </Text>
            <TextInput
              value={projectName}
              onChangeText={setProjectName}
              placeholder="my-project"
              placeholderTextColor={colors.dim}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.textInput,
                {
                  color: colors.bright,
                  borderColor: colors.border,
                  backgroundColor: colors.bg,
                },
              ]}
            />
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              directory
            </Text>
            <TextInput
              value={projectDir}
              onChangeText={setProjectDir}
              placeholder="/home/user/projects/my-project"
              placeholderTextColor={colors.dim}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.textInput,
                {
                  color: colors.bright,
                  borderColor: colors.border,
                  backgroundColor: colors.bg,
                },
              ]}
            />
            <View style={styles.popupActions}>
              <AnimatedPressable
                onPress={handleAddProject}
                disabled={addingProject}
                style={[
                  styles.popupBtn,
                  {
                    borderColor: colors.success,
                    backgroundColor: addingProject ? colors.successDim : "transparent",
                  },
                ]}
              >
                {addingProject ? (
                  <ActivityIndicator size="small" color={colors.success} />
                ) : (
                  <Text style={[styles.popupBtnText, { color: colors.success }]}>
                    add
                  </Text>
                )}
              </AnimatedPressable>
              <AnimatedPressable
                onPress={() => {
                  setAddProjectVisible(false);
                  setProjectName("");
                  setProjectDir("");
                }}
                style={[styles.popupBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.popupBtnText, { color: colors.muted }]}>
                  cancel
                </Text>
              </AnimatedPressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function StatusRow({
  label,
  value,
  status,
  colors,
}: {
  label: string;
  value: string;
  status: "green" | "yellow" | "red";
  colors: ThemeColors;
}) {
  const dotColor = {
    green: colors.success,
    yellow: colors.warning,
    red: colors.danger,
  }[status];

  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      <Text style={[styles.statusLabel, { color: colors.text }]}>
        {label}
      </Text>
      <Text
        style={[styles.statusValue, { color: colors.muted }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function OptionRow<T extends string>({
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
    <View style={styles.optionRow}>
      <Text style={[styles.optionLabel, { color: colors.text }]}>
        {label}
      </Text>
      <View style={styles.optionButtons}>
        {options.map((opt) => (
          <AnimatedPressable
            key={opt.value}
            onPress={() => onSelect(opt.value)}
            pressScale={0.95}
            style={[
              styles.optionBtn,
              {
                borderColor: selected === opt.value ? colors.accent : colors.border,
                backgroundColor: selected === opt.value ? colors.accentDim : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.optionBtnText,
                { color: selected === opt.value ? colors.accent : colors.muted },
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  card: {
    marginHorizontal: 14,
    borderWidth: 1,
    marginBottom: 20,
  },
  cardLast: {
    marginHorizontal: 14,
    borderWidth: 1,
    marginBottom: 40,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  statusLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    flex: 1,
  },
  statusValue: {
    fontFamily: fonts.regular,
    fontSize: 12,
    flexShrink: 1,
    maxWidth: 180,
  },
  repairBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  repairText: {
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  aboutContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  aboutTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  aboutVersion: {
    fontFamily: fonts.regular,
    fontSize: 11,
    marginTop: 2,
  },
  optionRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    marginBottom: 8,
  },
  optionButtons: {
    flexDirection: "row",
    gap: 8,
  },
  optionBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  optionBtnText: {
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  popupOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  popupCard: {
    width: "100%",
    borderWidth: 1,
    padding: 20,
  },
  popupLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 8,
  },
  popupUrl: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 16,
  },
  popupActions: {
    flexDirection: "row",
    gap: 10,
  },
  popupBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  popupBtnText: {
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  projectLoading: {
    paddingVertical: 16,
    alignItems: "center",
  },
  projectEmpty: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  projectEmptyText: {
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
  },
  projectInfo: {
    flex: 1,
    marginLeft: 0,
  },
  projectName: {
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  projectDir: {
    fontFamily: fonts.regular,
    fontSize: 11,
    marginTop: 2,
  },
  projectStatus: {
    fontFamily: fonts.regular,
    fontSize: 11,
    marginLeft: 8,
  },
  addProjectBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  addProjectText: {
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  inputLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    marginBottom: 4,
    marginTop: 10,
  },
  textInput: {
    fontFamily: fonts.regular,
    fontSize: 13,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
});
