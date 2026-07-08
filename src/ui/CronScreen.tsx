/**
 * Cron jobs tab. Theme-aware.
 */
import React, {useEffect, useState, useCallback} from 'react';
import {View, ScrollView, TouchableOpacity, RefreshControl, Text, TextInput, Modal, Alert} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {ChevronRightIcon, RefreshIcon, PlusIcon, PlayIcon, TrashIcon, XIcon} from './icons';
import {CronClient, CronJob} from '../api/cronClient';

export default function CronScreen() {
  const {client} = useApp();
  const {palette, spacing, type} = useTheme();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{job?: CronJob} | null>(null);
  const [draft, setDraft] = useState({name: '', schedule: '0 8 * * *', prompt: ''});
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});

  const refresh = useCallback(async () => {
    if (!client) return;
    setRefreshing(true);
    setError(null);
    try {
      const c = new CronClient(client);
      const list = await c.list();
      setJobs(list);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onToggle = async (j: CronJob) => {
    if (!client) return;
    try {
      const c = new CronClient(client);
      await c.toggle(j.id, !j.enabled);
      setJobs(prev => prev.map(x => x.id === j.id ? {...x, enabled: !x.enabled} : x));
    } catch (e: any) { Alert.alert('Toggle failed', e?.message ?? String(e)); }
  };

  const onRunNow = async (j: CronJob) => {
    if (!client) return;
    try {
      const c = new CronClient(client);
      await c.runNow(j.id);
      Alert.alert('Triggered', `"${j.name}" is running now on the desktop.`);
    } catch (e: any) { Alert.alert('Run failed', e?.message ?? String(e)); }
  };

  const onDelete = (j: CronJob) => {
    Alert.alert('Delete cron?', `"${j.name}" will stop running.`, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Delete', style: 'destructive', onPress: async () => {
        if (!client) return;
        try {
          const c = new CronClient(client);
          await c.delete(j.id);
          setJobs(prev => prev.filter(x => x.id !== j.id));
        } catch (e: any) { Alert.alert('Delete failed', e?.message ?? String(e)); }
      }},
    ]);
  };

  const onCreate = () => { setDraft({name: '', schedule: '0 8 * * *', prompt: ''}); setEditing({}); };
  const onEdit = (j: CronJob) => { setDraft({name: j.name, schedule: j.schedule, prompt: j.prompt}); setEditing({job: j}); };

  const onSave = async () => {
    if (!client) return;
    if (!draft.name.trim() || !draft.prompt.trim()) {
      Alert.alert('Missing fields', 'Name and prompt are required.');
      return;
    }
    try {
      const c = new CronClient(client);
      if (editing?.job) {
        await c.update(editing.job.id, {...draft, enabled: editing.job.enabled});
      } else {
        await c.create({...draft, enabled: true});
      }
      setEditing(null);
      await refresh();
    } catch (e: any) { Alert.alert('Save failed', e?.message ?? String(e)); }
  };

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <ScrollView
        style={{flex: 1}}
        contentContainerStyle={{paddingBottom: 40}}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh}
            tintColor={palette.textMuted} colors={[palette.text]} />
        }>
        <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl}}>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
            <View>
              <Text style={type.label}>CRON</Text>
              <Text style={[type.displaySmall, {marginTop: spacing.sm}]}>
                {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
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

          <View style={{height: 1, backgroundColor: palette.border, marginTop: spacing.lg}} />

          {error ? (
            <View style={{padding: spacing.md, borderWidth: 1, borderColor: palette.error, marginTop: spacing.md}}>
              <Text style={[type.label, {color: palette.error}]}>CRON ERROR</Text>
              <Text style={[type.monoMuted, {marginTop: 4, color: palette.textMuted}]}>{error}</Text>
            </View>
          ) : jobs.length === 0 ? (
            <Text style={[type.body, {color: palette.textMuted, paddingVertical: spacing.xl, fontSize: 12, textAlign: 'center'}]}>
              No cron jobs. Tap + to schedule a prompt.
            </Text>
          ) : (
            jobs.map((j, idx) => (
              <View
                key={j.id}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: spacing.md,
                  borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: palette.border,
                  opacity: j.enabled ? 1 : 0.5,
                }}>
                <Text style={[type.mono, {width: 32, color: palette.textDim, fontSize: 10}]}>
                  {String(idx + 1).padStart(2, '0')}
                </Text>
                <View style={{flex: 1}}>
                  <Text style={[type.body, {fontWeight: '600'}]} numberOfLines={1}>{j.name}</Text>
                  <Text style={[type.monoMuted, {marginTop: 4, fontSize: 10}]}>
                    {j.schedule}  ·  {j.nextRun ? `next: ${formatRelative(j.nextRun)}` : 'paused'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => onRunNow(j)} style={{padding: 8}}>
                  <PlayIcon size={14} color={palette.success} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onToggle(j)} style={{padding: 8}}>
                  <Text style={[type.mono, {fontSize: 10, color: j.enabled ? palette.success : palette.textDim}]}>
                    {j.enabled ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onEdit(j)} style={{padding: 4}}>
                  <ChevronRightIcon size={16} color={palette.textDim} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onDelete(j)} style={{padding: 4}}>
                  <TrashIcon size={14} color={palette.textDim} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end'}}>
          <View style={{
            backgroundColor: palette.bg,
            borderTopWidth: 1, borderColor: palette.borderStrong,
            padding: spacing.lg, paddingBottom: spacing.xxl,
          }}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg}}>
              <Text style={[type.h1, {fontSize: 15}]}>
                {editing?.job ? 'EDIT JOB' : 'NEW CRON JOB'}
              </Text>
              <TouchableOpacity onPress={() => setEditing(null)} style={{padding: 4}}>
                <XIcon size={18} color={palette.textMuted} />
              </TouchableOpacity>
            </View>

            <Label>NAME</Label>
            <TextInput
              value={draft.name}
              onChangeText={v => setDraft({...draft, name: v})}
              placeholder="Morning standup"
              placeholderTextColor={palette.textGhost}
              style={useInputStyle()}
              autoCapitalize="none"
            />

            <Label>SCHEDULE (cron)</Label>
            <TextInput
              value={draft.schedule}
              onChangeText={v => setDraft({...draft, schedule: v})}
              placeholder="0 8 * * *"
              placeholderTextColor={palette.textGhost}
              style={useInputStyle()}
              autoCapitalize="none"
            />
            <Text style={[type.monoMuted, {marginTop: 4, fontSize: 10, color: palette.textDim}]}>
              min hour day-of-month month day-of-week — e.g. 0 8 * * * = daily 8am
            </Text>

            <Label>PROMPT</Label>
            <TextInput
              value={draft.prompt}
              onChangeText={v => setDraft({...draft, prompt: v})}
              placeholder="Summarise my unread emails and draft replies"
              placeholderTextColor={palette.textGhost}
              style={[useInputStyle(), {minHeight: 80, textAlignVertical: 'top'}]}
              multiline
              autoCapitalize="sentences"
            />

            <View style={{flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg}}>
              <TouchableOpacity
                onPress={() => setEditing(null)}
                style={{flex: 1, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: palette.border}}>
                <Text style={[type.h2, {color: palette.text, fontSize: 12, letterSpacing: 0.5}]}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onSave}
                style={{flex: 1, paddingVertical: 12, alignItems: 'center', backgroundColor: palette.accent}}>
                <Text style={[type.h2, {color: palette.bg, fontSize: 12, letterSpacing: 0.5}]}>
                  {editing?.job ? 'SAVE' : 'CREATE'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const Label: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {type, palette, spacing} = useTheme();
  return <Text style={[type.label, {color: palette.textMuted, marginTop: spacing.md, marginBottom: 4}]}>{children}</Text>;
};

const useInputStyle = () => {
  const {type, palette, spacing, radii} = useTheme();
  return {
    color: palette.text, fontSize: 14,
    fontFamily: type.mono.fontFamily,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.border,
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: radii.md,
  } as any;
};

function formatRelative(ts: number): string {
  const diff = ts - Date.now();
  const s = Math.floor(diff / 1000);
  if (Math.abs(s) < 60) return s >= 0 ? `in ${s}s` : `${-s}s ago`;
  const m = Math.floor(s / 60);
  if (Math.abs(m) < 60) return m >= 0 ? `in ${m}m` : `${-m}m ago`;
  const h = Math.floor(m / 60);
  if (Math.abs(h) < 24) return h >= 0 ? `in ${h}h` : `${-h}h ago`;
  const d = Math.floor(h / 24);
  return d >= 0 ? `in ${d}d` : `${-d}d ago`;
}
