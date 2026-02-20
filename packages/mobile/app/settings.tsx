/**
 * Settings screen — terminal style. Connection status, preferences, re-pair.
 */

import React from "react";
import { View, Text, TouchableOpacity, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useConnectionStore } from "../src/stores/connection";
import { useSettingsStore, type Verbosity } from "../src/stores/settings";
import { useTheme } from "../src/lib/ThemeContext";
import { fonts } from "../src/lib/themes";

export default function SettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();

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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Connection Status */}
      <SectionHeader title="// connection" colors={colors} />
      <View
        style={{
          marginHorizontal: 14,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          marginBottom: 20,
        }}
      >
        <StatusRow
          label="server"
          value={serverUrl || "not configured"}
          status={wsConnected ? "green" : "red"}
          colors={colors}
        />
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
      <View
        style={{
          marginHorizontal: 14,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          marginBottom: 20,
        }}
      >
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
      <View
        style={{
          marginHorizontal: 14,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          marginBottom: 20,
        }}
      >
        <TouchableOpacity
          onPress={handleRepair}
          activeOpacity={0.6}
          style={{ paddingHorizontal: 14, paddingVertical: 12 }}
        >
          <Text
            style={{
              fontFamily: fonts.medium,
              fontSize: 13,
              color: colors.danger,
            }}
          >
            [re-pair device]
          </Text>
        </TouchableOpacity>
      </View>

      {/* About */}
      <SectionHeader title="// about" colors={colors} />
      <View
        style={{
          marginHorizontal: 14,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          marginBottom: 40,
        }}
      >
        <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
          <Text
            style={{
              fontFamily: fonts.bold,
              fontSize: 14,
              color: colors.bright,
            }}
          >
            mast
          </Text>
          <Text
            style={{
              fontFamily: fonts.regular,
              fontSize: 11,
              color: colors.dim,
              marginTop: 2,
            }}
          >
            v0.0.1 — phase 5 dogfood
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function SectionHeader({ title, colors }: { title: string; colors: any }) {
  return (
    <Text
      style={{
        fontFamily: fonts.medium,
        fontSize: 11,
        color: colors.muted,
        letterSpacing: 1,
        paddingHorizontal: 18,
        paddingVertical: 8,
        marginTop: 4,
      }}
    >
      {title}
    </Text>
  );
}

function Divider({ colors }: { colors: any }) {
  return (
    <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 14 }} />
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
  colors: any;
}) {
  const dotColor = {
    green: colors.success,
    yellow: colors.warning,
    red: colors.danger,
  }[status];

  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: dotColor,
          marginRight: 10,
        }}
      />
      <Text
        style={{
          fontFamily: fonts.medium,
          fontSize: 13,
          color: colors.text,
          flex: 1,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: fonts.regular,
          fontSize: 12,
          color: colors.muted,
          maxWidth: 200,
        }}
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
  colors: any;
}) {
  return (
    <View style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
      <Text
        style={{
          fontFamily: fonts.medium,
          fontSize: 13,
          color: colors.text,
          marginBottom: 8,
        }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onSelect(opt.value)}
            activeOpacity={0.6}
            style={{
              flex: 1,
              paddingVertical: 6,
              alignItems: "center",
              borderWidth: 1,
              borderColor: selected === opt.value ? colors.accent : colors.border,
              backgroundColor: selected === opt.value ? colors.accentDim : "transparent",
            }}
          >
            <Text
              style={{
                fontFamily: fonts.medium,
                fontSize: 12,
                color: selected === opt.value ? colors.accent : colors.muted,
              }}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
