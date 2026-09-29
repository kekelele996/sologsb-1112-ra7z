import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { normalizeRingNo } from '../types/ring-record';
import type { Bird } from '../types/bird';
import type { RingRecord } from '../types/ring-record';

interface BirdState {
  birds: Bird[];
  hydrated: boolean;
}

/**
 * 个体主档：环号首次出现时建档，后续捕获事件挂在同一主档下。
 * 主档不随捕获事件删除而消失（有历史的主档先保留），仅允许删除事件数为 0 的空主档。
 */
export const useBirdStore = defineStore('bird', {
  state: (): BirdState => ({ birds: [], hydrated: false }),

  getters: {
    /** 按归一化环号找主档（大小写 / 空白不敏感） */
    findByRingNo(state) {
      return (ringNo: string): Bird | undefined =>
        state.birds.find((bird) => normalizeRingNo(bird.ringNo) === normalizeRingNo(ringNo));
    },
    byId(state) {
      return (id: string): Bird | undefined => state.birds.find((bird) => bird.id === id);
    },
  },

  actions: {
    async hydrate() {
      this.birds = await db.birds.orderBy('lastDate').reverse().toArray();
      this.hydrated = true;
    },

    /** 从首个捕获事件建立个体主档（站外回收没有本地初捕时也建档） */
    buildFromEvent(record: RingRecord, now: string = new Date().toISOString()): Bird {
      return {
        id: uid('bird'),
        ringNo: record.ringNo.trim(),
        colorRing: record.colorRing || '无',
        speciesCn: record.speciesCn,
        speciesSci: record.speciesSci,
        age: record.age,
        firstDate: record.ringDate,
        lastDate: record.ringDate,
        eventCount: 1,
        createdAt: now,
        updatedAt: now,
      };
    },

    /** 依据主档下全部捕获事件重算快照（鸟种 / 彩环取最近事件，日期取首末）；无事件时保留档案字段，仅清零事件数 */
    snapshotFromEvents(bird: Bird, events: RingRecord[], now: string = new Date().toISOString()): Bird {
      if (events.length === 0) {
        return { ...bird, eventCount: 0, updatedAt: now };
      }
      const sorted = [...events].sort((a, b) => a.ringDate.localeCompare(b.ringDate));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      return {
        ...bird,
        colorRing: last.colorRing || '无',
        speciesCn: last.speciesCn,
        speciesSci: last.speciesSci,
        age: last.age,
        firstDate: first.ringDate,
        lastDate: last.ringDate,
        eventCount: sorted.length,
        updatedAt: now,
      };
    },

    /** 落库并同步内存 state（在调用方的事务内使用），随后按最近捕获日期倒序 */
    async putBird(bird: Bird) {
      await db.birds.put(toPlain(bird));
      const index = this.birds.findIndex((item) => item.id === bird.id);
      if (index >= 0) {
        this.birds.splice(index, 1, bird);
      } else {
        this.birds.push(bird);
      }
      this.birds.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
    },

    /** 按事件集合刷新主档快照（在调用方的事务内使用） */
    async refreshSnapshot(birdId: string, events: RingRecord[]) {
      const bird = this.birds.find((item) => item.id === birdId);
      if (!bird) return;
      const next = this.snapshotFromEvents(bird, events);
      await this.putBird(next);
    },

    /** 删除空主档：仍有捕获事件历史的主档受保护、不能删 */
    async removeBird(id: string): Promise<boolean> {
      const bird = this.birds.find((item) => item.id === id);
      if (!bird) return false;
      if (bird.eventCount > 0) return false;
      await db.birds.delete(id);
      this.birds = this.birds.filter((item) => item.id !== id);
      return true;
    },
  },
});
