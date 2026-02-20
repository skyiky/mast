/**
 * Session list — home screen.
 * Redirects to pair screen if not configured.
 * Lists sessions with pull-to-refresh and new session button.
 */

import React, { useEffect, useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useRouter, useNavigation, Redirect } from "expo-router";
import { useConnectionStore } from "../src/stores/connection";
import { useSessionStore, type Session } from "../src/stores/sessions";
import { useWebSocket } from "../src/hooks/useWebSocket";
import { useApi } from "../src/hooks/useApi";
import ConnectionBanner from "../src/components/ConnectionBanner";
import SessionRow from "../src/components/SessionRow";

export default function SessionListScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const paired = useConnectionStore((s) => s.paired);
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const loadingSessions = useSessionStore((s) => s.loadingSessions);
  const setLoadingSessions = useSessionStore((s) => s.setLoadingSessions);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);

  const api = useApi();

  // Connect WebSocket (global — stays connected across screens)
  useWebSocket();

  // Settings header button
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => router.push("/settings")} className="mr-2">
          <Text className="text-mast-600 dark:text-mast-400 text-base">Settings</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, router]);

  // Load sessions on mount
  useEffect(() => {
    if (paired && serverUrl) {
      loadSessions();
    }
  }, [paired, serverUrl]);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await api.sessions();
      if (res.status === 200 && Array.isArray(res.body)) {
        const mapped: Session[] = res.body.map((s: any) => ({
          id: s.id,
          createdAt: s.createdAt ?? new Date().toISOString(),
          updatedAt: s.updatedAt ?? s.createdAt ?? new Date().toISOString(),
        }));
        setSessions(mapped);
      }
    } catch (err) {
      console.error("[sessions] Failed to load:", err);
    } finally {
      setLoadingSessions(false);
    }
  }, [api, setSessions, setLoadingSessions]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  }, [loadSessions]);

  const handleNewSession = useCallback(async () => {
    setCreatingSession(true);
    try {
      const res = await api.newSession();
      if (res.status === 200 && res.body) {
        const session = res.body as { id: string };
        router.push(`/chat/${session.id}`);
      }
    } catch (err) {
      console.error("[sessions] Failed to create:", err);
    } finally {
      setCreatingSession(false);
    }
  }, [api, router]);

  const handleOpenSession = useCallback(
    (session: Session) => {
      router.push(`/chat/${session.id}`);
    },
    [router],
  );

  // Redirect to pairing if not configured
  if (!paired || !serverUrl) return <Redirect href="/pair" />;

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <ConnectionBanner />

      {loadingSessions && sessions.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#5c7cfa" />
          <Text className="text-gray-500 dark:text-gray-400 mt-3 text-sm">
            Loading sessions...
          </Text>
        </View>
      ) : sessions.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            No sessions yet
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center text-base mb-6">
            Start a new session to begin working with your AI agent.
          </Text>
          <TouchableOpacity
            onPress={handleNewSession}
            disabled={creatingSession}
            className="bg-mast-600 dark:bg-mast-700 px-8 py-3 rounded-xl active:bg-mast-700"
          >
            {creatingSession ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="text-white font-semibold text-base">
                New Session
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SessionRow
              session={item}
              onPress={() => handleOpenSession(item)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#5c7cfa"
            />
          }
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}

      {/* FAB for new session */}
      {sessions.length > 0 && (
        <TouchableOpacity
          onPress={handleNewSession}
          disabled={creatingSession}
          className="absolute bottom-8 right-6 w-14 h-14 rounded-full bg-mast-600 dark:bg-mast-700 items-center justify-center shadow-lg active:bg-mast-700"
        >
          {creatingSession ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-white text-2xl font-light">+</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}
