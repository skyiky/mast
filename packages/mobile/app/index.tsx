/**
 * Session list — home screen. Terminal style.
 */

import React, { useEffect, useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter, useNavigation, Redirect } from "expo-router";
import { useConnectionStore } from "../src/stores/connection";
import { useSessionStore, type Session } from "../src/stores/sessions";
import { useWebSocket } from "../src/hooks/useWebSocket";
import { useApi } from "../src/hooks/useApi";
import { useTheme } from "../src/lib/ThemeContext";
import { fonts } from "../src/lib/themes";
import ConnectionBanner from "../src/components/ConnectionBanner";
import SessionRow from "../src/components/SessionRow";
import AnimatedPressable from "../src/components/AnimatedPressable";

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
        <Pressable
          onPress={() => router.push("/settings")}
          hitSlop={8}
          style={styles.configBtn}
        >
          <Text
            style={[styles.configText, { color: colors.accent }]}
          >
            [config]
          </Text>
        </Pressable>
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

  // Stable renderItem for FlashList
  const renderSession = useCallback(
    ({ item }: { item: Session }) => (
      <SessionRow
        session={item}
        onPress={() => handleOpenSession(item)}
      />
    ),
    [handleOpenSession],
  );

  const keyExtractor = useCallback((item: Session) => item.id, []);

  if (!paired || !serverUrl) return <Redirect href="/pair" />;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ConnectionBanner />

      {loadingSessions && sessions.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.success} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>
            loading sessions...
          </Text>
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.bright }]}>
            no sessions
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
            start a new session to begin working with your agent.
          </Text>
          <AnimatedPressable
            onPress={handleNewSession}
            disabled={creatingSession}
            style={[styles.newSessionBtn, { borderColor: colors.success }]}
          >
            {creatingSession ? (
              <ActivityIndicator color={colors.success} />
            ) : (
              <Text style={[styles.newSessionText, { color: colors.success }]}>
                [new session]
              </Text>
            )}
          </AnimatedPressable>
        </View>
      ) : (
        <FlashList
          data={sessions}
          keyExtractor={keyExtractor}
          renderItem={renderSession}
          estimatedItemSize={60}
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
        <AnimatedPressable
          onPress={handleNewSession}
          disabled={creatingSession}
          style={[
            styles.fab,
            {
              borderColor: colors.success,
              backgroundColor: colors.surface,
            },
          ]}
        >
          {creatingSession ? (
            <ActivityIndicator color={colors.success} />
          ) : (
            <Text style={[styles.fabIcon, { color: colors.success }]}>
              +
            </Text>
          )}
        </AnimatedPressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  configBtn: {
    marginRight: 8,
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  configText: {
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: 12,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: "center",
    marginBottom: 20,
  },
  newSessionBtn: {
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 10,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  newSessionText: {
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  fab: {
    position: "absolute",
    bottom: 32,
    right: 24,
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  fabIcon: {
    fontFamily: fonts.light,
    fontSize: 24,
  },
});
