/**
 * Cron jobs client — talks to the desktop Hermes `cron.manage` JSON-RPC method.
 *
 * Each job is a scheduled prompt. The desktop runs the prompt on a schedule;
 * the phone is the viewer + manager.
 */
import {HermesClient} from './hermesClient';
import {kv, STORAGE_KEYS} from './storage';

export interface CronJob {
  id: string;
  name: string;
  schedule: string;            // cron expression, e.g. "0 8 * * *"
  prompt: string;              // the prompt to fire
  sessionId?: string;          // optional target session
  enabled: boolean;
  lastRun?: number;            // ms since epoch
  nextRun?: number;
}

interface RawCronJob {
  id?: string;
  name?: string;
  schedule?: string;
  cron?: string;                // alternative field name
  prompt?: string;
  session_id?: string;
  sessionId?: string;
  enabled?: boolean;
  active?: boolean;
  last_run?: number;
  lastRun?: number;
  next_run?: number;
  nextRun?: number;
}

export class CronClient {
  constructor(private client: HermesClient) {}

  async list(): Promise<CronJob[]> {
    const r = await this.client.rpc('cron.manage', {action: 'list'});
    const items = (r?.jobs ?? r?.items ?? r ?? []) as RawCronJob[];
    return items.map(this.normalize);
  }

  async create(job: Omit<CronJob, 'id'>): Promise<CronJob> {
    const r = await this.client.rpc('cron.manage', {
      action: 'create',
      name: job.name,
      schedule: job.schedule,
      prompt: job.prompt,
      session_id: job.sessionId,
      enabled: job.enabled,
    });
    return this.normalize(r?.job ?? r ?? {...job, id: r?.id ?? ''});
  }

  async update(id: string, patch: Partial<CronJob>): Promise<CronJob> {
    const r = await this.client.rpc('cron.manage', {
      action: 'update', id,
      ...patch,
      session_id: patch.sessionId,
    });
    return this.normalize(r?.job ?? r);
  }

  async delete(id: string): Promise<void> {
    await this.client.rpc('cron.manage', {action: 'delete', id});
  }

  async toggle(id: string, enabled: boolean): Promise<void> {
    await this.client.rpc('cron.manage', {action: 'toggle', id, enabled});
  }

  async runNow(id: string): Promise<void> {
    await this.client.rpc('cron.manage', {action: 'run', id});
  }

  /** Server uses several different field names — normalise them. */
  private normalize = (raw: RawCronJob): CronJob => ({
    id: raw.id ?? '',
    name: raw.name ?? '(unnamed)',
    schedule: raw.schedule ?? raw.cron ?? '',
    prompt: raw.prompt ?? '',
    sessionId: raw.session_id ?? raw.sessionId,
    enabled: raw.enabled ?? raw.active ?? true,
    lastRun: raw.last_run ?? raw.lastRun,
    nextRun: raw.next_run ?? raw.nextRun,
  });
}
