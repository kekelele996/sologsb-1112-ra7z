import Dexie, { type Table } from 'dexie';
import type { BirdProfile, RingRecord } from '../types/ring-record';
import type { Morphometrics } from '../types/morphometrics';
import type { BirdSite } from '../types/bird-site';
import type { SurveySession } from '../types/session';
import { buildBirdFromEvents, normalizeRingNo } from './birds';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbbirdring-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class BirdRingDB extends Dexie {
  /** 个体主档：一只鸟一条，环号唯一 */
  birds!: Table<BirdProfile, string>;
  /** 捕获事件：初捕 / 重捕 / 回收，均挂在主档下 */
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

    // v3：一只鸟一个主档。
    // - 新增 birds 表（&ringNo 唯一索引）；
    // - rings 由「一次性环号记录」变为「捕获事件」，新增 birdId 索引；
    // - 升级时按环号归组现有事件，同环号自动并入同一条个体链：
    //   最早事件为初捕 → 本地初捕；回收（无本地初捕）→ 外站回收；仅重捕 → 缺初捕档案，主档仍保留。
    // 升级前可在顶栏「导出备份」导出 JSON。
    this.version(3)
      .stores({
        birds: 'id, &ringNo, speciesCn, origin',
        rings: 'id, birdId, ringNo, speciesCn, status, ringDate, siteId, sessionId, [speciesCn+ringDate]',
        morphs: 'id, ringId, measuredAt',
        sites: 'id, siteNo, habitat, name',
        sessions: 'id, sessionNo, date, siteId, closed',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const ringTable = tx.table<RingRecord, string>('rings');
        const birdTable = tx.table<BirdProfile, string>('birds');
        const allRings = await ringTable.toArray();

        // 环号（忽略大小写）→ 同链全部事件
        const groups = new Map<string, RingRecord[]>();
        allRings.forEach((row) => {
          if (typeof row.colorRing !== 'string') row.colorRing = '无';
          const key = normalizeRingNo(row.ringNo);
          const list = groups.get(key) ?? [];
          list.push(row);
          groups.set(key, list);
        });

        const birdsToPut: BirdProfile[] = [];
        groups.forEach((events) => {
          const bird = buildBirdFromEvents(events);
          birdsToPut.push(bird);
          events.forEach((event) => {
            event.birdId = bird.id;
          });
        });

        await birdTable.bulkPut(birdsToPut);
        await ringTable.bulkPut(allRings);
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
