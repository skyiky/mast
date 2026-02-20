/**
 * Chat screen — terminal-style message view with prompt input.
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
import { useTheme } from "../../src/lib/ThemeContext";
import { fonts } from "../../src/lib/themes";
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
  const { colors } = useTheme();

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

  // Set header options — terminal style
  useEffect(() => {
    navigation.setOptions({
      title: session?.title || (id ? `${id.slice(0, 8)}` : "session"),
      headerRight: () => (
        <TouchableOpacity
          onPress={toggleVerbosity}
          style={{ marginRight: 8, height: 32, width: 48, alignItems: "center", justifyContent: "center" }}
        >
          <Text
            style={{
              fontFamily: fonts.medium,
              fontSize: 12,
              color: colors.accent,
            }}
          >
            {verbosity === "standard" ? "[full]" : "[std]"}
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, id, session?.title, verbosity, toggleVerbosity, colors]);

  // Track active session
  useEffect(() => {
    if (id) setActiveSessionId(id);
    return () => setActiveSessionId(null);
  }, [id, setActiveSessionId]);

  // Load messages from API on mount
  const initialLoadAborted = useRef(false);

  useEffect(() => {
    if (!id) return;
    initialLoadAborted.current = false;

    (async () => {
      try {
        const res = await api.messages(id);

        if (initialLoadAborted.current) return;

        if (res.status === 200 && Array.isArray(res.body)) {
          const mapped: ChatMessage[] = res.body.map((m: any) => {
            const info = m.info ?? m;
            return {
              id: info.id ?? m.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: info.role ?? m.role ?? "assistant",
              parts: (m.parts ?? [])
                .filter((p: any) => {
                  const kept = ["text", "tool-invocation", "tool-result", "reasoning", "file"];
                  return kept.includes(p.type);
                })
                .map((p: any) => ({
                  type: p.type as "text" | "tool-invocation" | "tool-result" | "reasoning" | "file",
                  content: p.text ?? p.content ?? "",
                  toolName: p.toolName ?? p.name,
                  toolArgs: p.toolArgs ?? (p.args ? JSON.stringify(p.args) : undefined),
                })),
              streaming: false,
              createdAt: info.time?.created
                ? new Date(info.time.created).toISOString()
                : m.createdAt ?? new Date().toISOString(),
            };
          });

          const currentMessages = useSessionStore.getState().messagesBySession[id];
          if (currentMessages?.some((m) => m.streaming)) return;

          setMessages(id, mapped);
        }
      } catch (err) {
        if (!initialLoadAborted.current) {
          console.error("[chat] Failed to load messages:", err);
        }
      }
    })();
  }, [id]);

  // Auto-scroll on new messages / streaming content
  const lastMsg = messages[messages.length - 1];
  const lastContentLen = lastMsg?.parts.reduce(
    (sum, p) => sum + (p.content?.length ?? 0),
    0,
  ) ?? 0;

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length, lastContentLen]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !id || sending) return;

    initialLoadAborted.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

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

  // Build render list
  const renderData: Array<
    | { type: "message"; item: ChatMessage }
    | { type: "permission"; item: (typeof permissions)[0] }
  > = [];

  messages.forEach((msg) => {
    renderData.push({ type: "message", item: msg });
  });

  permissions
    .filter((p) => p.status === "pending")
    .forEach((perm) => {
      renderData.push({ type: "permission", item: perm });
    });

  const hasInput = inputText.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 56 + insets.top : 0}
    >
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
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
              <View style={{ paddingHorizontal: 12 }}>
                <MessageBubble message={item.item} />
              </View>
            );
          }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
          style={{ flex: 1 }}
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 12, marginVertical: 2 }} />
          )}
        />

        {/* Terminal prompt input bar */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 8),
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          {/* > prompt character */}
          <Text
            style={{
              fontFamily: fonts.semibold,
              fontSize: 18,
              color: colors.accent,
              marginRight: 6,
              marginBottom: Platform.OS === "ios" ? 8 : 10,
            }}
          >
            {">"}
          </Text>
          <TextInput
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 100,
              fontFamily: fonts.regular,
              fontSize: 15,
              color: colors.bright,
              paddingVertical: 8,
              paddingHorizontal: 0,
            }}
            value={inputText}
            onChangeText={setInputText}
            placeholder="type a command..."
            placeholderTextColor={colors.dim}
            multiline
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit
          />
          {/* ↵ send button */}
          <TouchableOpacity
            onPress={handleSend}
            disabled={!hasInput || sending}
            style={{
              height: 36,
              width: 36,
              alignItems: "center",
              justifyContent: "center",
              marginLeft: 6,
              marginBottom: Platform.OS === "ios" ? 4 : 6,
              borderWidth: 1,
              borderColor: hasInput && !sending ? colors.success : colors.border,
            }}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.success} />
            ) : (
              <Text
                style={{
                  fontFamily: fonts.bold,
                  fontSize: 16,
                  color: hasInput ? colors.success : colors.dim,
                }}
              >
                ↵
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
