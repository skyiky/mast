/**
 * Settings screen — connection status, preferences, re-pair option.
 */

import React from "react";
import { View, Text, TouchableOpacity, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useConnectionStore } from "../src/stores/connection";
import { useSettingsStore, type Verbosity, type ColorScheme } from "../src/stores/settings";

export default function SettingsScreen() {
  const router = useRouter();

  // Connection state
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const wsConnected = useConnectionStore((s) => s.wsConnected);
  const daemonConnected = useConnectionStore((s) => s.daemonConnected);
  const opencodeReady = useConnectionStore((s) => s.opencodeReady);
  const reset = useConnectionStore((s) => s.reset);

  // Settings
  const verbosity = useSettingsStore((s) => s.verbosity);
  const colorScheme = useSettingsStore((s) => s.colorScheme);
  const setVerbosity = useSettingsStore((s) => s.setVerbosity);
  const setColorScheme = useSettingsStore((s) => s.setColorScheme);

  const handleRepair = () => {
    Alert.alert(
      "Re-pair Device",
      "This will disconnect and require you to pair again. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Re-pair",
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
    <ScrollView className="flex-1 bg-gray-50 dark:bg-gray-950">
      {/* Connection Status */}
      <SectionHeader title="Connection" />
      <View className="bg-white dark:bg-gray-900 mx-4 rounded-xl overflow-hidden mb-6">
        <StatusRow
          label="Server"
          value={serverUrl || "Not configured"}
          status={wsConnected ? "green" : "red"}
        />
        <Divider />
        <StatusRow
          label="Daemon"
          value={daemonConnected ? "Connected" : "Offline"}
          status={daemonConnected ? "green" : "red"}
        />
        <Divider />
        <StatusRow
          label="OpenCode"
          value={opencodeReady ? "Ready" : "Not ready"}
          status={opencodeReady ? "green" : daemonConnected ? "yellow" : "red"}
        />
      </View>

      {/* Verbosity */}
      <SectionHeader title="Display" />
      <View className="bg-white dark:bg-gray-900 mx-4 rounded-xl overflow-hidden mb-6">
        <OptionRow
          label="Verbosity"
          options={[
            { value: "standard" as Verbosity, label: "Standard" },
            { value: "full" as Verbosity, label: "Full" },
          ]}
          selected={verbosity}
          onSelect={(v) => setVerbosity(v as Verbosity)}
        />
        <Divider />
        <OptionRow
          label="Theme"
          options={[
            { value: "system" as ColorScheme, label: "System" },
            { value: "light" as ColorScheme, label: "Light" },
            { value: "dark" as ColorScheme, label: "Dark" },
          ]}
          selected={colorScheme}
          onSelect={(v) => setColorScheme(v as ColorScheme)}
        />
      </View>

      {/* Actions */}
      <SectionHeader title="Device" />
      <View className="bg-white dark:bg-gray-900 mx-4 rounded-xl overflow-hidden mb-6">
        <TouchableOpacity
          onPress={handleRepair}
          className="px-4 py-3.5 active:bg-gray-50 dark:active:bg-gray-800"
        >
          <Text className="text-red-600 dark:text-red-400 text-base">
            Re-pair Device
          </Text>
        </TouchableOpacity>
      </View>

      {/* About */}
      <SectionHeader title="About" />
      <View className="bg-white dark:bg-gray-900 mx-4 rounded-xl overflow-hidden mb-10">
        <View className="px-4 py-3.5">
          <Text className="text-gray-900 dark:text-gray-100 text-base">
            Mast
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            v0.0.1 — Phase 5 Dogfood
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-8 py-2 mt-2">
      {title}
    </Text>
  );
}

function Divider() {
  return (
    <View className="h-px bg-gray-100 dark:bg-gray-800 ml-4" />
  );
}

function StatusRow({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: "green" | "yellow" | "red";
}) {
  const dotColor = {
    green: "bg-green-500",
    yellow: "bg-amber-500",
    red: "bg-red-500",
  }[status];

  return (
    <View className="flex-row items-center px-4 py-3.5">
      <View className={`w-2.5 h-2.5 rounded-full ${dotColor} mr-3`} />
      <Text className="text-gray-900 dark:text-gray-100 text-base flex-1">
        {label}
      </Text>
      <Text
        className="text-gray-500 dark:text-gray-400 text-sm max-w-[200px]"
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
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View className="px-4 py-3">
      <Text className="text-gray-900 dark:text-gray-100 text-base mb-2">
        {label}
      </Text>
      <View className="flex-row bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
        {options.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onSelect(opt.value)}
            className={`flex-1 py-1.5 rounded-md items-center ${
              selected === opt.value
                ? "bg-white dark:bg-gray-700"
                : ""
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                selected === opt.value
                  ? "text-gray-900 dark:text-gray-100"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
