/**
 * Session list — home screen. Terminal style.
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
import { useTheme } from "../src/lib/ThemeContext";
import { fonts } from "../src/lib/themes";
import ConnectionBanner from "../src/components/ConnectionBanner";
import SessionRow from "../src/components/SessionRow";

export default function SessionListScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const paired = useConnectionStore((s) => s.paired);
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const loadingSessions = useSessionStore((s) => s.loadingSessions);
  const setLoadingSessions = useSessionStore((s) => s.setLoadingSessions);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);

  const api = useApi();

  useWebSocket();

  // Settings header button — terminal style
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => router.push("/settings")}
          style={{ marginRight: 8 }}
        >
          <Text
            style={{
              fontFamily: fonts.medium,
              fontSize: 13,
              color: colors.accent,
            }}
          >
            [config]
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, router, colors]);

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
          title: s.slug ?? s.title ?? undefined,
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

  if (!paired || !serverUrl) return <Redirect href="/pair" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ConnectionBanner />

      {loadingSessions && sessions.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.success} />
          <Text
            style={{
              fontFamily: fonts.regular,
              fontSize: 13,
              color: colors.muted,
              marginTop: 12,
            }}
          >
            loading sessions...
          </Text>
        </View>
      ) : sessions.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <Text
            style={{
              fontFamily: fonts.bold,
              fontSize: 18,
              color: colors.bright,
              marginBottom: 8,
            }}
          >
            no sessions
          </Text>
          <Text
            style={{
              fontFamily: fonts.regular,
              fontSize: 13,
              color: colors.muted,
              textAlign: "center",
              marginBottom: 20,
            }}
          >
            start a new session to begin working with your agent.
          </Text>
          <TouchableOpacity
            onPress={handleNewSession}
            disabled={creatingSession}
            activeOpacity={0.6}
            style={{
              borderWidth: 1,
              borderColor: colors.success,
              paddingHorizontal: 24,
              paddingVertical: 10,
            }}
          >
            {creatingSession ? (
              <ActivityIndicator color={colors.success} />
            ) : (
              <Text
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 14,
                  color: colors.success,
                }}
              >
                [new session]
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
              tintColor={colors.success}
            />
          }
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}

      {/* FAB for new session — green bordered, not filled */}
      {sessions.length > 0 && (
        <TouchableOpacity
          onPress={handleNewSession}
          disabled={creatingSession}
          activeOpacity={0.6}
          style={{
            position: "absolute",
            bottom: 32,
            right: 24,
            width: 52,
            height: 52,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: colors.success,
            backgroundColor: colors.surface,
          }}
        >
          {creatingSession ? (
            <ActivityIndicator color={colors.success} />
          ) : (
            <Text
              style={{
                fontFamily: fonts.light,
                fontSize: 24,
                color: colors.success,
              }}
            >
              +
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}
