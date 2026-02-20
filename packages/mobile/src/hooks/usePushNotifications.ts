/**
 * usePushNotifications — Registers for Expo push notifications,
 * sends the token to the orchestrator, and handles deep linking
 * when a notification is tapped.
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useConnectionStore } from "../stores/connection";
import * as api from "../lib/api";

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Get the Expo push token for this device.
 * Returns null if not on a physical device or permissions denied.
 */
async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log("[push] Not a physical device, skipping push token registration");
    return null;
  }

  // Request permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("[push] Permission not granted");
    return null;
  }

  // Android notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("mast-default", {
      name: "Mast Notifications",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  // Get the token
  try {
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;
    if (!projectId) {
      console.warn("[push] No EAS projectId found, push notifications disabled");
      return null;
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log("[push] Token:", data);
    return data;
  } catch (err) {
    console.error("[push] Failed to get push token:", err);
    return null;
  }
}

/**
 * Hook to register for push notifications and handle notification taps.
 * Call this once in the root layout.
 */
export function usePushNotifications() {
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const apiToken = useConnectionStore((s) => s.apiToken);
  const paired = useConnectionStore((s) => s.paired);
  const registeredRef = useRef(false);

  // Register push token with orchestrator
  useEffect(() => {
    if (!paired || !serverUrl || registeredRef.current) return;

    (async () => {
      const token = await getExpoPushToken();
      if (!token) return;

      try {
        await api.registerPushToken({ serverUrl, apiToken }, token);
        registeredRef.current = true;
        console.log("[push] Token registered with orchestrator");
      } catch (err) {
        console.error("[push] Failed to register token:", err);
      }
    })();
  }, [paired, serverUrl, apiToken]);

  // Handle notification taps — deep link to the right session
  useEffect(() => {
    // Handle tap when app was killed (cold start)
    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) {
      handleNotificationResponse(lastResponse);
    }

    // Handle tap while app is running
    const subscription = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse,
    );

    return () => subscription.remove();
  }, []);
}

/**
 * Navigate to the relevant screen when a notification is tapped.
 */
function handleNotificationResponse(
  response: Notifications.NotificationResponse,
) {
  const data = response.notification.request.content.data;
  if (!data) return;

  // If the notification includes a URL, navigate directly
  if (typeof data.url === "string") {
    router.push(data.url);
    return;
  }

  // Otherwise, route based on notification type
  const sessionId = data.sessionId as string | undefined;
  if (sessionId) {
    router.push(`/chat/${sessionId}`);
  }
}
