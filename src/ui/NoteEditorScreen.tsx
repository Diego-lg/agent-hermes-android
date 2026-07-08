/**
 * Note editor — full-screen markdown editor. Theme-aware.
 */
import React, {useEffect, useRef, useState} from 'react';
import {View, ScrollView, TextInput, TouchableOpacity, Text, ActivityIndicator, KeyboardAvoidingView, Platform} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {ChevronLeftIcon, RefreshIcon, BotIcon, InfoIcon} from './icons';
import {notesStore, NoteContent} from '../api/notesStore';

export default function NoteEditorScreen() {
  const {setScreen, engineClient, engine, serverOnline, engineLabel, switchEngine, currentNoteId} = useApp();
  const {palette, spacing, type} = useTheme();
  const [note, setNote] = useState<NoteContent | null>(null);
  const [draft, setDraft] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('Summarize this note in 3 bullet points');
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiWorking, setAiWorking] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});

  useEffect(() => {
    (async () => {
      try {
        if (!notesStore.isAuthorized()) { setScreen('settings'); return; }
        if (currentNoteId) {
          try {
            const n = await notesStore.read(currentNoteId);
            setNote(n); setName(n.name); setDraft(n.content);
            return;
          } catch {
            // note id no longer valid — fall through to fresh note
          }
        }
        const n = await notesStore.write('Untitled', '# Untitled\n\n');
        setNote(n); setName(n.name); setDraft(n.content);
      } catch (e) { console.warn('editor init', e); }
    })();
  }, [setScreen, currentNoteId]);

  useEffect(() => {
    if (!note) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void save(); }, 1200);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, name]);

  const save = async () => {
    if (!note || saving) return;
    setSaving(true);
    try {
      const updated = await notesStore.write(name || 'Untitled', draft, note.id);
      setNote(updated);
      setLastSaved(Date.now());
    } catch (e) { console.warn('save failed', e); }
    finally { setSaving(false); }
  };

  const onAiAssist = async () => {
    if (!engine || !draft.trim()) return;
    setAiWorking(true);
    setAiResult(null);
    try {
      const composed = `You are an AI assistant helping the user work with a personal note. Here is the note's content:\n\n---\n${draft}\n---\n\nUser request: ${aiPrompt}\n\nRespond in plain text, no preamble. Be concise and direct.`;
      // The desktop engine needs a session id (creates one each call); the
      // minimax engine creates one too. createSession() returns the id we
      // pass to submitPrompt for both.
      const sid = await engine.createSession('Note Assistant');
      let result = '';
      const off = engine.onEvent((type: string, params: any) => {
        if (params?.session_id && params.session_id !== sid) return;
        if (type === 'message.delta') {
          result += params.payload?.text ?? '';
          setAiResult(result);
        }
      });
      const handle = engine.submitPrompt(composed, sid);
      const final = await handle.done;
      off();
      setAiResult(final.text);
      // Close just the session on Hermes; on mobile there's no server-side
      // session to close.
      if (engineClient) {
        try {
          await engineClient.closeSession(sid);
        } catch {
          /* ignore */
        }
      }
    } catch (e: any) {
      setAiResult(`Error: ${e?.message ?? String(e)}`);
    } finally { setAiWorking(false); }
  };

  return (
    <KeyboardAvoidingView
      style={{flex: 1, backgroundColor: palette.bg}}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: spacing.lg, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <TouchableOpacity onPress={() => setScreen('notes')} style={{padding: 4, flexDirection: 'row', alignItems: 'center'}}>
          <ChevronLeftIcon size={20} color={palette.textMuted} />
          <Text style={[type.mono, {marginLeft: 6, color: palette.textMuted, fontSize: 11}]}>
            NOTES
          </Text>
        </TouchableOpacity>
        <View style={{flexDirection: 'row', gap: 12, alignItems: 'center'}}>
          {saving ? (
            <Text style={[type.monoMuted, {fontSize: 10, color: palette.textDim}]}>SAVING…</Text>
          ) : lastSaved ? (
            <Text style={[type.monoMuted, {fontSize: 10, color: palette.textDim}]}>
              SAVED {Math.floor((Date.now() - lastSaved) / 1000)}s ago
            </Text>
          ) : null}
          <TouchableOpacity onPress={() => void save()} style={{padding: 4}}>
            <RefreshIcon size={16} color={palette.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAiOpen(o => !o)} style={{padding: 4}}>
            <BotIcon size={16} color={aiOpen ? palette.accent : palette.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.md}}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Untitled"
          placeholderTextColor={palette.textGhost}
          style={{
            color: palette.text, fontSize: 22, fontWeight: '600',
            letterSpacing: -0.6, paddingVertical: 4,
          }}
        />
      </View>

      <View style={{height: 1, backgroundColor: palette.border, marginTop: spacing.sm}} />

      {aiOpen ? (
        <View style={{
          padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border,
          backgroundColor: palette.surface,
        }}>
          <Text style={[type.label, {marginBottom: 6}]}>AI ASSIST</Text>

          {/* Mobile-mode banner. AI assist works in mobile mode (we send the
              prompt straight to the model API), but the desktop tools (file
              lookup, terminal, web fetch) are unavailable. Tell the user. */}
          {!engineClient ? (
            <View style={{
              flexDirection: 'row', alignItems: 'flex-start', gap: 8,
              padding: spacing.sm, marginBottom: spacing.sm,
              borderWidth: 1, borderColor: palette.border,
              borderLeftWidth: 2, borderLeftColor: palette.textDim,
              backgroundColor: palette.bg,
            }}>
              <View style={{marginTop: 2}}><InfoIcon size={12} color={palette.textMuted} /></View>
              <View style={{flex: 1}}>
                <Text style={[type.monoMuted, {color: palette.text, fontSize: 11, lineHeight: 16}]}>
                  Mobile mode — no desktop tools. The model can still read your note and answer; it just can't open files, run commands, or browse.
                </Text>
                <TouchableOpacity
                  onPress={() => { void switchEngine('desktop'); }}
                  style={{
                    alignSelf: 'flex-start', marginTop: 8,
                    paddingVertical: 6, paddingHorizontal: 10,
                    borderWidth: 1, borderColor: palette.border,
                  }}>
                  <Text style={[type.h2, {color: palette.text, fontSize: 10, letterSpacing: 0.5}]}>
                    SWITCH TO DESKTOP FOR TOOLS
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <TextInput
            value={aiPrompt}
            onChangeText={setAiPrompt}
            placeholder="Ask the agent something about this note…"
            placeholderTextColor={palette.textGhost}
            style={{
              color: palette.text, fontSize: 13, fontFamily: monoFont,
              backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border,
              paddingHorizontal: 10, paddingVertical: 8,
            }}
            autoCapitalize="sentences"
            multiline
          />
          <TouchableOpacity
            onPress={onAiAssist}
            disabled={aiWorking}
            style={{
              backgroundColor: aiWorking ? palette.surfaceAlt : palette.accent,
              paddingVertical: 10, alignItems: 'center',
              marginTop: 8, flexDirection: 'row', justifyContent: 'center', gap: 8,
            }}>
            {aiWorking ? <ActivityIndicator color={palette.bg} size="small" /> : <BotIcon size={14} color={palette.bg} />}
            <Text style={[type.h2, {color: palette.bg, fontSize: 12, letterSpacing: 0.5}]}>
              {aiWorking ? 'THINKING' : 'ASK HERMES'}
            </Text>
          </TouchableOpacity>
          {aiResult ? (
            <View style={{
              marginTop: 8, padding: 10,
              backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border,
            }}>
              <Text style={[type.label, {marginBottom: 4, color: palette.success}]}>RESPONSE</Text>
              <Text style={{
                color: palette.text, fontSize: 13, lineHeight: 19, fontFamily: monoFont,
              }}>
                {aiResult}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <ScrollView style={{flex: 1}} keyboardShouldPersistTaps="handled">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Start writing…"
          placeholderTextColor={palette.textGhost}
          multiline
          textAlignVertical="top"
          style={{
            color: palette.text, fontSize: 15, lineHeight: 22, fontFamily: monoFont,
            padding: spacing.lg, paddingBottom: 80, minHeight: 400,
            letterSpacing: 0,
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
