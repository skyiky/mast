/**
 * Session list — home screen. Terminal style.
 */

import React, { useEffect, useCallback, useState, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Alert,
  SectionList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useNavigation, Redirect, useFocusEffect } from "expo-router";
import { useShallow } from "zustand/react/shallow";
import { useConnectionStore } from "../src/stores/connection";
import { useSessionStore, type Session } from "../src/stores/sessions";
import { useApi } from "../src/hooks/useApi";
import { useTheme } from "../src/lib/ThemeContext";
import { fonts } from "../src/lib/themes";
import ConnectionBanner from "../src/components/ConnectionBanner";
import SessionRow from "../src/components/SessionRow";
import ProjectFilterBar from "../src/components/ProjectFilterBar";
import AnimatedPressable from "../src/components/AnimatedPressable";

export default function SessionListScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const apiToken = useConnectionStore((s) => s.apiToken);
  const paired = useConnectionStore((s) => s.paired);
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const sessions = useSessionStore(useShallow((s) => s.sessions));
  const setSessions = useSessionStore((s) => s.setSessions);
  const setSessionPreview = useSessionStore((s) => s.setSessionPreview);
  const removeSession = useSessionStore((s) => s.removeSession);
  const loadingSessions = useSessionStore((s) => s.loadingSessions);
  const setLoadingSessions = useSessionStore((s) => s.setLoadingSessions);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const api = useApi();

  // Settings header button — gear icon
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => router.push("/settings")}
          hitSlop={8}
          style={styles.configBtn}
        >
          <Ionicons name="settings-outline" size={20} color={colors.muted} />
        </Pressable>
      ),
    });
  }, [navigation, router, colors]);

  // Reload sessions whenever this screen gains focus (e.g., navigating back
  // from chat). The previous useEffect([paired, serverUrl]) only ran on mount
  // which missed updates when the Stack navigator kept this screen mounted.
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      // Fetch sessions and projects in parallel
      const [sessionsRes, projectsRes] = await Promise.all([
        api.sessions(),
        api.projects(),
      ]);

      // Update project names for filter bar
      if (projectsRes.status === 200 && Array.isArray(projectsRes.body)) {
        const names = (projectsRes.body as Array<{ name: string }>).map((p) => p.name);
        setProjectNames(names);
      }

      if (sessionsRes.status === 200 && Array.isArray(sessionsRes.body)) {
        // Read the store AFTER the await so we capture any hasActivity
        // flags set by WSS events during the network request.
        const storeState = useSessionStore.getState();
        const existing = new Map(
          storeState.sessions.map((s) => [s.id, s]),
        );
        const deleted = new Set(storeState.deletedSessionIds);

        const mapped: Session[] = sessionsRes.body
          .filter((s: any) => !deleted.has(s.id))
          .map((s: any) => {
          const prev = existing.get(s.id);
          return {
            id: s.id,
            title: s.slug ?? s.title ?? undefined,
            directory: s.directory ?? prev?.directory,
            project: s.project ?? prev?.project,
            createdAt: s.time?.created
              ? new Date(s.time.created).toISOString()
              : s.createdAt ?? new Date().toISOString(),
            updatedAt: s.time?.updated
              ? new Date(s.time.updated).toISOString()
              : s.updatedAt ?? s.createdAt ?? new Date().toISOString(),
            hasActivity: prev?.hasActivity,
            lastMessagePreview: prev?.lastMessagePreview,
          };
        });
        setSessions(mapped);

        // Backfill previews for sessions that don't have one yet.
        // Fire in parallel, don't block the UI — previews will pop in.
        const needPreview = mapped.filter((s) => !s.lastMessagePreview);
        if (needPreview.length > 0) {
          Promise.all(
            needPreview.map(async (s) => {
              try {
                const res = await api.messages(s.id);
                if (res.status >= 200 && res.status < 300 && Array.isArray(res.body)) {
                  // Find the last user message (OpenCode shape: role is at info.role)
                  for (let i = res.body.length - 1; i >= 0; i--) {
                    const m = res.body[i] as any;
                    const role = m.info?.role ?? m.role;
                    if (role === "user") {
                      const textPart = m.parts?.find(
                        (p: any) => p.type === "text",
                      );
                      const text = textPart?.text ?? textPart?.content;
                      if (text) setSessionPreview(s.id, text);
                      break;
                    }
                  }
                }
              } catch {
                // Non-critical — preview just won't show
              }
            }),
          );
        }
      }
    } catch (err) {
      console.error("[sessions] Failed to load:", err);
    } finally {
      setLoadingSessions(false);
    }
  }, [api, setSessions, setSessionPreview, setLoadingSessions]);

  useFocusEffect(
    useCallback(() => {
      if (paired && serverUrl) {
        loadSessions();
      }
    }, [paired, serverUrl, loadSessions]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  }, [loadSessions]);

  const handleNewSession = useCallback(async () => {
    setCreatingSession(true);
    try {
      const res = await api.newSession(selectedProject ?? undefined);
      if (res.status === 200 && res.body) {
        const session = res.body as { id: string };
        router.push(`/chat/${session.id}`);
      } else if (res.status >= 400) {
        const msg = (res.body as any)?.error ?? "Failed to create session";
        Alert.alert("Error", msg);
      }
    } catch (err) {
      console.error("[sessions] Failed to create:", err);
    } finally {
      setCreatingSession(false);
    }
  }, [api, router, selectedProject]);

  const handleOpenSession = useCallback(
    (session: Session) => {
      router.push(`/chat/${session.id}`);
    },
    [router],
  );

  const handleDeleteSession = useCallback(
    (session: Session) => {
      Alert.alert(
        "Delete Session",
        `Remove "${session.title || session.id.slice(0, 8)}" from this list?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => removeSession(session.id),
          },
        ],
      );
    },
    [removeSession],
  );

  // Filter sessions by selected project, then group by day
  const filteredSessions = useMemo(() => {
    if (selectedProject === null) return sessions;
    return sessions.filter((s) => s.project === selectedProject);
  }, [sessions, selectedProject]);

  // Group sessions by day for section headers
  const sections = useMemo(() => {
    if (filteredSessions.length === 0) return [];

    const groups = new Map<string, Session[]>();
    const now = new Date();
    const today = toDateKey(now);
    const yesterday = toDateKey(new Date(now.getTime() - 86400000));

    for (const session of filteredSessions) {
      const key = toDateKey(new Date(session.updatedAt || session.createdAt));
      let label: string;
      if (key === today) label = "Today";
      else if (key === yesterday) label = "Yesterday";
      else label = key;

      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(session);
    }

    return Array.from(groups.entries()).map(([title, data]) => ({
      title,
      data,
    }));
  }, [filteredSessions]);

  // Stable renderItem for SectionList
  const renderSession = useCallback(
    ({ item }: { item: Session }) => (
      <SessionRow
        session={item}
        onPress={() => handleOpenSession(item)}
        onLongPress={() => handleDeleteSession(item)}
      />
    ),
    [handleOpenSession, handleDeleteSession],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <View style={[styles.sectionHeader, { backgroundColor: colors.bg }]}>
        <Text style={[styles.sectionTitle, { color: colors.dim }]}>
          {section.title}
        </Text>
      </View>
    ),
    [colors],
  );

  const keyExtractor = useCallback((item: Session) => item.id, []);

  if (!apiToken) return <Redirect href="/login" />;
  if (!paired || !serverUrl) return <Redirect href="/pair" />;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ConnectionBanner />
      <ProjectFilterBar
        projects={projectNames}
        selected={selectedProject}
        onSelect={setSelectedProject}
      />

      {loadingSessions && sessions.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.success} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>
            loading sessions...
          </Text>
        </View>
      ) : filteredSessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.bright }]}>
            no sessions
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
            {selectedProject
              ? `no sessions in ${selectedProject}. start one below.`
              : "start a new session to begin working with your agent."}
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
        <SectionList
          sections={sections}
          keyExtractor={keyExtractor}
          renderItem={renderSession}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
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
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeader: {
    paddingHorizontal: 14,
    paddingTop: 20,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontFamily: fonts.medium,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
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

/** Format a date as a human-readable day label (e.g., "Feb 21, 2026"). */
function toDateKey(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
