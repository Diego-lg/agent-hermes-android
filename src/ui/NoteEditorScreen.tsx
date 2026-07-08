/**
 * Note editor — full-screen markdown editor for a single note.
 *
 * Plain TextInput with monospace font, hairline-bordered, no card chrome.
 * Autosaves to Drive every 1.2s after the last keystroke.
 * Has an AI assist panel (collapsible) that pipes the note through Hermes
 * to summarize / extract actions / polish / translate.
 */
import React, {useEffect, useRef, useState} from 'react';
import {View, ScrollView, TextInput, TouchableOpacity, Text, ActivityIndicator, KeyboardAvoidingView, Platform} from 'react-native';
import {useApp} from './AppContext';
import {palette, spacing, type} from './theme';
import {ChevronLeftIcon, SaveIcon, RefreshIcon, BotIcon} from './icons';
import {notesStore, NoteContent} from '../api/notesStore';
import {HermesClient} from '../api/hermesClient';

export default function NoteEditorScreen() {
  const {setScreen, client} = useApp();
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

  // On mount: pick the most recently modified note from a query param or load the first.
  // For the MVP, we open a fresh note (id-less) if no note is in flight; otherwise
  // the list screen passes a pending id via AppContext. For simplicity here we
  // load the first note.
  useEffect(() => {
    (async () => {
      try {
        if (!notesStore.isAuthorized()) {
          setScreen('settings');
          return;
        }
        const list = await notesStore.list();
        if (list.length === 0) {
          // create one
          const n = await notesStore.write('Untitled', '# Untitled\n\n');
          setNote(n);
          setName(n.name);
          setDraft(n.content);
        } else {
          const first = list[0];
          const n = await notesStore.read(first.id);
          setNote(n);
          setName(n.name);
          setDraft(n.content);
        }
      } catch (e) {
        console.warn('editor init', e);
      }
    })();
  }, [setScreen]);

  // Debounced autosave
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
    } catch (e) {
      console.warn('save failed', e);
    } finally {
      setSaving(false);
    }
  };

  const onAiAssist = async () => {
    if (!client || !draft.trim()) {
      setAiResult('Connect to your desktop Hermes and add some text to use AI assist.');
      return;
    }
    setAiWorking(true);
    setAiResult(null);
    try {
      // Spawn a sub-session with a note-aware system prompt, send the note as context,
      // collect the streaming reply.
      const sid = await client.createSession('Note Assistant');
      let result = '';
      const off = client.onEvent((type, params) => {
        if (params?.session_id && params.session_id !== sid) return;
        if (type === 'message.delta') {
          result += params.payload?.text ?? '';
          setAiResult(result);
        }
      });
      const composed = `You are an AI assistant helping the user work with a personal note. Here is the note's content:\n\n---\n${draft}\n---\n\nUser request: ${aiPrompt}\n\nRespond in plain text, no preamble. Be concise and direct.`;
      const handle = client.submitPrompt(composed, sid);
      const final = await handle.done;
      off();
      setAiResult(final.text);
      await client.closeSession(sid);
    } catch (e: any) {
      setAiResult(`Error: ${e?.message ?? String(e)}`);
    } finally {
      setAiWorking(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{flex: 1, backgroundColor: palette.bg}}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: spacing.lg, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: palette.hairline,
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
            <BotIcon size={16} color={aiOpen ? palette.on : palette.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Title */}
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

      <View style={{height: 1, backgroundColor: palette.hairline, marginTop: spacing.sm}} />

      {/* AI panel (collapsible) */}
      {aiOpen ? (
        <View style={{
          padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.hairline,
          backgroundColor: palette.surface,
        }}>
          <Text style={[type.label, {marginBottom: 6}]}>AI ASSIST</Text>
          <TextInput
            value={aiPrompt}
            onChangeText={setAiPrompt}
            placeholder="Ask the agent something about this note…"
            placeholderTextColor={palette.textGhost}
            style={{
              color: palette.text, fontSize: 13,
              fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}) as any,
              backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.hairline,
              paddingHorizontal: 10, paddingVertical: 8,
            }}
            autoCapitalize="sentences"
            multiline
          />
          <TouchableOpacity
            onPress={onAiAssist}
            disabled={aiWorking}
            style={{
              backgroundColor: aiWorking ? palette.surfaceHigh : palette.on,
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
              backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.hairline,
            }}>
              <Text style={[type.label, {marginBottom: 4, color: palette.active}]}>RESPONSE</Text>
              <Text style={{
                color: palette.text, fontSize: 13, lineHeight: 19,
                fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}) as any,
              }}>
                {aiResult}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Body */}
      <ScrollView style={{flex: 1}} keyboardShouldPersistTaps="handled">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Start writing…"
          placeholderTextColor={palette.textGhost}
          multiline
          textAlignVertical="top"
          style={{
            color: palette.text, fontSize: 15, lineHeight: 22,
            fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}) as any,
            padding: spacing.lg, paddingBottom: 80, minHeight: 400,
            letterSpacing: 0,
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
