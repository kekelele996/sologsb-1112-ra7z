/**
 * store 层个体链行为验证：
 * 建档 / 同环续录 / 外站回收建档 / 缺初捕重捕建档 / 删事件保留主档与同链事件。
 * 运行：npx tsx scripts/verify-store.ts
 */
import 'fake-indexeddb/auto';
import { setActivePinia, createPinia } from 'pinia';

setActivePinia(createPinia());

const { db } = await import('../src/utils/db.ts');
const { useRingStore } = await import('../src/stores/ringStore.ts');
const { useMeasureStore } = await import('../src/stores/measureStore.ts');

const ringStore = useRingStore();
const measureStore = useMeasureStore();
await ringStore.hydrate();
await measureStore.hydrate();

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('❌', msg);
    process.exitCode = 1;
  } else {
    console.log('✅', msg);
  }
}

const base = {
  colorRing: '无',
  speciesCn: '红喉歌鸲',
  speciesSci: 'Calliope calliope',
  age: '成' as const,
  netNo: '3 号网',
  netRound: 1,
  ringer: '韩雪',
  siteId: 'site-001',
  sessionId: 'session-001',
};

// 1. 环号首次出现（初捕）建档
const first = await ringStore.addRing({ ...base, ringNo: 'A-20001', status: '初捕', ringDate: new Date('2026-09-01T08:00:00Z').toISOString() });
assert(first.created === true && first.bird.origin === '本地初捕', '首次初捕建立本地初捕主档');
assert(ringStore.birds.length === 1, '主档数为 1');

// 2. 同环号续录重捕：不新建主档，挂同链
const second = await ringStore.addRing({
  ...base,
  ringNo: 'a-20001', // 大小写不同仍视为同一只
  status: '重捕',
  ringDate: new Date('2026-09-10T08:00:00Z').toISOString(),
  siteId: 'site-003',
  sessionId: 'session-003',
  remark: '跨点重捕',
});
assert(second.created === false && second.bird.id === first.bird.id, '同环号（忽略大小写）续录不新建主档');
assert(ringStore.eventsOfBird(first.bird.id).length === 2, '主档下 2 个捕获事件');
assert(second.record.speciesCn === '红喉歌鸲', '续录事件鸟种沿用主档');
assert(second.record.siteId === 'site-003' && second.record.sessionId === 'session-003', '续录事件保留各自鸟点 / 批次');
assert(second.record.remark === '跨点重捕', '续录事件保留各自备注');

// 3. 新环号直接回收（无本地初捕）→ 外站回收建档
const recovery = await ringStore.addRing({ ...base, ringNo: 'X-90001', status: '回收', ringDate: new Date('2026-09-12T08:00:00Z').toISOString() });
assert(recovery.created === true && recovery.bird.origin === '外站回收', '外站回收无本地初捕也能建档');

// 4. 新环号直接重捕 → 缺初捕档案，主档先保留
const orphan = await ringStore.addRing({ ...base, ringNo: 'X-90002', status: '重捕', ringDate: new Date('2026-09-13T08:00:00Z').toISOString() });
assert(orphan.created === true && orphan.bird.origin === '缺初捕档案', '仅重捕时建立缺初捕档案主档');

// 5. 量度挂事件：两次事件各自量度
await measureStore.addMorph({ ringId: first.record.id, billLength: 14, billWidth: 4, wingLength: 74, tailLength: 58, tarsusLength: 23, weight: 23, fatScore: 2, measuredBy: '韩雪', measuredAt: new Date('2026-09-01T09:00:00Z').toISOString() });
await measureStore.addMorph({ ringId: second.record.id, billLength: 13.8, billWidth: 4, wingLength: 73.5, tailLength: 57.5, tarsusLength: 22.8, weight: 22.6, fatScore: 2, measuredBy: '郑海', measuredAt: new Date('2026-09-10T09:00:00Z').toISOString() });
assert(measureStore.morphsOf(first.record.id).length === 1 && measureStore.morphsOf(second.record.id).length === 1, '量度分别挂在两次捕获事件上');

// 6. 误删一次捕获事件：主档与另一事件保留；被删事件量度级联，另一事件量度保留
await ringStore.removeRing(second.record.id);
assert(ringStore.birdById(first.bird.id) !== undefined, '删除捕获事件后主档完整保留');
assert(ringStore.eventsOfBird(first.bird.id).length === 1, '同链其他事件保留');
assert(measureStore.morphsOf(first.record.id).length === 1, '其他事件量度保留');
assert(measureStore.morphsOf(second.record.id).length === 0, '被删事件量度级联删除');

// 7. 删光主档下全部事件，主档仍保留（有历史的主档先保留）
await ringStore.removeRing(first.record.id);
assert(ringStore.birdById(first.bird.id) !== undefined, '主档下事件全部删除后，主档仍保留');

// 8. 批次口径：按事件计鸟种 / 捕获数，同环号去重计个体
await ringStore.addRing({ ...base, ringNo: 'D-40001', status: '初捕', ringDate: new Date('2026-09-05T08:00:00Z').toISOString(), siteId: 'site-003', sessionId: 'session-003' });
await ringStore.addRing({ ...base, ringNo: 'D-40001', status: '重捕', ringDate: new Date('2026-09-06T08:00:00Z').toISOString(), siteId: 'site-003', sessionId: 'session-003' });
const b3 = ringStore.rings.filter((r) => r.sessionId === 'session-003');
assert(b3.length === 2, `批次按事件计捕获数为 2，实际 ${b3.length}`);
assert(new Set(b3.map((r) => r.speciesCn)).size === 1, '批次按事件计鸟种数为 1');
assert(new Set(b3.map((r) => r.ringNo.toLowerCase())).size === 1, '同一只鸟在批次内只计一个个体');

await db.close();
console.log(process.exitCode ? '\n有断言失败' : '\n全部通过');
