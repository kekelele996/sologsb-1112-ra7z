/**
 * 临时迁移验证脚本：v2 库（旧结构、同环号多条记录）打开后自动升级到 v3，
 * 校验：同环号归同主档、外站回收可建档、缺初捕重捕保留主档、删事件不删主档。
 * 用 `npx tsx scripts/verify-migration.ts` 运行。
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

// ---- 1. 先按 v2 schema 造旧库 ----
class V2DB extends Dexie {
  rings!: any;
  birds!: any;
  constructor() {
    super('gbbirdring-db');
    this.version(1).stores({
      rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId',
      morphs: 'id, ringId, measuredAt',
      sites: 'id, siteNo, habitat, name',
      sessions: 'id, sessionNo, date, siteId, closed',
      meta: 'key',
    });
    this.version(2)
      .stores({
        rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId, [speciesCn+ringDate]',
        morphs: 'id, ringId, measuredAt',
        sites: 'id, siteNo, habitat, name',
        sessions: 'id, sessionNo, date, siteId, closed',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx.table('rings').toCollection().modify((row: any) => {
          if (typeof row.colorRing !== 'string') row.colorRing = '无';
        });
      });
  }
}

const old = new V2DB();
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const legacyRings = [
  { id: 'r1', ringNo: 'A-10231', colorRing: '红-黄', speciesCn: '红喉歌鸲', speciesSci: 'Calliope calliope', age: '成', ringDate: day(21), netNo: '3 号网', netRound: 2, status: '初捕', ringer: '韩雪', siteId: 's1', sessionId: 'b1' },
  { id: 'r2', ringNo: 'A-10231', colorRing: '红-黄', speciesCn: '红喉歌鸲', speciesSci: 'Calliope calliope', age: '成', ringDate: day(7), netNo: '6 号网', netRound: 5, status: '重捕', ringer: '郑海', siteId: 's3', sessionId: 'b3', remark: '跨点重捕' },
  { id: 'r3', ringNo: 'A-10231', colorRing: '红-黄', speciesCn: '红喉歌鸲', speciesSci: 'Calliope calliope', age: '成', ringDate: day(2), netNo: '6 号网', netRound: 2, status: '重捕', ringer: '郑海', siteId: 's1', sessionId: 'b4' },
  { id: 'r4', ringNo: 'A-10099', colorRing: '无', speciesCn: '红喉歌鸲', speciesSci: 'Calliope calliope', age: '成', ringDate: day(2), netNo: '3 号网', netRound: 3, status: '回收', ringer: '郑海', siteId: 's1', sessionId: 'b4' },
  { id: 'r5', ringNo: 'B-20599', colorRing: '无', speciesCn: '黄眉柳莺', speciesSci: 'Phylloscopus inornatus', age: '成', ringDate: day(3), netNo: '5 号网', netRound: 1, status: '重捕', ringer: '韩雪', siteId: 's1', sessionId: 'b4' },
  { id: 'r6', ringNo: 'a-10231', colorRing: '红-黄', speciesCn: '红喉歌鸲', speciesSci: 'Calliope calliope', age: '成', ringDate: day(1), netNo: '1 号网', netRound: 1, status: '重捕', ringer: '韩雪', siteId: 's1', sessionId: 'b4' },
];
const legacyMorphs = [
  { id: 'm1', ringId: 'r1', billLength: 14.2, billWidth: 4.1, wingLength: 74.5, tailLength: 58.2, tarsusLength: 23.4, weight: 23.6, fatScore: 2, measuredBy: '韩雪', measuredAt: day(21) },
  { id: 'm2', ringId: 'r2', billLength: 14.0, billWidth: 4.0, wingLength: 74.0, tailLength: 58.0, tarsusLength: 23.0, weight: 23.0, fatScore: 2, measuredBy: '郑海', measuredAt: day(7) },
];
await old.rings.bulkPut(legacyRings);
await old.morphs.bulkPut(legacyMorphs);
await old.close();

// ---- 2. 用应用当前 db（含 v3 迁移）打开同一库 ----
process.env.VITE_AMAP_KEY = '';
const { db } = await import('../src/utils/db.ts');

const birds = await db.birds.orderBy('ringNo').toArray();
const rings = await db.rings.toArray();

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('❌', msg);
    process.exitCode = 1;
  } else {
    console.log('✅', msg);
  }
}

assert(birds.length === 3, `应建 3 条主档（A-10231 合并大小写 4 事件 / A-10099 回收 / B-20599 重捕），实际 ${birds.length}`);

const chainBird = birds.find((b: any) => b.ringNo.toLowerCase() === 'a-10231')!;
assert(!!chainBird, 'A-10231 主档存在');
assert(chainBird.origin === '本地初捕', `A-10231 来源应为本地初捕，实际 ${chainBird?.origin}`);
const chainEvents = rings.filter((r: any) => r.birdId === chainBird.id);
assert(chainEvents.length === 4, `A-10231 链下应有 4 个事件（含小写 a-10231），实际 ${chainEvents.length}`);
assert(chainEvents.every((r: any) => r.ringNo === chainBird.ringNo || r.ringNo.toLowerCase() === 'a-10231'), '事件环号保留原值');
assert(chainEvents.every((r: any) => r.speciesCn === '红喉歌鸲'), '同链鸟种一致');

const recoveryBird = birds.find((b: any) => b.ringNo === 'A-10099')!;
assert(recoveryBird?.origin === '外站回收', `无本地初捕的回收应建档且来源为外站回收，实际 ${recoveryBird?.origin}`);
assert(rings.filter((r: any) => r.birdId === recoveryBird.id).length === 1, '外站回收主档下 1 个回收事件');

const orphanBird = birds.find((b: any) => b.ringNo === 'B-20599')!;
assert(orphanBird?.origin === '缺初捕档案', `仅有重捕的应建缺初捕档案主档，实际 ${orphanBird?.origin}`);

// 事件按日期升序归主档身份：A-10231 主档 createdAt 为最早事件（r1）日期
const earliestEvent = rings.filter((r: any) => r.birdId === chainBird.id).sort((a: any, b: any) => a.ringDate.localeCompare(b.ringDate))[0];
assert(chainBird.createdAt === earliestEvent.ringDate, '主档 createdAt 取最早事件日期');

// ---- 3. 删除一条事件：主档与其余事件、量度保留 / 该事件量度级联 ----
await db.transaction('rw', db.rings, db.morphs, async () => {
  const morphIds = (await db.morphs.where('ringId').equals('r2').primaryKeys()) as string[];
  await db.rings.delete('r2');
  await db.morphs.bulkDelete(morphIds);
});
assert((await db.birds.where('ringNo').equals('A-10231').count()) === 1, '删除重捕事件后主档仍在');
assert((await db.rings.where('birdId').equals(chainBird.id).count()) === 3, '同链其余 3 个事件保留');
assert((await db.morphs.where('ringId').equals('r1').count()) === 1, '其他事件量度保留');
assert((await db.morphs.where('ringId').equals('r2').count()) === 0, '被删事件量度级联删除');

// ---- 4. 删光主档下事件：有历史的主档仍保留 ----
const ids = (await db.rings.where('birdId').equals(recoveryBird.id).primaryKeys()) as string[];
await db.rings.bulkDelete(ids);
assert((await db.birds.get(recoveryBird.id)) !== undefined, '主档下事件全部删除后，主档仍保留');

console.log('\n迁移后鸟种 / 个体 / 批次口径校验：');
const sessionB4 = rings.filter((r: any) => r.sessionId === 'b4');
assert(new Set(sessionB4.map((r: any) => r.speciesCn)).size === 2, 'b4 批次鸟种数按事件计为 2');
assert(new Set(sessionB4.map((r: any) => r.ringNo.toLowerCase())).size === 3, `b4 批次个体数去重为 3，实际 ${new Set(sessionB4.map((r: any) => r.ringNo.toLowerCase())).size}`);
assert(sessionB4.length === 4, `b4 批次捕获事件数为 4（含 A-10231 两次），实际 ${sessionB4.length}`);

await db.close();
console.log(process.exitCode ? '\n有断言失败' : '\n全部通过');
