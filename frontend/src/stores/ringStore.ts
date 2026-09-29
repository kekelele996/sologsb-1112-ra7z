import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { normalizeRingNo, type BirdAge, type RingRecord, type RingStatus } from '../types/ring-record';
import { useBirdStore } from './birdStore';
import { useMeasureStore } from './measureStore';

export interface RingInput {
  ringNo: string;
  colorRing: string;
  speciesCn: string;
  speciesSci: string;
  age: BirdAge;
  ringDate?: string;
  netNo: string;
  netRound: number;
  status: RingStatus;
  ringer: string;
  siteId: string;
  sessionId: string;
  remark?: string;
}

interface RingState {
  /** 捕获事件（初捕 / 重捕 / 回收），按日期倒序 */
  rings: RingRecord[];
  hydrated: boolean;
}

/**
 * 捕获事件：同一金属环号的所有事件共享一个个体主档（birdId）。
 * 环号首次出现（含仅重捕 / 站外回收）时建档，之后续录都挂到同一主档。
 */
export const useRingStore = defineStore('ring', {
  state: (): RingState => ({ rings: [], hydrated: false }),

  getters: {
    findByRingNo(state) {
      return (ringNo: string): RingRecord | undefined =>
        state.rings.find((record) => normalizeRingNo(record.ringNo) === normalizeRingNo(ringNo));
    },
    /** 同一主档下的全部捕获事件，按日期升序 */
    eventsOfBird(state) {
      return (birdId: string): RingRecord[] =>
        state.rings
          .filter((record) => record.birdId === birdId)
          .sort((a, b) => a.ringDate.localeCompare(b.ringDate));
    },
    /** 同一环号的全部历史事件（含重捕 / 回收） */
    historyOf(state) {
      return (ringNo: string): RingRecord[] =>
        state.rings
          .filter((record) => normalizeRingNo(record.ringNo) === normalizeRingNo(ringNo))
          .sort((a, b) => a.ringDate.localeCompare(b.ringDate));
    },
  },

  actions: {
    async hydrate() {
      this.rings = await db.rings.orderBy('ringDate').reverse().toArray();
      this.hydrated = true;
    },

    toEvent(input: RingInput, birdId: string, id: string): RingRecord {
      return {
        id,
        birdId,
        ringNo: input.ringNo.trim(),
        colorRing: input.colorRing || '无',
        speciesCn: input.speciesCn.trim(),
        speciesSci: input.speciesSci.trim(),
        age: input.age,
        ringDate: input.ringDate ?? new Date().toISOString(),
        netNo: input.netNo.trim(),
        netRound: Number(input.netRound) || 1,
        status: input.status,
        ringer: input.ringer.trim(),
        siteId: input.siteId,
        sessionId: input.sessionId,
        remark: input.remark?.trim() || undefined,
      };
    },

    /**
     * 新增捕获事件：
     * - 环号已有主档 → 作为重捕 / 回收事件挂到同一主档（续录）
     * - 环号首次出现 → 建立个体主档（站外回收无本地初捕也建档）
     */
    async addEvent(input: RingInput): Promise<{ record: RingRecord; birdId: string; created: boolean }> {
      const birdStore = useBirdStore();
      const record = this.toEvent(input, '', uid('ring'));

      await db.transaction('rw', db.rings, db.birds, async () => {
        const existed = birdStore.findByRingNo(record.ringNo);
        if (existed) {
          record.birdId = existed.id;
          await db.rings.put(toPlain(record));
          const events = this.eventsOfBird(existed.id).concat(record);
          await birdStore.refreshSnapshot(existed.id, events);
        } else {
          const bird = birdStore.buildFromEvent(record);
          record.birdId = bird.id;
          await db.rings.put(toPlain(record));
          await birdStore.putBird(bird);
        }
      });

      this.rings = [record, ...this.rings];
      const birdId = record.birdId;
      const created = birdStore.birds.find((bird) => bird.id === birdId)?.eventCount === 1;
      return { record, birdId, created };
    },

    /**
     * 更新捕获事件。环号被改成另一只鸟的环号时，事件整体迁移到目标主档，
     * 两个主档的快照都重算；原主档保留（即使事件数变 0）。
     */
    async updateEvent(id: string, patch: Partial<RingInput>) {
      const current = this.rings.find((record) => record.id === id);
      if (!current) return;
      const next: RingRecord = {
        ...current,
        ...patch,
        ringNo: patch.ringNo?.trim() ?? current.ringNo,
        colorRing: patch.colorRing || current.colorRing || '无',
        speciesCn: patch.speciesCn?.trim() ?? current.speciesCn,
        speciesSci: patch.speciesSci?.trim() ?? current.speciesSci,
      };
      const previousBirdId = current.birdId;
      const birdStore = useBirdStore();
      const sourceBird = birdStore.birds.find((bird) => bird.id === previousBirdId);

      await db.transaction('rw', db.rings, db.birds, async () => {
        const target = birdStore.findByRingNo(next.ringNo);
        const ringChanged = !sourceBird || normalizeRingNo(sourceBird.ringNo) !== normalizeRingNo(next.ringNo);

        if (target && target.id !== previousBirdId) {
          // 环号改成另一只鸟的环号 → 事件整体迁移到既有主档
          next.birdId = target.id;
        } else if (!target && ringChanged) {
          // 改成从未出现过的环号 → 为该事件建立新的个体主档
          const bird = birdStore.buildFromEvent(next);
          next.birdId = bird.id;
          await birdStore.putBird(bird);
        } else {
          next.birdId = previousBirdId;
        }
        await db.rings.put(toPlain(next));

        // 以「替换当前事件后」的内存视图重算相关主档
        const projected = this.rings.map((record) => (record.id === id ? next : record));
        const targetEvents = projected.filter((record) => record.birdId === next.birdId);
        await birdStore.refreshSnapshot(next.birdId, targetEvents);

        if (next.birdId !== previousBirdId) {
          // 迁出的旧主档：剩余事件重算；没有剩余事件则保留为空主档（不自动删除）
          const sourceEvents = projected.filter((record) => record.birdId === previousBirdId);
          await birdStore.refreshSnapshot(previousBirdId, sourceEvents);
        }
      });

      this.rings = this.rings.map((record) => (record.id === id ? next : record));
    },

    /**
     * 删除一条捕获事件：仅删事件本身与其量度；个体主档和其他事件完整保留。
     * 主档保留为空主档（有历史的主档先保留），不自动删除。
     */
    async removeEvent(id: string) {
      const measureStore = useMeasureStore();
      const birdStore = useBirdStore();
      const current = this.rings.find((record) => record.id === id);
      if (!current) return;

      await db.transaction('rw', db.rings, db.morphs, db.birds, async () => {
        await db.rings.delete(id);
        await db.morphs.where('ringId').equals(id).delete();
        const remaining = this.eventsOfBird(current.birdId).filter((record) => record.id !== id);
        if (remaining.length) {
          await birdStore.refreshSnapshot(current.birdId, remaining);
        } else {
          // 无剩余事件：主档仍保留，只刷新为空链快照
          await birdStore.refreshSnapshot(current.birdId, []);
        }
      });

      this.rings = this.rings.filter((record) => record.id !== id);
      measureStore.pruneForRing(id);
    },
  },
});
