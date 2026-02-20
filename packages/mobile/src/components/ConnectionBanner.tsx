/**
 * ConnectionBanner — Shows connection status when degraded.
 * Appears at the top of screens when daemon or OpenCode is offline.
 */

import React from "react";
import { View, Text } from "react-native";
import { useConnectionStore } from "../stores/connection";

export default function ConnectionBanner() {
  const wsConnected = useConnectionStore((s) => s.wsConnected);
  const daemonConnected = useConnectionStore((s) => s.daemonConnected);
  const opencodeReady = useConnectionStore((s) => s.opencodeReady);

  // Everything is fine
  if (wsConnected && daemonConnected && opencodeReady) return null;

  let message = "";
  let bgColor = "";

  if (!wsConnected) {
    message = "Connecting to server...";
    bgColor = "bg-red-500 dark:bg-red-700";
  } else if (!daemonConnected) {
    message = "Daemon offline";
    bgColor = "bg-amber-500 dark:bg-amber-700";
  } else if (!opencodeReady) {
    message = "OpenCode not ready";
    bgColor = "bg-amber-500 dark:bg-amber-700";
  }

  return (
    <View className={`${bgColor} px-4 py-2`}>
      <Text className="text-white text-xs font-medium text-center">
        {message}
      </Text>
    </View>
  );
}
