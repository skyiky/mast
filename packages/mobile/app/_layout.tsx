/**
 * Root layout — providers + stack navigator.
 */

import "../global.css";

import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  useColorScheme as useNativeWindColorScheme,
  colorScheme as nwColorScheme,
} from "nativewind";
import { useSettingsStore } from "../src/stores/settings";
import { usePushNotifications } from "../src/hooks/usePushNotifications";

export default function RootLayout() {
  const { colorScheme } = useNativeWindColorScheme();
  const settingsScheme = useSettingsStore((s) => s.colorScheme);

  // Sync our settings store's color scheme preference with NativeWind
  useEffect(() => {
    if (settingsScheme === "system") {
      nwColorScheme.set("system");
    } else {
      nwColorScheme.set(settingsScheme);
    }
  }, [settingsScheme]);

  const isDark = colorScheme === "dark";

  // Register for push notifications + handle deep links from notification taps
  usePushNotifications();

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: isDark ? "#111827" : "#ffffff",
          },
          headerTintColor: isDark ? "#f3f4f6" : "#111827",
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: {
            backgroundColor: isDark ? "#030712" : "#f9fafb",
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: "Mast" }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{ title: "Chat" }}
        />
        <Stack.Screen
          name="pair"
          options={{
            title: "Pair Device",
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: "Settings" }}
        />
      </Stack>
      <StatusBar style={isDark ? "light" : "dark"} />
    </SafeAreaProvider>
  );
}
