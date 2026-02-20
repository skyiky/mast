/**
 * Pairing screen — connect phone to daemon.
 * Supports QR code scanning and manual code entry.
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
import CodeInput from "../src/components/CodeInput";
import * as api from "../src/lib/api";

type Mode = "qr" | "manual";

export default function PairScreen() {
  const router = useRouter();
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
          setError("Invalid QR code format");
          setQrScanned(false);
        }
      } catch {
        setError("Invalid QR code");
        setQrScanned(false);
      }
    },
    [qrScanned, loading],
  );

  const handleManualCode = useCallback(
    async (code: string) => {
      const url = manualUrl.trim();
      if (!url) {
        setError("Enter server URL first");
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
      // Set the server URL first
      setServerUrl(url);

      const config = { serverUrl: url, apiToken };
      const res = await api.verifyPairingCode(config, code);

      if (res.status === 200 && res.body?.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPaired(true);
        router.replace("/");
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(res.body?.error ?? "Pairing failed");
        setCodeError(true);
        setQrScanned(false);
      }
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError("Connection failed. Check the server URL.");
      setCodeError(true);
      setQrScanned(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-gray-50 dark:bg-gray-950"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 px-6 pt-8 pb-6">
          {/* Title */}
          <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100 text-center mb-2">
            Pair Your Device
          </Text>
          <Text className="text-base text-gray-500 dark:text-gray-400 text-center mb-8">
            Scan the QR code shown in your daemon terminal, or enter the code manually.
          </Text>

          {/* Mode toggle */}
          <View className="flex-row mb-6 bg-gray-200 dark:bg-gray-800 rounded-xl p-1">
            <TouchableOpacity
              onPress={() => setMode("qr")}
              className={`flex-1 py-2.5 rounded-lg items-center ${
                mode === "qr" ? "bg-white dark:bg-gray-700" : ""
              }`}
            >
              <Text
                className={`font-medium text-sm ${
                  mode === "qr"
                    ? "text-gray-900 dark:text-gray-100"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                Scan QR
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode("manual")}
              className={`flex-1 py-2.5 rounded-lg items-center ${
                mode === "manual" ? "bg-white dark:bg-gray-700" : ""
              }`}
            >
              <Text
                className={`font-medium text-sm ${
                  mode === "manual"
                    ? "text-gray-900 dark:text-gray-100"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                Enter Code
              </Text>
            </TouchableOpacity>
          </View>

          {mode === "qr" ? (
            <View className="items-center">
              {!permission?.granted ? (
                <View className="items-center py-8">
                  <Text className="text-gray-600 dark:text-gray-400 mb-4 text-center">
                    Camera access is needed to scan the QR code.
                  </Text>
                  <TouchableOpacity
                    onPress={requestPermission}
                    className="bg-mast-600 px-6 py-3 rounded-xl"
                  >
                    <Text className="text-white font-semibold">
                      Grant Camera Access
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View className="w-full aspect-square rounded-2xl overflow-hidden bg-black mb-4">
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
              {/* Server URL input */}
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Server URL
              </Text>
              <TextInput
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-base text-gray-900 dark:text-gray-100 mb-6"
                value={manualUrl}
                onChangeText={setManualUrl}
                placeholder="https://your-server.azurecontainerapps.io"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              {/* Pairing code */}
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Pairing Code
              </Text>
              <CodeInput onComplete={handleManualCode} error={codeError} />
            </View>
          )}

          {/* Loading */}
          {loading && (
            <View className="items-center mt-6">
              <ActivityIndicator size="large" color="#5c7cfa" />
              <Text className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                Pairing...
              </Text>
            </View>
          )}

          {/* Error */}
          {error && (
            <View className="mt-4 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">
              <Text className="text-red-600 dark:text-red-400 text-sm text-center">
                {error}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
