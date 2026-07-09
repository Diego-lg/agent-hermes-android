/**
 * App shell. Theme-aware. Wraps everything in ThemeController → AppProvider,
 * then renders the active screen + bottom nav.
 */
import React, {useEffect, useState} from 'react';
import {View, StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppProvider, useApp} from './src/ui/AppContext';
import {ThemeController, useThemeController} from './src/ui/ThemeController';
import {BottomNav, Tab} from './src/ui/BottomNav';
import HomeScreen from './src/ui/HomeScreen';
import ChatScreen from './src/ui/ChatScreen';
import AgentsScreen from './src/ui/AgentsScreen';
import SettingsScreen from './src/ui/SettingsScreen';
import ProfileScreen from './src/ui/ProfileScreen';
import NotesScreen from './src/ui/NotesScreen';
import NoteEditorScreen from './src/ui/NoteEditorScreen';
import CronScreen from './src/ui/CronScreen';
import SessionsScreen from './src/ui/SessionsScreen';
import ModelsScreen from './src/ui/ModelsScreen';
import ProfilesScreen from './src/ui/ProfilesScreen';
import TasksScreen from './src/ui/TasksScreen';
import SkillsScreen from './src/ui/SkillsScreen';
import WorkspaceScreen from './src/ui/WorkspaceScreen';
import MemoryScreen from './src/ui/MemoryScreen';
import InsightsScreen from './src/ui/InsightsScreen';
import YoloScreen from './src/ui/YoloScreen';
import GroupChatScreen from './src/ui/GroupChatScreen';
import PersonalityLibraryScreen from './src/ui/PersonalityLibraryScreen';
import {notesStore} from './src/api/notesStore';

function Shell() {
  const {screen, setScreen, setCurrentSession, currentSession} = useApp();
  const {theme} = useThemeController();
  const [notesReady, setNotesReady] = useState(false);

  // Wire notification taps → in-app navigation. Backend posts a `reply-<sid>`
  // tag on the channel's "reply ready" notification; tapping it should put
  // the user in the chat for that session even if they're on Home.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {subscribeNotificationTaps} = await import('./src/api/notifications');
        if (cancelled) return;
        const off = subscribeNotificationTaps(p => {
          // Ensure the engine is loaded for the tapped session before
          // navigating so ChatScreen doesn't render an empty placeholder.
          if (p.sessionId) setCurrentSession(p.sessionId);
          if (p.screen) setScreen(p.screen as any);
        });
        return () => off();
      } catch { /* notif taps are optional */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await notesStore.loadConfig();
        const restored = await notesStore.restore();
        if (!cancelled) {
          const ready = notesStore.hasConfig() && restored;
          setNotesReady(ready);
          // Re-check whenever we come back from Settings where the user might
          // have just signed in to Drive.
          if (!ready) {
            setTimeout(async () => {
              try {
                await notesStore.loadConfig();
                const r2 = await notesStore.restore();
                if (!cancelled && notesStore.hasConfig() && r2) setNotesReady(true);
              } catch {}
            }, 1500);
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [screen]);

  const tab: Tab = screen as Tab;

  return (
    <View style={{flex: 1, backgroundColor: theme.palette.bg}}>
      <StatusBar
        barStyle={isDarkBg(theme.palette.bg) ? 'light-content' : 'dark-content'}
        backgroundColor={theme.palette.bg}
      />
      <View style={{flex: 1}}>
        {screen === 'home' && <HomeScreen />}
        {screen === 'chat' && <ChatScreen />}
        {screen === 'agents' && <AgentsScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'profile' && <ProfileScreen />}
        {screen === 'notes' && <NotesScreen />}
        {screen === 'noteEditor' && <NoteEditorScreen />}
        {screen === 'cron' && <CronScreen />}
        {screen === 'sessions' && <SessionsScreen />}
        {screen === 'models' && <ModelsScreen />}
        {screen === 'profiles' && <ProfilesScreen />}
        {screen === 'tasks' && <TasksScreen />}
        {screen === 'skills' && <SkillsScreen />}
        {screen === 'workspace' && <WorkspaceScreen />}
        {screen === 'memory' && <MemoryScreen />}
        {screen === 'insights' && <InsightsScreen />}
        {screen === 'groupChat' && <GroupChatScreen />}
        {screen === 'personalities' && <PersonalityLibraryScreen />}
        {screen === 'yolo' && <YoloScreen onClose={() => setScreen('settings')} />}
      </View>
      <BottomNav
        active={tab}
        onChange={s => setScreen(s as any)}
        hasSession={!!currentSession}
        notesReady={notesReady}
        hidden={screen === 'yolo'}
      />
    </View>
  );
}

/** Decide light vs dark status-bar text from the theme's hex/rgb bg color. */
function isDarkBg(bg: string): boolean {
  // Pull out r/g/b from #rgb, #rrggbb, or rgb(...) string.
  let m = bg.match(/^#([0-9a-f]{3})$/i);
  let r = 255, g = 255, b = 255;
  if (m) {
    r = parseInt(m[1][0] + m[1][0], 16);
    g = parseInt(m[1][1] + m[1][1], 16);
    b = parseInt(m[1][2] + m[1][2], 16);
  } else if ((m = bg.match(/^#([0-9a-f]{6})$/i))) {
    r = parseInt(m[1].slice(0, 2), 16);
    g = parseInt(m[1].slice(2, 4), 16);
    b = parseInt(m[1].slice(4, 6), 16);
  } else if ((m = bg.match(/rgba?\(([^)]+)\)/i))) {
    const parts = m[1].split(',').map(s => parseFloat(s.trim()));
    r = parts[0] || 0; g = parts[1] || 0; b = parts[2] || 0;
  }
  // Perceived brightness (Rec. 601).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.55;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeController>
        <AppProvider>
          <Shell />
        </AppProvider>
      </ThemeController>
    </SafeAreaProvider>
  );
}
