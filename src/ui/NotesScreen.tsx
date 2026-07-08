/**
 * Notes tab. Theme-aware.
 */
import React, {useEffect, useState, useCallback} from 'react';
import {View, ScrollView, TouchableOpacity, RefreshControl, Text, TextInput, Alert} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {ChevronRightIcon, RefreshIcon, PlusIcon, SearchIcon, TrashIcon} from './icons';
import {notesStore, NoteMeta} from '../api/notesStore';

export default function NotesScreen() {
  const {setScreen, setCurrentNoteId} = useApp();
  const {palette, spacing, type} = useTheme();
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [driveReady, setDriveReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await notesStore.loadConfig();
      const restored = await notesStore.restore();
      setDriveReady(notesStore.hasConfig() && restored);
      if (notesStore.hasConfig() && restored) {
        const list = await notesStore.list();
        setNotes(list);
      } else {
        setNotes([]);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = notes.filter(n => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return n.name.toLowerCase().includes(q) ||
      (n.preview ?? '').toLowerCase().includes(q);
  });

  const onCreate = async () => {
    if (!driveReady) { setScreen('settings'); return; }
    try {
      const name = `Untitled ${new Date().toLocaleString()}`;
      const note = await notesStore.write(name, `# ${name}\n\n`);
      const meta: NoteMeta = {
        ...note,
        mimeType: 'text/markdown',
        modifiedTime: new Date(note.modifiedMs).toISOString(),
      } as NoteMeta;
      setNotes(prev => [meta, ...prev]);
      setCurrentNoteId(note.id);
      setScreen('noteEditor');
    } catch (e: any) {
      Alert.alert('Could not create note', e?.message ?? String(e));
    }
  };

  const onDelete = (n: NoteMeta) => {
    Alert.alert('Delete note?', `"${n.name}" will be moved to Google Drive trash.`, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await notesStore.delete(n.id);
          setNotes(prev => prev.filter(x => x.id !== n.id));
        } catch (e: any) {
          Alert.alert('Delete failed', e?.message ?? String(e));
        }
      }},
    ]);
  };

  if (!driveReady) {
    return (
      <ScrollView style={{flex: 1, backgroundColor: palette.bg}}
        contentContainerStyle={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: 40}}>
        <Text style={type.label}>NOTES</Text>
        <Text style={[type.displaySmall, {marginTop: spacing.sm}]}>Cloud</Text>
        <View style={{height: 1, backgroundColor: palette.border, marginTop: spacing.xl}} />

        <View style={{paddingVertical: spacing.xl, alignItems: 'center'}}>
          <View style={{
            width: 60, height: 60, borderRadius: 6,
            borderWidth: 1, borderColor: palette.border, borderStyle: 'dashed',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={[type.mono, {fontSize: 22, color: palette.textMuted}]}>⏖</Text>
          </View>
          <Text style={[type.h2, {marginTop: spacing.lg, fontSize: 15, textAlign: 'center'}]}>
            Connect Google Drive
          </Text>
          <Text style={[type.body, {color: palette.textMuted, textAlign: 'center', marginTop: 6, maxWidth: 280, fontSize: 12}]}>
            Notes are stored as markdown files in your Google Drive. They sync across all your devices and stay yours forever.
          </Text>
          <TouchableOpacity
            onPress={() => setScreen('settings')}
            style={{
              backgroundColor: palette.accent,
              paddingHorizontal: spacing.lg, paddingVertical: 10,
              marginTop: spacing.lg,
            }}>
            <Text style={[type.h2, {color: palette.bg, fontSize: 12, letterSpacing: 0.5}]}>
              CONFIGURE IN SETTINGS
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{flex: 1, backgroundColor: palette.bg}}
      contentContainerStyle={{paddingBottom: 40}}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh}
          tintColor={palette.textMuted} colors={[palette.text]} />
      }>
      <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl}}>
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
          <View>
            <Text style={type.label}>NOTES</Text>
            <Text style={[type.displaySmall, {marginTop: spacing.sm}]}>
              {notes.length} {notes.length === 1 ? 'note' : 'notes'}
            </Text>
          </View>
          <View style={{flexDirection: 'row', gap: 12, alignItems: 'center'}}>
            <TouchableOpacity onPress={refresh} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <RefreshIcon size={16} color={palette.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onCreate} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <PlusIcon size={20} color={palette.accent} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={{
          flexDirection: 'row', alignItems: 'center',
          backgroundColor: palette.surface,
          borderWidth: 1, borderColor: palette.border,
          paddingHorizontal: 10, marginTop: spacing.lg,
        }}>
          <SearchIcon size={14} color={palette.textDim} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="search…"
            placeholderTextColor={palette.textGhost}
            style={{
              flex: 1, color: palette.text, fontSize: 13,
              paddingVertical: 8, paddingHorizontal: 8,
            }}
          />
        </View>

        <View style={{height: 1, backgroundColor: palette.border, marginTop: spacing.lg}} />

        {error ? (
          <View style={{padding: spacing.md, borderWidth: 1, borderColor: palette.error, marginTop: spacing.md}}>
            <Text style={[type.label, {color: palette.error}]}>DRIVE ERROR</Text>
            <Text style={[type.monoMuted, {marginTop: 4, color: palette.textMuted}]}>{error}</Text>
          </View>
        ) : filtered.length === 0 ? (
          <Text style={[type.body, {color: palette.textMuted, paddingVertical: spacing.xl, fontSize: 12, textAlign: 'center'}]}>
            {search ? 'No notes match.' : 'No notes yet. Tap + to create one.'}
          </Text>
        ) : (
          filtered.map((n, idx) => (
            <View
              key={n.id}
              style={{
                flexDirection: 'row', alignItems: 'flex-start',
                paddingVertical: spacing.md,
                borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: palette.border,
              }}>
              <Text style={[type.mono, {width: 32, color: palette.textDim, fontSize: 10, marginTop: 2}]}>
                {String(idx + 1).padStart(2, '0')}
              </Text>
              <TouchableOpacity
                style={{flex: 1}}
                onPress={() => { setCurrentNoteId(n.id); setScreen('noteEditor'); }}
                onLongPress={() => onDelete(n)}>
                <Text style={[type.body, {fontWeight: '600', fontSize: 14}]} numberOfLines={1}>
                  {n.name}
                </Text>
                <Text style={[type.monoMuted, {marginTop: 4, fontSize: 10}]}>
                  {formatRelative(n.modifiedMs)}  ·  {(n.size ? `${n.size}b` : '—')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onDelete(n)} style={{padding: 4, marginLeft: 8}}>
                <TrashIcon size={14} color={palette.textDim} />
              </TouchableOpacity>
              <ChevronRightIcon size={16} color={palette.textDim} />
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
