/**
 * TasksScreen — view and edit the agent's scheduled cron jobs.
 *
 * Wraps the existing CronClient to render a list of jobs with:
 *   - toggle enable/disable
 *   - run-now button (fire immediately)
 *   - create / edit / delete
 *   - shows last-run and next-run timestamps
 *
 * This is the user-facing "Tasks" tab promised in the feature brief.
 */
import React, {useEffect, useState, useCallback} from 'react';
import {View, ScrollView, TouchableOpacity, RefreshControl, Text, TextInput, Modal, Alert, Platform} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {ChevronRightIcon, RefreshIcon, PlusIcon, PlayIcon, TrashIcon, XIcon, ClockIcon} from './icons';
import {CronClient, CronJob} from '../api/cronClient';

export default function TasksScreen() {
  const {engineClient, serverOnline} = useApp();
  const {palette, spacing, type} = useTheme();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{job?: CronJob} | null>(null);
  const [draft, setDraft] = useState({name: '', schedule: '0 8 * * *', prompt: ''});
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});

  const refresh = useCallback(async () => {
    if (!engineClient) return;
    setRefreshing(true);
    setError(null);
    try {
      const c = new CronClient(engineClient);
      const list = await c.list();
      setJobs(list);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRefreshing(false);
    }
  }, [engineClient]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onToggle = async (j: CronJob) => {
    if (!engineClient) return;
    try {
      const c = new CronClient(engineClient);
      await c.toggle(j.id, !j.enabled);
      setJobs(prev => prev.map(x => x.id === j.id ? {...x, enabled: !x.enabled} : x));
    } catch (e: any) { Alert.alert('Toggle failed', e?.message ?? String(e)); }
  };

  const onRunNow = async (j: CronJob) => {
    if (!engineClient) return;
    try {
      const c = new CronClient(engineClient);
      await c.runNow(j.id);
      Alert.alert('Triggered', `"${j.name}" is running now on the desktop.`);
    } catch (e: any) { Alert.alert('Run failed', e?.message ?? String(e)); }
  };

  const onDelete = (j: CronJob) => {
    Alert.alert('Delete cron?', `"${j.name}" will stop running.`, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Delete', style: 'destructive', onPress: async () => {
        if (!engineClient) return;
        try {
          const c = new CronClient(engineClient);
          await c.delete(j.id);
          setJobs(prev => prev.filter(x => x.id !== j.id));
        } catch (e: any) { Alert.alert('Delete failed', e?.message ?? String(e)); }
      }},
    ]);
  };

  const onCreate = () => { setDraft({name: '', schedule: '0 8 * * *', prompt: ''}); setEditing({}); };
  const onEdit = (j: CronJob) => { setDraft({name: j.name, schedule: j.schedule, prompt: j.prompt}); setEditing({job: j}); };

  const onSave = async () => {
    if (!engineClient) return;
    if (!draft.name.trim() || !draft.prompt.trim()) {
      Alert.alert('Missing fields', 'Name and prompt are required.');
      return;
    }
    try {
      const c = new CronClient(engineClient);
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
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>TASKS</Text>
        <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, marginRight: 8, fontFamily: monoFont}]}>
          {jobs.length} cron
        </Text>
        <TouchableOpacity onPress={refresh} style={{padding: 6, marginRight: 4}} hitSlop={{top:8, bottom:8, left:8, right:8}}>
          <RefreshIcon size={16} color={palette.textDim} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onCreate} style={{padding: 6}} hitSlop={{top:8, bottom:8, left:8, right:8}}>
          <PlusIcon size={16} color={palette.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{flex: 1}}
        contentContainerStyle={{paddingBottom: 40}}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh}
            tintColor={palette.textMuted} colors={[palette.text]} />
        }>
        <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.md}}>
          <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11, marginBottom: spacing.md}]}>
            Scheduled prompts run on the desktop server. Toggle to pause, or hit "Run now" to fire immediately.
          </Text>
        </View>

        {!serverOnline ? (
          <View style={{padding: spacing.lg}}>
            <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12}]}>
              Server offline · cannot read cron jobs.
            </Text>
          </View>
        ) : error ? (
          <View style={{padding: spacing.lg}}>
            <Text style={[type.bodyMuted, {color: palette.error, fontSize: 12}]}>{error}</Text>
          </View>
        ) : jobs.length === 0 ? (
          <View style={{padding: spacing.xl, alignItems: 'center'}}>
            <Text style={[type.label, {color: palette.textMuted}]}>NO TASKS</Text>
            <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12, marginTop: 8, textAlign: 'center', maxWidth: 280}]}>
              Tap + above to create your first scheduled prompt.
            </Text>
          </View>
        ) : (
          jobs.map(j => <JobRow key={j.id} job={j}
            onToggle={() => void onToggle(j)}
            onRun={() => void onRunNow(j)}
            onEdit={() => onEdit(j)}
            onDelete={() => onDelete(j)}
            monoFont={monoFont}
          />)
        )}
      </ScrollView>

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'}}>
          <View style={{
            backgroundColor: palette.bg,
            borderTopWidth: 1, borderColor: palette.border,
            padding: spacing.lg,
          }}>
            <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md}}>
              <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>
                {editing?.job ? 'EDIT TASK' : 'NEW TASK'}
              </Text>
              <TouchableOpacity onPress={() => setEditing(null)} style={{padding: 6}}>
                <XIcon size={18} color={palette.textDim} />
              </TouchableOpacity>
            </View>
            <Field label="NAME" value={draft.name} onChangeText={v => setDraft({...draft, name: v})} placeholder="Morning briefing" />
            <Field label="SCHEDULE (cron)" value={draft.schedule} onChangeText={v => setDraft({...draft, schedule: v})} placeholder="0 8 * * *" mono />
            <Field label="PROMPT" value={draft.prompt} onChangeText={v => setDraft({...draft, prompt: v})} placeholder="Summarize the news" multiline />
            <TouchableOpacity
              onPress={onSave}
              style={{marginTop: spacing.md, paddingVertical: 14, alignItems: 'center', backgroundColor: palette.accent}}>
              <Text style={{color: palette.bg, fontSize: 14, fontWeight: '600'}}>SAVE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const Field: React.FC<{
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; multiline?: boolean; mono?: boolean;
}> = ({label, value, onChangeText, placeholder, multiline, mono}) => {
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  return (
    <View style={{marginVertical: spacing.sm}}>
      <Text style={[type.label, {color: palette.textMuted, marginBottom: 4}]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textGhost}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          color: palette.text, fontSize: mono ? 13 : 14,
          fontFamily: mono ? monoFont : undefined,
          paddingHorizontal: 10, paddingVertical: 10,
          backgroundColor: palette.surfaceAlt,
          borderWidth: 1, borderColor: palette.border,
          minHeight: multiline ? 80 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
};

const JobRow: React.FC<{
  job: CronJob;
  onToggle: () => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  monoFont?: any;
}> = ({job, onToggle, onRun, onEdit, onDelete, monoFont}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <TouchableOpacity
      onPress={onEdit}
      activeOpacity={0.7}
      style={{
        paddingHorizontal: spacing.lg, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
      <View style={{flexDirection: 'row', alignItems: 'center'}}>
        <View style={{flex: 1, marginRight: 8}}>
          <Text style={[type.body, {color: palette.text, fontSize: 14}]} numberOfLines={1}>
            {job.name || '(unnamed)'}
          </Text>
          <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8}}>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <ClockIcon size={10} color={palette.textDim} />
              <Text style={[type.mono, {color: palette.textDim, fontSize: 10, marginLeft: 4, fontFamily: monoFont}]}>
                {job.schedule}
              </Text>
            </View>
            <Text style={[type.mono, {color: job.enabled ? palette.success : palette.textDim, fontSize: 10, fontFamily: monoFont}]}>
              {job.enabled ? 'ON' : 'OFF'}
            </Text>
            {job.lastRun ? (
              <Text style={[type.mono, {color: palette.textDim, fontSize: 10, fontFamily: monoFont}]}>
                · last {new Date(job.lastRun).toLocaleDateString()}
              </Text>
            ) : null}
          </View>
        </View>
        <TouchableOpacity onPress={onToggle} hitSlop={{top:6, bottom:6, left:6, right:6}} style={{padding: 6}}>
          <Text style={[type.mono, {color: job.enabled ? palette.success : palette.textDim, fontSize: 10, fontFamily: monoFont}]}>
            {job.enabled ? 'DISABLE' : 'ENABLE'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onRun} hitSlop={{top:6, bottom:6, left:6, right:6}} style={{padding: 6}}>
          <PlayIcon size={14} color={palette.accent} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} hitSlop={{top:6, bottom:6, left:6, right:6}} style={{padding: 6}}>
          <TrashIcon size={14} color={palette.error} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};
