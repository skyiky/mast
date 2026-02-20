/**
 * PermissionCard — Terminal-style permission approval.
 * Amber border, ⚠ prefix, monospace [deny]/[approve] buttons.
 */

import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import type { PermissionRequest } from "../stores/sessions";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";

interface PermissionCardProps {
  permission: PermissionRequest;
  onApprove: (permId: string) => void;
  onDeny: (permId: string) => void;
  loading?: boolean;
}

export default function PermissionCard({
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
      style={{
        marginHorizontal: 12,
        marginVertical: 6,
        borderWidth: 1,
        borderColor: colors.warning,
        backgroundColor: colors.warningDim,
        overflow: "hidden",
      }}
    >
      {/* Header + description */}
      <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
        <Text
          style={{
            fontFamily: fonts.semibold,
            fontSize: 12,
            color: colors.warning,
            marginBottom: 4,
          }}
        >
          ⚠ permission required
        </Text>
        <Text
          style={{
            fontFamily: fonts.regular,
            fontSize: 13,
            color: colors.text,
            lineHeight: 19,
          }}
        >
          {permission.description}
        </Text>
      </View>

      {/* Action buttons */}
      {isPending && (
        <View
          style={{
            flexDirection: "row",
            borderTopWidth: 1,
            borderTopColor: colors.warning,
          }}
        >
          <TouchableOpacity
            onPress={handleDeny}
            disabled={loading}
            style={{
              flex: 1,
              paddingVertical: 8,
              alignItems: "center",
              borderRightWidth: 1,
              borderRightColor: colors.warning,
            }}
            activeOpacity={0.6}
          >
            <Text
              style={{
                fontFamily: fonts.medium,
                fontSize: 12,
                color: colors.danger,
              }}
            >
              [deny]
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleApprove}
            disabled={loading}
            style={{
              flex: 1,
              paddingVertical: 8,
              alignItems: "center",
            }}
            activeOpacity={0.6}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.success} />
            ) : (
              <Text
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 12,
                  color: colors.success,
                }}
              >
                [approve]
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Status indicators */}
      {permission.status === "approved" && (
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            backgroundColor: colors.successDim,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.medium,
              fontSize: 11,
              color: colors.success,
              textAlign: "center",
            }}
          >
            ✓ approved
          </Text>
        </View>
      )}

      {permission.status === "denied" && (
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            backgroundColor: colors.dangerDim,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.medium,
              fontSize: 11,
              color: colors.danger,
              textAlign: "center",
            }}
          >
            ✗ denied
          </Text>
        </View>
      )}
    </View>
  );
}
