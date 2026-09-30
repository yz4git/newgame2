export type HudPayload = {
  hp: number;
  energy: number;
  score: number;
  combo: number;
  zone: string;
  tech: string;
  bossHp?: number;
  bossName?: string;
};

export type ResultPayload = {
  win: boolean;
  score: number;
  best: number;
  defeated: number;
  seconds: number;
};

export const gameBus = new EventTarget();

export function emit<T>(name: string, detail: T): void {
  gameBus.dispatchEvent(new CustomEvent<T>(name, { detail }));
}
