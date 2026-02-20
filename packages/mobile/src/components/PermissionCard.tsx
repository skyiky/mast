/**
 * PermissionCard — Approve/deny permission requests from the agent.
 */

import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import type { PermissionRequest } from "../stores/sessions";

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
    <View className="mx-4 my-2 rounded-xl border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20 overflow-hidden">
      <View className="px-4 py-3">
        <View className="flex-row items-center mb-2">
          <Text className="text-amber-600 dark:text-amber-400 text-sm font-bold">
            Permission Required
          </Text>
        </View>
        <Text className="text-sm text-gray-800 dark:text-gray-200 leading-5">
          {permission.description}
        </Text>
      </View>

      {isPending && (
        <View className="flex-row border-t border-amber-200 dark:border-amber-800">
          <TouchableOpacity
            onPress={handleDeny}
            disabled={loading}
            className="flex-1 py-3 items-center border-r border-amber-200 dark:border-amber-800 active:bg-red-50 dark:active:bg-red-900/20"
          >
            <Text className="text-red-600 dark:text-red-400 font-semibold text-sm">
              Deny
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleApprove}
            disabled={loading}
            className="flex-1 py-3 items-center active:bg-green-50 dark:active:bg-green-900/20"
          >
            {loading ? (
              <ActivityIndicator size="small" color="#22c55e" />
            ) : (
              <Text className="text-green-600 dark:text-green-400 font-semibold text-sm">
                Approve
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {permission.status === "approved" && (
        <View className="px-4 py-2 bg-green-100 dark:bg-green-900/30">
          <Text className="text-green-700 dark:text-green-400 text-xs font-medium text-center">
            Approved
          </Text>
        </View>
      )}

      {permission.status === "denied" && (
        <View className="px-4 py-2 bg-red-100 dark:bg-red-900/30">
          <Text className="text-red-700 dark:text-red-400 text-xs font-medium text-center">
            Denied
          </Text>
        </View>
      )}
    </View>
  );
}
