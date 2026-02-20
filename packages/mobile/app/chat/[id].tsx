/**
 * Chat screen — renders messages for a specific session.
 */

import React, { useEffect, useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSessionStore, type ChatMessage } from "../../src/stores/sessions";
import { useSettingsStore } from "../../src/stores/settings";
import { useApi } from "../../src/hooks/useApi";
import ConnectionBanner from "../../src/components/ConnectionBanner";
import MessageBubble from "../../src/components/MessageBubble";
import PermissionCard from "../../src/components/PermissionCard";

const EMPTY_MESSAGES: ChatMessage[] = [];

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const api = useApi();
  const flatListRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);

  const messages = useSessionStore(
    (s) => s.messagesBySession[id ?? ""] ?? EMPTY_MESSAGES,
  );
  const session = useSessionStore(
    (s) => s.sessions.find((sess) => sess.id === id),
  );
  const allPermissions = useSessionStore((s) => s.permissions);
  const permissions = useMemo(
    () => allPermissions.filter((p) => p.sessionId === id),
    [allPermissions, id],
  );
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const setMessages = useSessionStore((s) => s.setMessages);
  const addMessage = useSessionStore((s) => s.addMessage);

  const verbosity = useSettingsStore((s) => s.verbosity);
  const toggleVerbosity = useSettingsStore((s) => s.toggleVerbosity);

  // Set header options
  useEffect(() => {
    navigation.setOptions({
      title: session?.title || (id ? `${id.slice(0, 8)}...` : "Chat"),
      headerRight: () => (
        <TouchableOpacity
          onPress={toggleVerbosity}
          className="mr-2 h-8 w-12 items-center justify-center"
        >
          <Text className="text-mast-600 dark:text-mast-400 text-sm font-medium">
            {verbosity === "standard" ? "Full" : "Std"}
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, id, session?.title, verbosity, toggleVerbosity]);

  // Track active session
  useEffect(() => {
    if (id) setActiveSessionId(id);
    return () => setActiveSessionId(null);
  }, [id, setActiveSessionId]);

  // Load messages from API on mount
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await api.messages(id);
        if (res.status === 200 && Array.isArray(res.body)) {
          const mapped: ChatMessage[] = res.body.map((m: any) => {
            // OpenCode returns { info: { id, role, ... }, parts: [...] }
            const info = m.info ?? m;
            return {
              id: info.id ?? m.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: info.role ?? m.role ?? "assistant",
              parts: (m.parts ?? [])
                .filter((p: any) => p.type === "text")
                .map((p: any) => ({
                  type: "text" as const,
                  // OpenCode text parts use "text" field, not "content"
                  content: p.text ?? p.content ?? "",
                })),
              streaming: m.streaming ?? !info.time?.completed,
              createdAt: info.time?.created
                ? new Date(info.time.created).toISOString()
                : m.createdAt ?? new Date().toISOString(),
            };
          });
          setMessages(id, mapped);
        }
      } catch (err) {
        console.error("[chat] Failed to load messages:", err);
      }
    })();
  }, [id]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length, messages[messages.length - 1]?.parts.length]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !id || sending) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Add user message locally
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", content: text }],
      streaming: false,
      createdAt: new Date().toISOString(),
    };
    addMessage(id, userMessage);
    setInputText("");
    setSending(true);

    try {
      await api.prompt(id, text);
    } catch (err) {
      console.error("[chat] Failed to send:", err);
    } finally {
      setSending(false);
    }
  }, [inputText, id, sending, api, addMessage]);

  const handleApprove = useCallback(
    async (permId: string) => {
      if (!id) return;
      try {
        await api.approve(id, permId);
      } catch (err) {
        console.error("[chat] Failed to approve:", err);
      }
    },
    [id, api],
  );

  const handleDeny = useCallback(
    async (permId: string) => {
      if (!id) return;
      try {
        await api.deny(id, permId);
      } catch (err) {
        console.error("[chat] Failed to deny:", err);
      }
    },
    [id, api],
  );

  // Build render list: interleave messages and permission cards
  const renderData: Array<
    | { type: "message"; item: ChatMessage }
    | { type: "permission"; item: (typeof permissions)[0] }
  > = [];

  messages.forEach((msg) => {
    renderData.push({ type: "message", item: msg });
  });

  // Add pending permissions at the end
  permissions
    .filter((p) => p.status === "pending")
    .forEach((perm) => {
      renderData.push({ type: "permission", item: perm });
    });

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <ConnectionBanner />

      <FlatList
        ref={flatListRef}
        data={renderData}
        keyExtractor={(item, idx) =>
          item.type === "message"
            ? item.item.id
            : `perm-${item.item.id}`
        }
        renderItem={({ item }) => {
          if (item.type === "permission") {
            return (
              <PermissionCard
                permission={item.item}
                onApprove={handleApprove}
                onDeny={handleDeny}
              />
            );
          }
          return (
            <View className="px-4">
              <MessageBubble message={item.item} />
            </View>
          );
        }}
        contentContainerStyle={{ paddingVertical: 8, paddingBottom: 8 }}
        className="flex-1"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 56 + insets.top : 0}
      >
        <View
          className="flex-row items-end px-3 py-2 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <TextInput
            className="flex-1 min-h-[40px] max-h-[100px] bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-2.5 mr-2 text-base text-gray-900 dark:text-gray-100"
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor="#9ca3af"
            multiline
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
            className={`h-10 w-10 rounded-full items-center justify-center ${
              inputText.trim() && !sending
                ? "bg-mast-600 dark:bg-mast-700"
                : "bg-gray-300 dark:bg-gray-700"
            }`}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text className="text-white font-bold text-lg">^</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
