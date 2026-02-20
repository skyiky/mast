/**
 * Root layout — providers + stack navigator.
 * Dark-only terminal aesthetic. JetBrains Mono loaded here.
 */

import "../global.css";

import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "@expo-google-fonts/jetbrains-mono";
import {
  JetBrainsMono_300Light,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import { ActivityIndicator, View } from "react-native";
import { ThemeProvider, useTheme } from "../src/lib/ThemeContext";
import { usePushNotifications } from "../src/hooks/usePushNotifications";
import { useConnectionStore } from "../src/stores/connection";

function RootNavigator() {
  const { colors } = useTheme();

  // Register for push notifications + handle deep links from notification taps
  usePushNotifications();

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.surface,
          },
          headerTintColor: colors.bright,
          headerTitleStyle: { fontWeight: "700", fontFamily: "JetBrainsMono_700Bold" },
          contentStyle: {
            backgroundColor: colors.bg,
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: "mast" }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{ title: "session" }}
        />
        <Stack.Screen
          name="pair"
          options={{
            title: "pair",
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: "config" }}
        />
      </Stack>
      <StatusBar style="light" />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    JetBrainsMono_300Light,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
  });

  const tokenLoaded = useConnectionStore((s) => s.tokenLoaded);
  const loadToken = useConnectionStore((s) => s.loadToken);

  // Load API token from SecureStore on startup
  useEffect(() => {
    loadToken();
  }, []);

  if (!fontsLoaded || !tokenLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0A0A0A", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#22C55E" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RootNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
