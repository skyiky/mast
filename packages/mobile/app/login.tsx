/**
 * Login screen — GitHub OAuth via Supabase Auth.
 *
 * Flow:
 * 1. User taps "sign in with github"
 * 2. supabase.auth.signInWithOAuth() returns an auth URL (skipBrowserRedirect: true)
 * 3. WebBrowser.openAuthSessionAsync() opens the URL in an in-app browser
 * 4. GitHub redirects back to mast:// with access_token + refresh_token in the fragment
 * 5. We parse the tokens and call supabase.auth.setSession()
 * 6. On success, navigate to / (index redirect guards handle routing based on pairing state)
 */

import React, { useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { useRouter } from "expo-router";
import { supabase } from "../src/lib/supabase";
import { useTheme } from "../src/lib/ThemeContext";
import { fonts } from "../src/lib/themes";
import AnimatedPressable from "../src/components/AnimatedPressable";

// Ensure the auth session completes properly on Android
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGitHubLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const redirectTo = makeRedirectUri();

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });

      if (oauthError || !data.url) {
        setError(oauthError?.message ?? "failed to start oauth flow");
        setLoading(false);
        return;
      }

      // Open the auth URL in an in-app browser
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectTo,
      );

      if (result.type !== "success" || !result.url) {
        // User cancelled or browser dismissed
        setLoading(false);
        return;
      }

      // Parse tokens from the redirect URL fragment
      // Supabase puts them in the hash: mast://...#access_token=...&refresh_token=...
      const url = new URL(result.url);
      const params = new URLSearchParams(
        url.hash ? url.hash.substring(1) : url.search.substring(1),
      );

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (!accessToken || !refreshToken) {
        setError("auth callback missing tokens");
        setLoading(false);
        return;
      }

      // Set the session — this persists to AsyncStorage and triggers
      // onAuthStateChange listeners
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) {
        setError(sessionError.message);
      } else {
        // Auth succeeded — navigate to index; redirect guards route based on pairing state
        router.replace("/");
      }
    } catch (err) {
      setError("login failed — check your connection");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        {/* Logo / Title */}
        <Text style={[styles.title, { color: colors.bright }]}>mast</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          mobile-first async agent control
        </Text>

        {/* GitHub sign-in button */}
        <AnimatedPressable
          onPress={handleGitHubLogin}
          disabled={loading}
          style={[
            styles.loginBtn,
            { borderColor: colors.bright, backgroundColor: colors.surface },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.bright} />
          ) : (
            <Text style={[styles.loginBtnText, { color: colors.bright }]}>
              [sign in with github]
            </Text>
          )}
        </AnimatedPressable>

        {/* Error */}
        {error && (
          <View
            style={[
              styles.errorBox,
              { backgroundColor: colors.dangerDim, borderColor: colors.danger },
            ]}
          >
            <Text style={[styles.errorText, { color: colors.danger }]}>
              {error}
            </Text>
          </View>
        )}

        {/* Footer */}
        <Text style={[styles.footer, { color: colors.dim }]}>
          authenticates via supabase. your github identity is used to scope
          sessions and device keys.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 36,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    marginBottom: 48,
    textAlign: "center",
  },
  loginBtn: {
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingVertical: 14,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  loginBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  errorBox: {
    marginTop: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    width: "100%",
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    textAlign: "center",
  },
  footer: {
    fontFamily: fonts.regular,
    fontSize: 11,
    textAlign: "center",
    marginTop: 40,
    lineHeight: 16,
  },
});
