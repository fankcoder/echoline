export type ActiveStudyPhase = 'listening' | 'repeat';

export function normalizeRepeatCount(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') return 1;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(9, Math.max(0, Math.round(numeric))) : 1;
}

export function phaseAfterCue(phase: ActiveStudyPhase, completedRepeats: number, repeatCount: number): 'pause' | 'ready' {
  if (phase === 'listening') return repeatCount > 0 ? 'pause' : 'ready';
  return completedRepeats >= repeatCount ? 'ready' : 'pause';
}
