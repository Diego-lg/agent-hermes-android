/**
 * App shell. Theme-aware. Wraps everything in ThemeController → AppProvider,
 * then renders the active screen + bottom nav.
 */
import React, {useEffect, useState} from 'react';
import {View, StatusBar} from 'react-native';
import {AppProvider, useApp} from './src/ui/AppContext';
import {ThemeController, useThemeController} from './src/ui/ThemeController';
import {BottomNav, Tab} from './src/ui/BottomNav';
import HomeScreen from './src/ui/HomeScreen';
import ChatScreen from './src/ui/ChatScreen';
import AgentsScreen from './src/ui/AgentsScreen';
import SettingsScreen from './src/ui/SettingsScreen';
import ProfileScreen from './src/ui/ProfileScreen';
import LoginScreen from './src/ui/LoginScreen';
import NotesScreen from './src/ui/NotesScreen';
import NoteEditorScreen from './src/ui/NoteEditorScreen';
import CronScreen from './src/ui/CronScreen';
import {notesStore} from './src/api/notesStore';

function Shell() {
  const {screen, setScreen, currentSession} = useApp();
  const {theme} = useThemeController();
  const [notesReady, setNotesReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await notesStore.loadConfig();
        const restored = await notesStore.restore();
        setNotesReady(notesStore.hasConfig() && restored);
      } catch { /* ignore */ }
    })();
  }, [screen]);

  if (screen === 'login') {
    return <LoginScreen />;
  }

  const tab: Tab = screen === 'profile' ? 'settings' : (screen as Tab);

  return (
    <View style={{flex: 1, backgroundColor: theme.palette.bg}}>
      <StatusBar
        barStyle={theme.palette.bg.startsWith('#0') || theme.palette.bg === '#000' ? 'light-content' : 'dark-content'}
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
      </View>
      <BottomNav
        active={tab}
        onChange={s => setScreen(s as any)}
        hasSession={!!currentSession}
        notesReady={notesReady}
      />
    </View>
  );
}

export default function App() {
  return (
    <ThemeController>
      <AppProvider>
        <Shell />
      </AppProvider>
    </ThemeController>
  );
}
