import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { createBird, normalizeRingNo, originOfEarliest } from '../utils/birds';
import type { BirdAge, BirdProfile, RingRecord, RingStatus } from '../types/ring-record';
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
  /** 个体主档（一只鸟一条） */
  birds: BirdProfile[];
  /** 捕获事件（初捕 / 重捕 / 回收） */
  rings: RingRecord[];
  hydrated: boolean;
}

/** 个体主档 + 捕获事件：同环号续录重捕 / 回收，事件可独立删除而主档保留 */
export const useRingStore = defineStore('ring', {
  state: (): RingState => ({ birds: [], rings: [], hydrated: false }),

  getters: {
    /** 按金属环号（忽略大小写）找个体主档 */
    birdByRingNo(state) {
      return (ringNo: string): BirdProfile | undefined => {
        const key = normalizeRingNo(ringNo);
        return state.birds.find((bird) => normalizeRingNo(bird.ringNo) === key);
      };
    },
    birdById(state) {
      return (birdId: string): BirdProfile | undefined => state.birds.find((bird) => bird.id === birdId);
    },
    /** 同一主档下的全部捕获事件，按日期升序 */
    eventsOfBird(state) {
      return (birdId: string): RingRecord[] =>
        state.rings
          .filter((record) => record.birdId === birdId)
          .sort((a, b) => a.ringDate.localeCompare(b.ringDate) || a.id.localeCompare(b.id));
    },
    /** 同一环号的全部历史事件（含重捕 / 回收） */
    historyOf(state) {
      return (ringNo: string): RingRecord[] => {
        const key = normalizeRingNo(ringNo);
        const bird = state.birds.find((item) => normalizeRingNo(item.ringNo) === key);
        if (!bird) return [];
        return state.rings
          .filter((record) => record.birdId === bird.id)
          .sort((a, b) => a.ringDate.localeCompare(b.ringDate) || a.id.localeCompare(b.id));
      };
    },
  },

  actions: {
    async hydrate() {
      const [birds, rings] = await Promise.all([
        db.birds.orderBy('ringNo').toArray(),
        db.rings.orderBy('ringDate').reverse().toArray(),
      ]);
      this.birds = birds;
      this.rings = rings;
      this.hydrated = true;
    },

    /**
     * 登记捕获事件：
     * - 环号首次出现 → 建主档（初捕 → 本地初捕；回收 → 外站回收；重捕 → 缺初捕档案）；
     * - 环号已有主档 → 作为新的重捕 / 回收事件挂在同一主档下，鸟种以主档为准。
     */
    async addRing(input: RingInput): Promise<{ record: RingRecord; bird: BirdProfile; created: boolean }> {
      const ringNo = input.ringNo.trim();
      const ringDate = input.ringDate ?? new Date().toISOString();
      let bird = this.birdByRingNo(ringNo);
      const created = !bird;

      if (!bird) {
        bird = createBird({
          ringNo,
          colorRing: input.colorRing || '无',
          speciesCn: input.speciesCn,
          speciesSci: input.speciesSci,
          origin: originOfEarliest(input.status),
          createdAt: ringDate,
        });
      }

      const record: RingRecord = {
        id: uid('ring'),
        birdId: bird.id,
        ringNo: bird.ringNo,
        colorRing: input.colorRing || bird.colorRing || '无',
        speciesCn: bird.speciesCn,
        speciesSci: bird.speciesSci,
        age: input.age,
        ringDate,
        netNo: input.netNo.trim(),
        netRound: Number(input.netRound) || 1,
        status: input.status,
        ringer: input.ringer.trim(),
        siteId: input.siteId,
        sessionId: input.sessionId,
        remark: input.remark?.trim() || undefined,
      };

      await db.transaction('rw', db.birds, db.rings, async () => {
        if (created) await db.birds.put(toPlain(bird!));
        await db.rings.put(toPlain(record));
      });

      if (created) this.birds = [...this.birds, bird!];
      this.rings = [record, ...this.rings];
      return { record, bird: bird!, created };
    },

    /**
     * 更新捕获事件。
     * - 改环号：事件连同主档整体改挂到目标环号（目标不存在则带着主档改名）；
     * - 改鸟种：同步到主档与同链其他事件，保证「一只鸟一种」；
     * - 日期 / 鸟点 / 批次 / 量度以外的事件字段只改本事件。
     */
    async updateRing(id: string, patch: Partial<RingInput>) {
      const current = this.rings.find((record) => record.id === id);
      if (!current) return;
      const currentBird = this.birds.find((bird) => bird.id === current.birdId);
      if (!currentBird) return;

      const nextRingNo = patch.ringNo?.trim();
      const targetBird = nextRingNo && normalizeRingNo(nextRingNo) !== normalizeRingNo(currentBird.ringNo)
        ? this.birdByRingNo(nextRingNo)
        : currentBird;

      let movedBird: BirdProfile;
      if (targetBird) {
        // 挂到已有主档：身份信息以目标主档为准
        movedBird = targetBird;
      } else {
        // 主档改名（环号、彩环）
        movedBird = {
          ...currentBird,
          ringNo: nextRingNo ?? currentBird.ringNo,
          colorRing: patch.colorRing || currentBird.colorRing,
          speciesCn: patch.speciesCn?.trim() || currentBird.speciesCn,
          speciesSci: patch.speciesSci?.trim() || currentBird.speciesSci,
        };
      }

      const next: RingRecord = {
        ...current,
        birdId: movedBird.id,
        ringNo: movedBird.ringNo,
        colorRing: patch.colorRing || movedBird.colorRing || '无',
        speciesCn: movedBird.speciesCn,
        speciesSci: movedBird.speciesSci,
        age: patch.age ?? current.age,
        ringDate: patch.ringDate ?? current.ringDate,
        netNo: patch.netNo?.trim() ?? current.netNo,
        netRound: patch.netRound !== undefined ? Number(patch.netRound) || 1 : current.netRound,
        status: patch.status ?? current.status,
        ringer: patch.ringer?.trim() ?? current.ringer,
        siteId: patch.siteId ?? current.siteId,
        sessionId: patch.sessionId ?? current.sessionId,
        remark: patch.remark !== undefined ? patch.remark.trim() || undefined : current.remark,
      };

      // 改名主档时，同链其他事件的环号/鸟种一并同步
      const siblingEvents =
        movedBird.id === currentBird.id && !targetBird
          ? this.rings.filter((record) => record.birdId === movedBird.id && record.id !== id)
          : [];
      const syncedSiblings = siblingEvents.map((event) => ({
        ...event,
        ringNo: movedBird.ringNo,
        colorRing: movedBird.colorRing,
        speciesCn: movedBird.speciesCn,
        speciesSci: movedBird.speciesSci,
      }));

      await db.transaction('rw', db.birds, db.rings, async () => {
        if (movedBird.id === currentBird.id) {
          await db.birds.put(toPlain(movedBird));
        }
        await db.rings.put(toPlain(next));
        if (syncedSiblings.length) await db.rings.bulkPut(toPlain(syncedSiblings));
      });

      this.birds = this.birds.map((bird) => (bird.id === movedBird.id ? movedBird : bird));
      this.rings = this.rings.map((record) => {
        if (record.id === id) return next;
        const synced = syncedSiblings.find((event) => event.id === record.id);
        return synced ?? record;
      });
    },

    /**
     * 删除单条捕获事件：
     * 只删该事件（及其量度，量度由 measureStore 级联清理），
     * 个体主档与同链其他事件一律保留——即使主档下已无事件也先保留有历史的主档。
     */
    async removeRing(id: string) {
      const morphIds = (await db.morphs.where('ringId').equals(id).primaryKeys()) as string[];
      await db.transaction('rw', db.rings, db.morphs, async () => {
        await db.rings.delete(id);
        if (morphIds.length) await db.morphs.bulkDelete(morphIds);
      });
      this.rings = this.rings.filter((record) => record.id !== id);
      // 级联清理量度的内存状态（measureStore 不反向依赖本 store，无循环引用）
      if (morphIds.length) {
        useMeasureStore().removeMorphs(morphIds);
      }
      return { morphIds };
    },
  },
});
