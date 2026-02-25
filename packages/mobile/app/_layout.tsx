/**
 * Root layout — providers, auth gate, stack navigator.
 * Dark-only terminal aesthetic. JetBrains Mono loaded here.
 *
 * Auth flow:
 * 1. Check Supabase session (persisted in AsyncStorage by Supabase SDK)
 * 2. Push access_token into connection store's apiToken field
 * 3. No session → login screen; session + not paired → pair screen; paired → home
 * 4. onAuthStateChange keeps apiToken in sync across sign-in, sign-out, token refresh
 */

import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
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
import { useWebSocket } from "../src/hooks/useWebSocket";
import { useConnectionStore } from "../src/stores/connection";
import { supabase, setupAuthRefreshListener } from "../src/lib/supabase";

function RootNavigator() {
  const { colors } = useTheme();

  // Register for push notifications + handle deep links from notification taps
  usePushNotifications();

  // WebSocket lives here (root navigator) so it persists across all screen
  // navigation. Previously in index.tsx, which caused the connection to tear
  // down when navigating to chat and stale connection state on return.
  useWebSocket();

  return (
    <>
      <Stack
        screenOptions={{
          animation: "fade",
          animationDuration: 200,
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
          options={{
            title: "mast",
            headerRightContainerStyle: { paddingRight: 8, justifyContent: "center" },
          }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{
            title: "session",
            headerRightContainerStyle: { paddingRight: 8, justifyContent: "center" },
          }}
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
        <Stack.Screen
          name="login"
          options={{
            title: "sign in",
            headerShown: false,
          }}
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

  const authReady = useConnectionStore((s) => s.authReady);

  // Set up Supabase auth listener — bridges auth state into connection store
  useEffect(() => {
    const { setApiToken, setAuthReady } = useConnectionStore.getState();

    // 1. Check for existing session (persisted by Supabase SDK)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        setApiToken(session.access_token);
      }
      setAuthReady(true);
    });

    // 2. Listen for auth state changes (sign-in, sign-out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const { setApiToken: setToken } = useConnectionStore.getState();
        if (session?.access_token) {
          setToken(session.access_token);
        } else {
          setToken("");
        }
      },
    );

    // 3. Start AppState-aware auto-refresh
    const cleanupRefresh = setupAuthRefreshListener();

    return () => {
      subscription.unsubscribe();
      cleanupRefresh();
    };
  }, []);

  if (!fontsLoaded || !authReady) {
    // Hardcoded colors: ThemeProvider not mounted yet. Must match themes.ts bg/success.
    return (
      <View style={{ flex: 1, backgroundColor: "#0A0A0A", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#22C55E" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <RootNavigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
