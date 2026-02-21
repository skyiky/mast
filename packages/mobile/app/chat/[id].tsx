/**
 * Chat screen — terminal-style message view with prompt input.
 */

import React, { useEffect, useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useLocalSearchParams, useNavigation } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore, type ChatMessage } from "../../src/stores/sessions";
import { useSettingsStore } from "../../src/stores/settings";
import { useApi } from "../../src/hooks/useApi";
import { useTheme } from "../../src/lib/ThemeContext";
import { fonts } from "../../src/lib/themes";
import ConnectionBanner from "../../src/components/ConnectionBanner";
import MessageBubble from "../../src/components/MessageBubble";
import PermissionCard from "../../src/components/PermissionCard";
import AnimatedPressable from "../../src/components/AnimatedPressable";
import SessionConfigSheet from "../../src/components/SessionConfigSheet";

type RenderItem =
  | { type: "message"; item: ChatMessage }
  | { type: "permission"; item: ReturnType<typeof useSessionStore.getState>["permissions"][0] };

// Stable separator component — extracted to avoid re-creating on every render
const ItemSeparator = React.memo(function ItemSeparator({ borderColor }: { borderColor: string }) {
  return <View style={[separatorStyles.line, { backgroundColor: borderColor }]} />;
});

const separatorStyles = StyleSheet.create({
  line: {
    height: 1,
    marginHorizontal: 12,
    marginVertical: 2,
  },
});

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const api = useApi();
  const flashListRef = useRef<FlashList<RenderItem>>(null);
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [configVisible, setConfigVisible] = useState(false);
  const { colors } = useTheme();

  const messages = useSessionStore(
    useShallow((s) => s.messagesBySession[id ?? ""] ?? []),
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
  const sessionMode = useSettingsStore((s) => s.sessionMode);

  // Set header options — terminal style with config sheet trigger
  useEffect(() => {
    navigation.setOptions({
      title: session?.title || (id ? `${id.slice(0, 8)}` : "session"),
      headerRight: () => (
        <Pressable
          onPress={() => setConfigVisible(true)}
          hitSlop={8}
          style={styles.configBtn}
        >
          <Text style={[styles.configIcon, { color: colors.accent }]}>
            {"\u22EE"}
          </Text>
        </Pressable>
      ),
    });
  }, [navigation, id, session?.title, colors]);

  // Track active session
  useEffect(() => {
    if (id) setActiveSessionId(id);
    return () => setActiveSessionId(null);
  }, [id, setActiveSessionId]);

  // Track keyboard visibility to avoid double-padding with safe area insets
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

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

  // Auto-scroll on new messages / streaming content via onContentSizeChange
  const handleContentSizeChange = useCallback(() => {
    if (messages.length > 0) {
      flashListRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

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

    // Prepend "PLAN MODE:" when in plan mode
    const promptText = sessionMode === "plan" ? `PLAN MODE: ${text}` : text;

    try {
      await api.prompt(id, promptText);
    } catch (err) {
      console.error("[chat] Failed to send:", err);
    } finally {
      setSending(false);
    }
  }, [inputText, id, sending, api, addMessage, sessionMode]);

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
  const renderData = useMemo<RenderItem[]>(() => {
    const data: RenderItem[] = [];
    messages.forEach((msg) => {
      data.push({ type: "message", item: msg });
    });
    permissions
      .filter((p) => p.status === "pending")
      .forEach((perm) => {
        data.push({ type: "permission", item: perm });
      });
    return data;
  }, [messages, permissions]);

  // Stable renderItem callback
  const renderItem = useCallback(
    ({ item }: { item: RenderItem }) => {
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
        <View style={styles.messageWrapper}>
          <MessageBubble message={item.item} />
        </View>
      );
    },
    [handleApprove, handleDeny],
  );

  const keyExtractor = useCallback(
    (item: RenderItem) =>
      item.type === "message" ? item.item.id : `perm-${item.item.id}`,
    [],
  );

  // Stable separator using theme border color
  const renderSeparator = useCallback(
    () => <ItemSeparator borderColor={colors.border} />,
    [colors.border],
  );

  const hasInput = inputText.trim().length > 0;

  const chatContent = (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 56 + insets.top : 0}
    >
      <View style={[styles.flex, { backgroundColor: colors.bg }]}>
        <ConnectionBanner />

        <FlashList
          ref={flashListRef}
          data={renderData}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={80}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
          ItemSeparatorComponent={renderSeparator}
          onContentSizeChange={handleContentSizeChange}
        />

        {/* Terminal prompt input bar */}
        <View
          style={[
            styles.inputBar,
            {
              paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 8),
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
            },
          ]}
        >
          {/* > prompt character (cyan for build, yellow for plan) */}
          <Text
            style={[
              styles.promptChar,
              {
                color: sessionMode === "plan" ? colors.warning : colors.accent,
                marginBottom: Platform.OS === "ios" ? 8 : 10,
              },
            ]}
          >
            {sessionMode === "plan" ? "?" : ">"}
          </Text>
          <TextInput
            style={[styles.textInput, { color: colors.bright }]}
            value={inputText}
            onChangeText={setInputText}
            placeholder={sessionMode === "plan" ? "plan a task..." : "type a command..."}
            placeholderTextColor={colors.dim}
            multiline
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          {/* ↵ send button */}
          <AnimatedPressable
            onPress={handleSend}
            disabled={!hasInput || sending}
            style={[
              styles.sendBtn,
              {
                marginBottom: Platform.OS === "ios" ? 4 : 6,
                borderColor: hasInput && !sending ? colors.success : colors.border,
              },
            ]}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.success} />
            ) : (
              <Text
                style={[
                  styles.sendIcon,
                  { color: hasInput ? colors.success : colors.dim },
                ]}
              >
                ↵
              </Text>
            )}
          </AnimatedPressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );

  return (
    <>
      {chatContent}
      {id && (
        <SessionConfigSheet
          visible={configVisible}
          onClose={() => setConfigVisible(false)}
          sessionId={id}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  configBtn: {
    marginRight: 8,
    height: 44,
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  configIcon: {
    fontFamily: fonts.bold,
    fontSize: 22,
    textAlign: "center",
  },
  messageWrapper: {
    paddingHorizontal: 12,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  promptChar: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    marginRight: 6,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  sendBtn: {
    height: 44,
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
    borderWidth: 1,
  },
  sendIcon: {
    fontFamily: fonts.bold,
    fontSize: 16,
  },
});
