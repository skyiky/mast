/**
 * Pairing screen — terminal style.
 * QR code scanning and manual code entry.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useConnectionStore } from "../src/stores/connection";
import { useTheme } from "../src/lib/ThemeContext";
import { fonts } from "../src/lib/themes";
import CodeInput from "../src/components/CodeInput";
import AnimatedPressable from "../src/components/AnimatedPressable";
import * as api from "../src/lib/api";

type Mode = "qr" | "manual";

export default function PairScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const setServerUrl = useConnectionStore((s) => s.setServerUrl);
  const setPaired = useConnectionStore((s) => s.setPaired);
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const apiToken = useConnectionStore((s) => s.apiToken);

  const [mode, setMode] = useState<Mode>("qr");
  const [manualUrl, setManualUrl] = useState(serverUrl || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState(false);
  const [qrScanned, setQrScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const handleQrScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (qrScanned || loading) return;
      setQrScanned(true);

      try {
        const parsed = JSON.parse(data);
        if (parsed.url && parsed.code) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await doPairing(parsed.url, parsed.code);
        } else {
          setError("invalid qr format");
          setQrScanned(false);
        }
      } catch {
        setError("invalid qr code");
        setQrScanned(false);
      }
    },
    [qrScanned, loading],
  );

  const handleManualCode = useCallback(
    async (code: string) => {
      const url = manualUrl.trim();
      if (!url) {
        setError("enter server url first");
        return;
      }
      await doPairing(url, code);
    },
    [manualUrl],
  );

  const doPairing = async (url: string, code: string) => {
    setLoading(true);
    setError(null);
    setCodeError(false);

    try {
      setServerUrl(url);

      const config = { serverUrl: url, apiToken };
      const res = await api.verifyPairingCode(config, code);

      if (res.status === 200 && res.body?.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPaired(true);
        router.replace("/");
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(res.body?.error ?? "pairing failed");
        setCodeError(true);
        setQrScanned(false);
      }
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError("connection failed — check server url");
      setCodeError(true);
      setQrScanned(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.flex, { backgroundColor: colors.bg }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.body}>
          {/* Title */}
          <Text style={[styles.title, { color: colors.bright }]}>
            pair device
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            scan the qr code from your daemon, or enter the code manually.
          </Text>

          {/* Mode toggle */}
          <View style={[styles.modeToggle, { borderColor: colors.border }]}>
            <AnimatedPressable
              onPress={() => setMode("qr")}
              pressScale={0.95}
              style={[
                styles.modeBtn,
                {
                  backgroundColor: mode === "qr" ? colors.surface : "transparent",
                  borderRightWidth: 1,
                  borderRightColor: colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.modeText,
                  { color: mode === "qr" ? colors.accent : colors.muted },
                ]}
              >
                [scan qr]
              </Text>
            </AnimatedPressable>
            <AnimatedPressable
              onPress={() => setMode("manual")}
              pressScale={0.95}
              style={[
                styles.modeBtn,
                {
                  backgroundColor: mode === "manual" ? colors.surface : "transparent",
                },
              ]}
            >
              <Text
                style={[
                  styles.modeText,
                  { color: mode === "manual" ? colors.accent : colors.muted },
                ]}
              >
                [enter code]
              </Text>
            </AnimatedPressable>
          </View>

          {mode === "qr" ? (
            <View style={styles.centered}>
              {!permission?.granted ? (
                <View style={styles.cameraPrompt}>
                  <Text style={[styles.cameraPromptText, { color: colors.muted }]}>
                    camera access needed to scan qr code.
                  </Text>
                  <AnimatedPressable
                    onPress={requestPermission}
                    style={[styles.grantBtn, { borderColor: colors.success }]}
                  >
                    <Text style={[styles.grantBtnText, { color: colors.success }]}>
                      [grant access]
                    </Text>
                  </AnimatedPressable>
                </View>
              ) : (
                <View style={[styles.cameraContainer, { borderColor: colors.border, backgroundColor: colors.bg }]}>
                  <CameraView
                    style={styles.flex}
                    barcodeScannerSettings={{
                      barcodeTypes: ["qr"],
                    }}
                    onBarcodeScanned={qrScanned ? undefined : handleQrScanned}
                  />
                </View>
              )}
            </View>
          ) : (
            <View>
              {/* Server URL */}
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                server url
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.bright,
                  },
                ]}
                value={manualUrl}
                onChangeText={setManualUrl}
                placeholder="https://your-server.azurecontainerapps.io"
                placeholderTextColor={colors.dim}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              {/* Pairing code */}
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                pairing code
              </Text>
              <CodeInput onComplete={handleManualCode} error={codeError} />
            </View>
          )}

          {/* Loading */}
          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.success} />
              <Text style={[styles.loadingText, { color: colors.muted }]}>
                pairing...
              </Text>
            </View>
          )}

          {/* Error */}
          {error && (
            <View
              style={[
                styles.errorBox,
                {
                  backgroundColor: colors.dangerDim,
                  borderColor: colors.danger,
                },
              ]}
            >
              <Text style={[styles.errorText, { color: colors.danger }]}>
                {error}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 22,
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: "center",
    marginBottom: 28,
  },
  modeToggle: {
    flexDirection: "row",
    marginBottom: 20,
    borderWidth: 1,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  modeText: {
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  centered: {
    alignItems: "center",
  },
  cameraPrompt: {
    alignItems: "center",
    paddingVertical: 32,
  },
  cameraPromptText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    marginBottom: 16,
    textAlign: "center",
  },
  grantBtn: {
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  grantBtnText: {
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  cameraContainer: {
    width: "100%",
    aspectRatio: 1,
    overflow: "hidden",
    backgroundColor: undefined,
    marginBottom: 16,
    borderWidth: 1,
  },
  fieldLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 14,
    marginBottom: 20,
  },
  loadingContainer: {
    alignItems: "center",
    marginTop: 24,
  },
  loadingText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    marginTop: 8,
  },
  errorBox: {
    marginTop: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    textAlign: "center",
  },
});
