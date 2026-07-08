/**
 * App shell. Wraps everything in AppProvider, then renders the active screen
 * + a bottom nav (Home / Chat / Agents / Settings / Profile) with the
 * modern icon-only layout.
 */
import React from 'react';
import {View, StatusBar} from 'react-native';
import {AppProvider, useApp} from './src/ui/AppContext';
import {palette} from './src/ui/theme';
import {BottomNav, Tab} from './src/ui/BottomNav';
import HomeScreen from './src/ui/HomeScreen';
import ChatScreen from './src/ui/ChatScreen';
import AgentsScreen from './src/ui/AgentsScreen';
import SettingsScreen from './src/ui/SettingsScreen';
import ProfileScreen from './src/ui/ProfileScreen';
import LoginScreen from './src/ui/LoginScreen';

function Shell() {
  const {screen, setScreen, currentSession} = useApp();

  if (screen === 'login') {
    return <LoginScreen />;
  }

  const tab = screen === 'profile' ? 'profile' : screen;

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <StatusBar barStyle="light-content" backgroundColor={palette.bg} />
      <View style={{flex: 1}}>
        {screen === 'home' && <HomeScreen />}
        {screen === 'chat' && <ChatScreen />}
        {screen === 'agents' && <AgentsScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'profile' && <ProfileScreen />}
      </View>
      <BottomNav
        active={tab as Tab}
        onChange={s => setScreen(s as any)}
        hasSession={!!currentSession}
      />
    </View>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
