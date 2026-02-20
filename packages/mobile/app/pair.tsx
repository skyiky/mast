/**
 * Pairing screen — terminal style.
 * QR code scanning and manual code entry.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useConnectionStore } from "../src/stores/connection";
import { useTheme } from "../src/lib/ThemeContext";
import { fonts } from "../src/lib/themes";
import CodeInput from "../src/components/CodeInput";
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
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}>
          {/* Title */}
          <Text
            style={{
              fontFamily: fonts.bold,
              fontSize: 22,
              color: colors.bright,
              textAlign: "center",
              marginBottom: 6,
            }}
          >
            pair device
          </Text>
          <Text
            style={{
              fontFamily: fonts.regular,
              fontSize: 13,
              color: colors.muted,
              textAlign: "center",
              marginBottom: 28,
            }}
          >
            scan the qr code from your daemon, or enter the code manually.
          </Text>

          {/* Mode toggle */}
          <View
            style={{
              flexDirection: "row",
              marginBottom: 20,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <TouchableOpacity
              onPress={() => setMode("qr")}
              activeOpacity={0.6}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: "center",
                backgroundColor: mode === "qr" ? colors.surface : "transparent",
                borderRightWidth: 1,
                borderRightColor: colors.border,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 12,
                  color: mode === "qr" ? colors.accent : colors.muted,
                }}
              >
                [scan qr]
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode("manual")}
              activeOpacity={0.6}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: "center",
                backgroundColor: mode === "manual" ? colors.surface : "transparent",
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 12,
                  color: mode === "manual" ? colors.accent : colors.muted,
                }}
              >
                [enter code]
              </Text>
            </TouchableOpacity>
          </View>

          {mode === "qr" ? (
            <View style={{ alignItems: "center" }}>
              {!permission?.granted ? (
                <View style={{ alignItems: "center", paddingVertical: 32 }}>
                  <Text
                    style={{
                      fontFamily: fonts.regular,
                      fontSize: 13,
                      color: colors.muted,
                      marginBottom: 16,
                      textAlign: "center",
                    }}
                  >
                    camera access needed to scan qr code.
                  </Text>
                  <TouchableOpacity
                    onPress={requestPermission}
                    activeOpacity={0.6}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.success,
                      paddingHorizontal: 20,
                      paddingVertical: 10,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: fonts.medium,
                        fontSize: 13,
                        color: colors.success,
                      }}
                    >
                      [grant access]
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View
                  style={{
                    width: "100%",
                    aspectRatio: 1,
                    overflow: "hidden",
                    backgroundColor: "#000",
                    marginBottom: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <CameraView
                    style={{ flex: 1 }}
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
              <Text
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 11,
                  color: colors.muted,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 6,
                }}
              >
                server url
              </Text>
              <TextInput
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontFamily: fonts.regular,
                  fontSize: 14,
                  color: colors.bright,
                  marginBottom: 20,
                }}
                value={manualUrl}
                onChangeText={setManualUrl}
                placeholder="https://your-server.azurecontainerapps.io"
                placeholderTextColor={colors.dim}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              {/* Pairing code */}
              <Text
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 11,
                  color: colors.muted,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 10,
                }}
              >
                pairing code
              </Text>
              <CodeInput onComplete={handleManualCode} error={codeError} />
            </View>
          )}

          {/* Loading */}
          {loading && (
            <View style={{ alignItems: "center", marginTop: 24 }}>
              <ActivityIndicator size="large" color={colors.success} />
              <Text
                style={{
                  fontFamily: fonts.regular,
                  fontSize: 12,
                  color: colors.muted,
                  marginTop: 8,
                }}
              >
                pairing...
              </Text>
            </View>
          )}

          {/* Error */}
          {error && (
            <View
              style={{
                marginTop: 16,
                backgroundColor: colors.dangerDim,
                borderWidth: 1,
                borderColor: colors.danger,
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.regular,
                  fontSize: 12,
                  color: colors.danger,
                  textAlign: "center",
                }}
              >
                {error}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
