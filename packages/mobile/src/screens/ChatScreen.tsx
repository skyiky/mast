/**
 * ChatScreen — Phase 2 basic chat interface.
 *
 * Single screen with:
 * - Scrollable message list
 * - Text input + send button
 * - WebSocket connection for streaming events
 * - HTTP requests for sending messages
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import type { ChatMessage, ServerConfig } from "../types";
import { useWebSocket } from "../hooks/useWebSocket";
import { useApi } from "../hooks/useApi";

interface ChatScreenProps {
  config: ServerConfig;
}

export default function ChatScreen({ config }: ChatScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const api = useApi(config);

  const { connected } = useWebSocket({
    config,
    onMessage: setMessages,
  });

  // Create a session on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await api.createSession();
        if (res.status === 200 && res.body) {
          const session = res.body as { id: string };
          setSessionId(session.id);
          console.log("[chat] session created:", session.id);
        }
      } catch (err) {
        console.error("[chat] failed to create session:", err);
      }
    })();
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !sessionId || sending) return;

    // Add user message locally
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", content: text }],
      streaming: false,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setSending(true);

    try {
      await api.sendPrompt(sessionId, text);
    } catch (err) {
      console.error("[chat] failed to send:", err);
    } finally {
      setSending(false);
    }
  }, [inputText, sessionId, sending, api]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isUser = item.role === "user";
    const textContent = item.parts
      .filter((p) => p.type === "text")
      .map((p) => p.content)
      .join("\n");

    return (
      <View
        style={[
          styles.messageBubble,
          isUser ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        <Text style={[styles.messageText, isUser && styles.userText]}>
          {textContent || (item.streaming ? "..." : "(empty)")}
        </Text>
        {item.streaming && (
          <ActivityIndicator
            size="small"
            color="#666"
            style={styles.streamingIndicator}
          />
        )}
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mast</Text>
        <View
          style={[
            styles.statusDot,
            connected ? styles.statusConnected : styles.statusDisconnected,
          ]}
        />
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        style={styles.messageListContainer}
      />

      {/* Input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={
              sessionId ? "Type a message..." : "Creating session..."
            }
            editable={!!sessionId && !sending}
            multiline
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!inputText.trim() || !sessionId || sending) &&
                styles.sendButtonDisabled,
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || !sessionId || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.sendButtonText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  statusConnected: {
    backgroundColor: "#34c759",
  },
  statusDisconnected: {
    backgroundColor: "#ff3b30",
  },
  messageListContainer: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  messageBubble: {
    maxWidth: "80%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    marginVertical: 4,
  },
  userBubble: {
    backgroundColor: "#007aff",
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: "#e9e9eb",
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
    color: "#1a1a1a",
  },
  userText: {
    color: "#fff",
  },
  streamingIndicator: {
    marginTop: 4,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ddd",
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: "#f0f0f0",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    marginRight: 8,
  },
  sendButton: {
    backgroundColor: "#007aff",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#b0b0b0",
  },
  sendButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
