/**
 * PermissionCard — Terminal-style permission approval.
 * Amber border, ⚠ prefix, monospace [deny]/[approve] buttons.
 */

import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import type { PermissionRequest } from "../stores/sessions";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";
import AnimatedPressable from "./AnimatedPressable";

interface PermissionCardProps {
  permission: PermissionRequest;
  onApprove: (permId: string) => void;
  onDeny: (permId: string) => void;
  loading?: boolean;
}

function PermissionCard({
  permission,
  onApprove,
  onDeny,
  loading = false,
}: PermissionCardProps) {
  const { colors } = useTheme();
  const isPending = permission.status === "pending";

  const handleApprove = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onApprove(permission.id);
  };

  const handleDeny = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onDeny(permission.id);
  };

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: colors.warning,
          backgroundColor: colors.warningDim,
        },
      ]}
    >
      {/* Header + description */}
      <View style={styles.body}>
        <Text style={[styles.header, { color: colors.warning }]}>
          ⚠ permission required
        </Text>
        <Text style={[styles.description, { color: colors.text }]}>
          {permission.description}
        </Text>
      </View>

      {/* Action buttons */}
      {isPending && (
        <View style={[styles.actions, { borderTopColor: colors.warning }]}>
          <AnimatedPressable
            onPress={handleDeny}
            disabled={loading}
            style={[
              styles.actionBtn,
              {
                borderRightWidth: 1,
                borderRightColor: colors.warning,
              },
            ]}
          >
            <Text style={[styles.actionText, { color: colors.danger }]}>
              [deny]
            </Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={handleApprove}
            disabled={loading}
            style={styles.actionBtn}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.success} />
            ) : (
              <Text style={[styles.actionText, { color: colors.success }]}>
                [approve]
              </Text>
            )}
          </AnimatedPressable>
        </View>
      )}

      {/* Status indicators */}
      {permission.status === "approved" && (
        <View style={[styles.statusBar, { backgroundColor: colors.successDim }]}>
          <Text style={[styles.statusText, { color: colors.success }]}>
            ✓ approved
          </Text>
        </View>
      )}

      {permission.status === "denied" && (
        <View style={[styles.statusBar, { backgroundColor: colors.dangerDim }]}>
          <Text style={[styles.statusText, { color: colors.danger }]}>
            ✗ denied
          </Text>
        </View>
      )}
    </View>
  );
}

export default React.memo(PermissionCard);

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    borderWidth: 1,
    overflow: "hidden",
  },
  body: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  header: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    marginBottom: 4,
  },
  description: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  actions: {
    flexDirection: "row",
    borderTopWidth: 1,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  actionText: {
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  statusBar: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    textAlign: "center",
  },
});
