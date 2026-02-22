/**
 * Settings screen — terminal style. Connection status, preferences, re-pair.
 */

import React, { useState } from "react";
import { View, Text, ScrollView, Alert, Modal, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useConnectionStore } from "../src/stores/connection";
import { useSettingsStore, type Verbosity } from "../src/stores/settings";
import { useTheme } from "../src/lib/ThemeContext";
import { type ThemeColors, fonts } from "../src/lib/themes";
import AnimatedPressable from "../src/components/AnimatedPressable";
import { SectionHeader, Divider } from "../src/components/SectionHeader";

export default function SettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [urlPopupVisible, setUrlPopupVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const wsConnected = useConnectionStore((s) => s.wsConnected);
  const daemonConnected = useConnectionStore((s) => s.daemonConnected);
  const opencodeReady = useConnectionStore((s) => s.opencodeReady);
  const reset = useConnectionStore((s) => s.reset);

  const verbosity = useSettingsStore((s) => s.verbosity);
  const setVerbosity = useSettingsStore((s) => s.setVerbosity);

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

  const handleCopyUrl = async () => {
    if (serverUrl) {
      await Clipboard.setStringAsync(serverUrl);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
});
