/**
 * ConnectionBanner — Terminal-style status bar when degraded.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useConnectionStore } from "../stores/connection";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";

function ConnectionBanner() {
  const { colors } = useTheme();
  const wsConnected = useConnectionStore((s) => s.wsConnected);
  const daemonConnected = useConnectionStore((s) => s.daemonConnected);
  const opencodeReady = useConnectionStore((s) => s.opencodeReady);

  if (wsConnected && daemonConnected && opencodeReady) return null;

  let message = "";
  let bgColor = colors.dangerDim;
  let fgColor = colors.danger;

  if (!wsConnected) {
    message = "// connecting to server...";
    bgColor = colors.dangerDim;
    fgColor = colors.danger;
  } else if (!daemonConnected) {
    message = "// daemon offline";
    bgColor = colors.warningDim;
    fgColor = colors.warning;
  } else if (!opencodeReady) {
    message = "// opencode not ready";
    bgColor = colors.warningDim;
    fgColor = colors.warning;
  }

  return (
    <View style={[styles.banner, { backgroundColor: bgColor }]}>
      <Text style={[styles.bannerText, { color: fgColor }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  bannerText: {
    fontFamily: fonts.regular,
    fontSize: 11,
    textAlign: "center",
  },
});

export default React.memo(ConnectionBanner);
