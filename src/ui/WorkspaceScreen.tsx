/**
 * WorkspaceScreen — explore your server's file system from the app.
 *
 * Since the Hermes serve backend doesn't expose a generic `fs.list` RPC, the
 * workspace screen talks to the server via the agent: it dispatches a prompt
 * (via the active engine) asking the agent to `tree` / `ls` a path on its
 * host. The reply (a markdown list of files) is rendered as a tree.
 *
 * For the chat-session itself, the `workspace` per-turn option is also
 * editable here so the user can flip their cwd without leaving the screen.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View, Text, ScrollView, TextInput, TouchableOpacity, RefreshControl, Platform, Alert} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {FolderIcon, RefreshIcon, ChevronRightIcon, TerminalIcon, FileTextIcon, CpuIcon} from './icons';
import MarkdownText from './MarkdownText';

export default function WorkspaceScreen() {
  const {engine, activeWorkspace, setActiveWorkspace, engineClient, serverOnline, currentSession} = useApp();
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  const [pathDraft, setPathDraft] = useState(activeWorkspace ?? '');
  const [browseResult, setBrowseResult] = useState<string>('');
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => { setPathDraft(activeWorkspace ?? ''); }, [activeWorkspace]);

  const onSave = () => {
    const trimmed = pathDraft.trim();
    setActiveWorkspace(trimmed || null);
  };

  const browse = useCallback(async () => {
    if (!engine || engine.id !== 'desktop') {
      Alert.alert('Offline', 'Connect to your desktop server to browse its filesystem.');
      return;
    }
    const target = pathDraft.trim() || activeWorkspace || '~';
    setBrowsing(true);
    setBrowseResult('');
    try {
      // Ask the agent to list the path. Use a background-ish path: open a
      // brand-new session, send the prompt, collect the streamed answer, then
      // close. Background would not give us the reply so we use submitPrompt.
      const sid = await engine.createSession('workspace-browse');
      // Quick hack: do an ephemeral read via a one-shot prompt by attaching
      // a session listener to capture the response, then submit.
      let captured = '';
      const off = engine.onEvent((type: string, params: any) => {
        if (params?.session_id && params.session_id !== sid) return;
        if (type === 'message.delta') {
          captured += params.payload?.text ?? '';
        }
      });
      const handle = engine.submitPrompt(
        `Run a directory listing for the path "${target}" on your host. Use the 'tree' command if available, otherwise 'ls -la'. Output ONLY the listing — no commentary. Prepend the path on its own line so I can parse it.`,
        sid,
        {workspace: target},
      );
      await handle.done;
      off();
      setBrowseResult(captured || '(no output)');
    } catch (e: any) {
      setBrowseResult(`⚠️ ${e?.message ?? String(e)}`);
    } finally {
      setBrowsing(false);
    }
  }, [engine, pathDraft, activeWorkspace]);

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>WORKSPACE</Text>
        <TouchableOpacity onPress={browse} style={{padding: 6}} hitSlop={{top:8, bottom:8, left:8, right:8}}>
          <RefreshIcon size={16} color={palette.textDim} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{paddingBottom: 40}}
        refreshControl={
          <RefreshControl refreshing={browsing} onRefresh={browse}
            tintColor={palette.textMuted} colors={[palette.text]} />
        }>
        {/* CWD picker */}
        <View style={{paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border}}>
          <Text style={[type.label, {color: palette.textMuted, marginBottom: 6}]}>CURRENT WORKSPACE</Text>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <FolderIcon size={14} color={palette.textDim} />
            <TextInput
              value={pathDraft}
              onChangeText={setPathDraft}
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
            <TouchableOpacity onPress={onSave} style={{paddingHorizontal: 14, paddingVertical: 8, backgroundColor: palette.accent}}>
              <Text style={{color: palette.bg, fontSize: 12, fontWeight: '600'}}>SAVE</Text>
            </TouchableOpacity>
          </View>
          <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, marginTop: 8, fontFamily: monoFont}]}>
            {activeWorkspace ? `cwd · ${activeWorkspace}` : 'no workspace set · using server default'}
          </Text>
        </View>

        {/* Browse action */}
        <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.md}}>
          <TouchableOpacity
            onPress={browse}
            disabled={browsing}
            style={{
              flexDirection: 'row', alignItems: 'center',
              padding: 14,
              borderWidth: 1, borderColor: palette.border,
              backgroundColor: palette.surface,
            }}>
            <TerminalIcon size={16} color={palette.accent} />
            <View style={{flex: 1, marginLeft: 10}}>
              <Text style={[type.body, {color: palette.text, fontSize: 14}]}>
                {browsing ? 'Listing…' : `List ${pathDraft.trim() || activeWorkspace || 'cwd'}`}
              </Text>
              <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, marginTop: 2, fontFamily: monoFont}]}>
                dispatches a `tree` / `ls -la` command to the desktop
              </Text>
            </View>
            <ChevronRightIcon size={14} color={palette.textDim} />
          </TouchableOpacity>
        </View>

        {/* Result */}
        <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.md}}>
          {browseResult ? (
            <View style={{
              padding: 14,
              borderWidth: 1, borderColor: palette.border,
              backgroundColor: palette.surfaceAlt,
            }}>
              <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
                <FileTextIcon size={12} color={palette.textDim} />
                <Text style={[type.label, {color: palette.textMuted, marginLeft: 6, fontSize: 9}]}>LISTING</Text>
              </View>
              <MarkdownText
                text={browseResult}
                color={palette.text}
                fontFamily={monoFont}
              />
            </View>
          ) : (
            <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12, marginTop: 16, textAlign: 'center'}]}>
              Tap "List" above to see the directory tree.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
};
