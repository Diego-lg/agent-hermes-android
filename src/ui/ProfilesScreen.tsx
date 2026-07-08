/**
 * ProfilesScreen — switch agent profiles and organize sessions into projects.
 *
 * "Profiles" maps to two server-side concepts:
 *   1. Hermes agent profiles — pre-baked sub-agent prompts (PC Controller,
 *      Coder, Researcher, …). Tapping one sets it as the active profile and
 *      the next chat will open with that system prompt.
 *   2. The Hermes server-side "profile" field (server.harness profile) —
 *      surfaced via the activeProfile state in AppContext.
 *
 * "Projects" maps to `projects.list` on the server. Tapping a project sets it
 * as the active project for upcoming turns.
 *
 * "Workspace" is a server-side cwd override (per-turn `workspace` param). The
 * user types a path; the next prompt.submit sends it through.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, TextInput, RefreshControl, Platform, Alert} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {LayersIcon, UserIcon, FolderIcon, RefreshIcon, CheckIcon, PlusIcon, ServerIcon, ChevronRightIcon} from './icons';
import {AGENT_CATALOG} from '../agents/catalog';

export default function ProfilesScreen() {
  const {
    engine, engineClient, serverOnline,
    activeProfile, setActiveProfile,
    activeProjectId, projects, refreshProjects, setActiveProject,
    activeWorkspace, setActiveWorkspace,
  } = useApp();
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  const [refreshing, setRefreshing] = useState(false);
  const [workspaceDraft, setWorkspaceDraft] = useState(activeWorkspace ?? '');

  const load = useCallback(async () => {
    setRefreshing(true);
    try { await refreshProjects(); } finally { setRefreshing(false); }
  }, [refreshProjects]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setWorkspaceDraft(activeWorkspace ?? ''); }, [activeWorkspace]);

  const onSaveWorkspace = () => {
    const trimmed = workspaceDraft.trim();
    if (!trimmed) {
      setActiveWorkspace(null);
    } else {
      setActiveWorkspace(trimmed);
    }
  };

  const onSetActiveProfile = useCallback((id: string | null) => {
    setActiveProfile(id);
    Alert.alert('Profile', id ? `Active profile set to "${id}".` : 'Active profile cleared.');
  }, [setActiveProfile]);

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>PROFILES &amp; PROJECTS</Text>
        <TouchableOpacity onPress={load} style={{padding: 6}} hitSlop={{top:8, bottom:8, left:8, right:8}}>
          <RefreshIcon size={16} color={palette.textDim} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{paddingBottom: 40}}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load}
            tintColor={palette.textMuted} colors={[palette.text]} />
        }>

        {/* Agent profiles (catalog) */}
        <SectionHeader title="AGENT PROFILE" subtitle="Pre-baked system prompts. Sets the next chat's starting context." />
        <View style={{paddingHorizontal: spacing.lg, paddingBottom: spacing.md}}>
          <TouchableOpacity
            onPress={() => onSetActiveProfile(null)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row', alignItems: 'center',
              paddingVertical: 10,
              borderBottomWidth: 1, borderBottomColor: palette.border,
            }}>
            <View style={{
              width: 28, height: 28, borderRadius: 14,
              borderWidth: 1,
              borderColor: !activeProfile ? palette.accent : palette.border,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <UserIcon size={14} color={!activeProfile ? palette.accent : palette.textDim} />
            </View>
            <Text style={[type.body, {color: !activeProfile ? palette.accent : palette.text, fontSize: 13, marginLeft: 10, flex: 1}]}>
              Default (no profile)
            </Text>
            {!activeProfile ? <CheckIcon size={14} color={palette.accent} /> : <ChevronRightIcon size={12} color={palette.textDim} />}
          </TouchableOpacity>
          {AGENT_CATALOG.map(a => {
            const isActive = activeProfile === a.id;
            const Icon = a.icon;
            return (
              <TouchableOpacity
                key={a.id}
                onPress={() => onSetActiveProfile(a.id)}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: 10,
                  borderBottomWidth: 1, borderBottomColor: palette.border,
                }}>
                <View style={{
                  width: 28, height: 28,
                  borderWidth: 1, borderColor: isActive ? a.color : palette.border,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={14} color={isActive ? a.color : palette.textDim} />
                </View>
                <View style={{flex: 1, marginLeft: 10}}>
                  <Text style={[type.body, {color: isActive ? a.color : palette.text, fontSize: 13}]}>
                    {a.name}
                  </Text>
                  <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, marginTop: 2, fontFamily: monoFont}]} numberOfLines={1}>
                    {a.description}
                  </Text>
                </View>
                {isActive ? <CheckIcon size={14} color={a.color} /> : <ChevronRightIcon size={12} color={palette.textDim} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Server-side projects */}
        <SectionHeader title="PROJECTS" subtitle="Server-side grouping via projects.list. Active project id is sent on each turn." />
        <View style={{paddingHorizontal: spacing.lg, paddingBottom: spacing.md}}>
          {!serverOnline ? (
            <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12}]}>
              Server offline · project list unavailable.
            </Text>
          ) : projects.length === 0 ? (
            <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12}]}>
              No projects on the server. Create one on the desktop.
            </Text>
          ) : (
            <>
              <ProjectRow
                id={null}
                name="No project"
                isActive={!activeProjectId}
                onPress={() => void setActiveProject(null)}
                monoFont={monoFont}
              />
              {projects.map((p: any) => (
                <ProjectRow
                  key={p.id ?? p.name}
                  id={p.id ?? p.name}
                  name={p.name ?? p.title ?? p.id ?? '(unnamed)'}
                  sub={p.description ?? p.path}
                  isActive={activeProjectId === (p.id ?? p.name)}
                  onPress={() => void setActiveProject(p.id ?? p.name)}
                  monoFont={monoFont}
                />
              ))}
            </>
          )}
        </View>

        {/* Workspace cwd */}
        <SectionHeader title="WORKSPACE" subtitle="Server-side cwd override. Empty = use server default." />
        <View style={{paddingHorizontal: spacing.lg, paddingBottom: spacing.md}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <FolderIcon size={14} color={palette.textDim} />
            <TextInput
              value={workspaceDraft}
              onChangeText={setWorkspaceDraft}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="C:\Users\diego\Desktop\proyectos"
              placeholderTextColor={palette.textGhost}
              style={{
                flex: 1, color: palette.text, fontSize: 13,
                fontFamily: monoFont,
                paddingHorizontal: 10, paddingVertical: 8,
                backgroundColor: palette.surfaceAlt,
                borderWidth: 1, borderColor: palette.border,
              }}
            />
            <TouchableOpacity
              onPress={onSaveWorkspace}
              style={{
                paddingHorizontal: 14, paddingVertical: 8,
                backgroundColor: palette.accent,
              }}>
              <Text style={{color: palette.bg, fontSize: 12, fontWeight: '600'}}>SAVE</Text>
            </TouchableOpacity>
          </View>
          {activeWorkspace ? (
            <Text style={[type.monoMuted, {color: palette.success, fontSize: 10, marginTop: 8, fontFamily: monoFont}]}>
              active · {activeWorkspace}
            </Text>
          ) : (
            <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, marginTop: 8, fontFamily: monoFont}]}>
              no workspace set · using server default cwd
            </Text>
          )}
        </View>

        {/* Server-side Hermes profile (the harness profile key) */}
        <SectionHeader title="HARNESS PROFILE" subtitle="Server-side config profile (model defaults, MCP servers, etc)." />
        <View style={{paddingHorizontal: spacing.lg, paddingBottom: spacing.lg}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <ServerIcon size={14} color={palette.textDim} />
            <Text style={[type.body, {color: palette.text, fontSize: 13, flex: 1, fontFamily: monoFont}]}>
              {activeProfile ?? '(default)'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const SectionHeader: React.FC<{title: string; subtitle?: string}> = ({title, subtitle}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 4}}>
      <Text style={[type.label, {color: palette.textMuted}]}>{title}</Text>
      {subtitle ? (
        <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11, marginTop: 2}]}>{subtitle}</Text>
      ) : null}
    </View>
  );
};

const ProjectRow: React.FC<{
  id: string | null;
  name: string;
  sub?: string;
  isActive: boolean;
  onPress: () => void;
  monoFont?: any;
}> = ({name, sub, isActive, onPress, monoFont}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
      <LayersIcon size={14} color={isActive ? palette.accent : palette.textDim} />
      <View style={{flex: 1, marginLeft: 10}}>
        <Text style={[type.body, {color: isActive ? palette.accent : palette.text, fontSize: 13}]}>
          {name}
        </Text>
        {sub ? (
          <Text style={[type.mono, {color: palette.textDim, fontSize: 10, marginTop: 2, fontFamily: monoFont}]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {isActive ? <CheckIcon size={14} color={palette.accent} /> : <ChevronRightIcon size={12} color={palette.textDim} />}
    </TouchableOpacity>
  );
};
