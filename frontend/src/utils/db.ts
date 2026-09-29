import Dexie, { type Table } from 'dexie';
import type { RingRecord } from '../types/ring-record';
import { normalizeRingNo } from '../types/ring-record';
import type { Morphometrics } from '../types/morphometrics';
import type { BirdSite } from '../types/bird-site';
import type { SurveySession } from '../types/session';
import type { Bird } from '../types/bird';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbbirdring-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class BirdRingDB extends Dexie {
  birds!: Table<Bird, string>;
  rings!: Table<RingRecord, string>;
  morphs!: Table<Morphometrics, string>;
  sites!: Table<BirdSite, string>;
  sessions!: Table<SurveySession, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId',
      morphs: 'id, ringId, measuredAt',
      sites: 'id, siteNo, habitat, name',
      sessions: 'id, sessionNo, date, siteId, closed',
      meta: 'key',
    });

    // v2：环志表增加 (speciesCn+ringDate) 复合索引，鸟种按日期检索更快；并回填历史彩环字段。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(2)
      .stores({
        rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId, [speciesCn+ringDate]',
        morphs: 'id, ringId, measuredAt',
        sites: 'id, siteNo, habitat, name',
        sessions: 'id, sessionNo, date, siteId, closed',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('rings')
          .toCollection()
          .modify((row: RingRecord) => {
            if (typeof row.colorRing !== 'string') {
              row.colorRing = '无';
            }
          });
      });

    // v3：一只鸟一个主档。新增 birds 主档表，rings 降为捕获事件并加 birdId 索引。
    // 升级时按金属环号把现有初捕 / 重捕 / 回收自动归入同一条个体链；
    // 只有重捕或回收（站外回收、无本地初捕）的环号同样建档。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(3)
      .stores({
        birds: 'id, ringNo, firstDate, lastDate',
        rings: 'id, birdId, ringNo, speciesCn, status, ringDate, siteId, sessionId, [speciesCn+ringDate]',
        morphs: 'id, ringId, measuredAt',
        sites: 'id, siteNo, habitat, name',
        sessions: 'id, sessionNo, date, siteId, closed',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const ringsTable = tx.table<RingRecord, string>('rings');
        const birdsTable = tx.table<Bird, string>('birds');
        const all = await ringsTable.toCollection().toArray();

        // 按归一化环号分组，同环号的全部事件归入同一条个体链
        const groups = new Map<string, RingRecord[]>();
        all.forEach((record) => {
          const key = normalizeRingNo(record.ringNo);
          const list = groups.get(key) ?? [];
          list.push(record);
          groups.set(key, list);
        });

        const birds: Bird[] = [];
        const now = new Date().toISOString();
        groups.forEach((records) => {
          const sorted = [...records].sort((a, b) => a.ringDate.localeCompare(b.ringDate));
          const first = sorted[0];
          const last = sorted[sorted.length - 1];
          // 主档 id 与最早事件 id 绑定，升级前后保持可追溯
          const birdId = `bird-${first.id.replace(/^ring-/, '')}`;
          sorted.forEach((record) => {
            record.birdId = birdId;
          });
          birds.push({
            id: birdId,
            ringNo: first.ringNo.trim(),
            colorRing: last.colorRing || '无',
            speciesCn: last.speciesCn,
            speciesSci: last.speciesSci,
            age: last.age,
            firstDate: first.ringDate,
            lastDate: last.ringDate,
            eventCount: sorted.length,
            createdAt: now,
            updatedAt: now,
          });
        });

        await ringsTable.bulkPut(all);
        await birdsTable.bulkPut(birds);
      });
  }
}

export const db = new BirdRingDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
