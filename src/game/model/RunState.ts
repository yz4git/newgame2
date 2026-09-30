const SAVE_KEY = 'rift-studio-run-v1';
const BEST_KEY = 'rift-studio-best-v1';

export type RunSave = {
  checkpoint: number;
  hp: number;
  energy: number;
  score: number;
  defeated: number;
};

export const freshRun = (): RunSave => ({
  checkpoint: 0,
  hp: 100,
  energy: 0,
  score: 0,
  defeated: 0
});

export function saveRun(run: RunSave): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify(run));
}

export function loadRun(): RunSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunSave;
    if (typeof parsed.checkpoint !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearRun(): void {
  localStorage.removeItem(SAVE_KEY);
}

export function getBest(): number {
  return Number(localStorage.getItem(BEST_KEY) || 0);
}

export function setBest(score: number): number {
  const best = Math.max(getBest(), Math.floor(score));
  localStorage.setItem(BEST_KEY, String(best));
  return best;
}
