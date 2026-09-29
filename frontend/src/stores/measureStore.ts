import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { Morphometrics } from '../types/morphometrics';

export interface MorphInput {
  ringId: string;
  billLength: number;
  billWidth: number;
  wingLength: number;
  tailLength: number;
  tarsusLength: number;
  weight: number;
  fatScore: number;
  measuredBy: string;
  measuredAt?: string;
}

interface MeasureState {
  morphs: Morphometrics[];
  hydrated: boolean;
}

/** 量度记录与均值偏离（偏离值在页面用 utils/stats.ts 计算，保证响应式安全） */
export const useMeasureStore = defineStore('measure', {
  state: (): MeasureState => ({ morphs: [], hydrated: false }),

  getters: {
    byRing(state) {
      return (ringId: string): Morphometrics | undefined =>
        [...state.morphs].filter((morph) => morph.ringId === ringId).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
    },
    morphsOf(state) {
      return (ringId: string): Morphometrics[] => state.morphs.filter((morph) => morph.ringId === ringId);
    },
    /** 量度记录条数（按捕获事件去重，一次捕获一条量度） */
    measuredRingCount(state): number {
      return new Set(state.morphs.map((morph) => morph.ringId)).size;
    },
  },

  actions: {
    async hydrate() {
      this.morphs = await db.morphs.orderBy('measuredAt').reverse().toArray();
      this.hydrated = true;
    },

    async addMorph(input: MorphInput): Promise<Morphometrics> {
      const morph: Morphometrics = {
        id: uid('morph'),
        ringId: input.ringId,
        billLength: Number(input.billLength) || 0,
        billWidth: Number(input.billWidth) || 0,
        wingLength: Number(input.wingLength) || 0,
        tailLength: Number(input.tailLength) || 0,
        tarsusLength: Number(input.tarsusLength) || 0,
        weight: Number(input.weight) || 0,
        fatScore: Number(input.fatScore) || 0,
        measuredBy: input.measuredBy.trim(),
        measuredAt: input.measuredAt ?? new Date().toISOString(),
      };
      await db.morphs.put(toPlain(morph));
      this.morphs = [morph, ...this.morphs];
      return morph;
    },

    async updateMorph(id: string, patch: Partial<MorphInput>) {
      const current = this.morphs.find((morph) => morph.id === id);
      if (!current) return;
      const next: Morphometrics = { ...current, ...patch };
      await db.morphs.put(toPlain(next));
      this.morphs = this.morphs.map((morph) => (morph.id === id ? next : morph));
    },

    async removeMorph(id: string) {
      await db.morphs.delete(id);
      this.morphs = this.morphs.filter((morph) => morph.id !== id);
    },

    /** 批量从内存状态移除（捕获事件删除时由 ringStore 级联调用，库内删除已在同一事务完成） */
    removeMorphs(ids: string[]) {
      const idSet = new Set(ids);
      this.morphs = this.morphs.filter((morph) => !idSet.has(morph.id));
    },
  },
});
