/**
 * Group presets — starter rosters that pre-select built-in personalities and a
 * discussion mode. The builder applies one with a tap; the user can then tweak
 * the roster before starting.
 */
import {GroupMode} from '../api/personalityStore';

export interface GroupPreset {
  id: string;
  name: string;
  blurb: string;
  icon: string;   // persona-icon key
  color: string;
  participantIds: string[];
  mode: GroupMode;
}

export const GROUP_PRESETS: GroupPreset[] = [
  {
    id: 'preset.debate',
    name: 'Debate',
    blurb: 'Optimist vs skeptic, a contrarian, and a diplomat to referee.',
    icon: 'zap',
    color: '#d9503f',
    participantIds: ['builtin.optimist', 'builtin.skeptic', 'builtin.contrarian', 'builtin.diplomat'],
    mode: 'moderated',
  },
  {
    id: 'preset.brainstorm',
    name: 'Brainstorm',
    blurb: 'Generative minds riffing: visionary, optimist, designer, storyteller.',
    icon: 'sparkles',
    color: '#6a82e0',
    participantIds: ['builtin.visionary', 'builtin.optimist', 'builtin.designer', 'builtin.storyteller'],
    mode: 'round_robin',
  },
  {
    id: 'preset.devils-advocate',
    name: "Devil's Advocate",
    blurb: 'Proposers meet a relentless contrarian, a skeptic, and the fine-print lawyer.',
    icon: 'shield',
    color: '#dd6a2e',
    participantIds: ['builtin.contrarian', 'builtin.optimist', 'builtin.pragmatist', 'builtin.lawyer'],
    mode: 'round_robin',
  },
  {
    id: 'preset.expert-panel',
    name: 'Expert Panel',
    blurb: 'Domain experts weigh in: economist, engineer, scientist, strategist.',
    icon: 'cpu',
    color: '#1fa896',
    participantIds: ['builtin.economist', 'builtin.engineer', 'builtin.scientist', 'builtin.strategist'],
    mode: 'moderated',
  },
];
