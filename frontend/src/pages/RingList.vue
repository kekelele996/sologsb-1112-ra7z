<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import RingCodeInput from '../components/common/RingCodeInput.vue';
import SpeciesPicker from '../components/common/SpeciesPicker.vue';
import { useBirdStore } from '../stores/birdStore';
import { useRingStore } from '../stores/ringStore';
import { useSiteStore } from '../stores/siteStore';
import { useSessionStore } from '../stores/sessionStore';
import { useMeasureStore } from '../stores/measureStore';
import { BIRD_AGES, RING_STATUSES, STATUS_COLOR, type BirdAge, type RingRecord, type RingStatus } from '../types/ring-record';
import type { Bird } from '../types/bird';
import { formatDate } from '../utils/format';
import { speciesCount } from '../utils/stats';

const route = useRoute();
const router = useRouter();
const birdStore = useBirdStore();
const ringStore = useRingStore();
const siteStore = useSiteStore();
const sessionStore = useSessionStore();
const measureStore = useMeasureStore();

const dialogVisible = ref(false);
const editingId = ref('');
const formRef = ref<FormInstance>();
const detailId = ref('');

interface RingForm {
  ringNo: string;
  colorRing: string;
  speciesCn: string;
  speciesSci: string;
  age: BirdAge;
  ringDate: string;
  netNo: string;
  netRound: number;
  status: RingStatus;
  ringer: string;
  siteId: string;
  sessionId: string;
  remark: string;
}

const emptyForm = (): RingForm => ({
  ringNo: 'A-',
  colorRing: '无',
  speciesCn: '红喉歌鸲',
  speciesSci: 'Calliope calliope',
  age: '成',
  ringDate: new Date().toISOString().slice(0, 10),
  netNo: '1 号网',
  netRound: 1,
  status: '初捕',
  ringer: '韩雪',
  siteId: siteStore.sites[0]?.id ?? '',
  sessionId: sessionStore.sessions[0]?.id ?? '',
  remark: '',
});

const form = ref<RingForm>(emptyForm());

const rules: FormRules = {
  ringNo: [{ required: true, message: '请输入金属环号', trigger: 'blur' }],
  speciesCn: [{ required: true, message: '请选择或输入鸟种中文名', trigger: 'change' }],
  ringer: [{ required: true, message: '请输入环志人', trigger: 'blur' }],
};

const kwParam = computed(() => (typeof route.query.kw === 'string' ? route.query.kw : ''));
const speciesParam = computed(() => (typeof route.query.species === 'string' ? route.query.species : ''));
const statusParam = computed(() => (typeof route.query.status === 'string' ? route.query.status : ''));
const sessionParam = computed(() => (typeof route.query.sessionSelect === 'string' ? route.query.sessionSelect : ''));

interface BirdRow {
  bird: Bird;
  events: RingRecord[];
  last: RingRecord | undefined;
  statuses: RingStatus[];
  measuredCount: number;
}

/** 主档列表：一只鸟一行，捕获事件折叠在主档下 */
const rows = computed<BirdRow[]>(() => {
  const kw = kwParam.value.trim().toLowerCase();
  return birdStore.birds
    .map((bird) => {
      const events = ringStore.eventsOfBird(bird.id);
      const last = events[events.length - 1];
      return {
        bird,
        events,
        last,
        statuses: events.map((event) => event.status),
        measuredCount: events.filter((event) => measureStore.morphsOf(event.id).length > 0).length,
      };
    })
    .filter((row) => {
      if (speciesParam.value && row.bird.speciesCn !== speciesParam.value) return false;
      if (statusParam.value && !row.statuses.includes(statusParam.value as RingStatus)) return false;
      if (sessionParam.value && !row.events.some((event) => event.sessionId === sessionParam.value)) return false;
      if (kw) {
        const eventText = row.events
          .map((event) => `${event.ringer} ${event.netNo} ${event.remark ?? ''}`)
          .join(' ')
          .toLowerCase();
        const haystack =
          `${row.bird.ringNo} ${row.bird.colorRing} ${row.bird.speciesCn} ${row.bird.speciesSci} ${eventText}`.toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    })
    .sort((a, b) => b.bird.lastDate.localeCompare(a.bird.lastDate));
});

const entityOptions = computed(() => speciesCount(ringStore.rings, birdStore.birds).map((item) => item.speciesCn));
const totalEvents = computed(() => ringStore.rings.length);

/** 表单环号命中的既有主档（编辑自身时排除） */
const matchedBird = computed(() => {
  const found = birdStore.findByRingNo(form.value.ringNo);
  if (!found) return undefined;
  if (editingId.value) {
    const self = ringStore.rings.find((record) => record.id === editingId.value);
    if (self && found.id === self.birdId) return undefined;
  }
  return found;
});

function openCreate() {
  editingId.value = '';
  form.value = emptyForm();
  formRef.value?.clearValidate();
  dialogVisible.value = true;
}

/** 在既有个体主档下续录一次捕获（重捕 / 回收） */
function openContinue(bird: Bird) {
  editingId.value = '';
  form.value = {
    ...emptyForm(),
    ringNo: bird.ringNo,
    colorRing: bird.colorRing,
    speciesCn: bird.speciesCn,
    speciesSci: bird.speciesSci,
    age: bird.age,
    status: '重捕',
  };
  formRef.value?.clearValidate();
  dialogVisible.value = true;
}

function openEdit(record: RingRecord) {
  editingId.value = record.id;
  form.value = {
    ringNo: record.ringNo,
    colorRing: record.colorRing,
    speciesCn: record.speciesCn,
    speciesSci: record.speciesSci,
    age: record.age,
    ringDate: record.ringDate.slice(0, 10),
    netNo: record.netNo,
    netRound: record.netRound,
    status: record.status,
    ringer: record.ringer,
    siteId: record.siteId,
    sessionId: record.sessionId,
    remark: record.remark ?? '',
  };
  formRef.value?.clearValidate();
  dialogVisible.value = true;
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  const payload = {
    ringNo: form.value.ringNo,
    colorRing: form.value.colorRing,
    speciesCn: form.value.speciesCn,
    speciesSci: form.value.speciesSci,
    age: form.value.age,
    ringDate: new Date(`${form.value.ringDate}T08:00:00`).toISOString(),
    netNo: form.value.netNo,
    netRound: Number(form.value.netRound) || 1,
    status: form.value.status,
    ringer: form.value.ringer,
    siteId: form.value.siteId,
    sessionId: form.value.sessionId,
    remark: form.value.remark,
  };
  if (editingId.value) {
    await ringStore.updateEvent(editingId.value, payload);
    ElMessage.success(`已更新捕获事件 ${payload.ringNo}`);
  } else {
    const { created, birdId } = await ringStore.addEvent(payload);
    if (created) {
      ElMessage.success(`已建立个体主档 ${payload.ringNo}（${payload.speciesCn}），并登记${payload.status}事件`);
    } else {
      ElMessage.success(`已在 ${payload.ringNo} 的个体主档下续录${payload.status}事件`);
    }
    detailId.value = birdId;
  }
  dialogVisible.value = false;
}

async function removeEvent(record: RingRecord) {
  const confirmed = await ElMessageBox.confirm(
    `确认删除 ${record.ringNo}（${record.speciesCn}）于 ${formatDate(record.ringDate)} 的${record.status}事件？\n个体主档与其他捕获事件会完整保留，该事件的量度记录将一并删除。`,
    '删除捕获事件',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await ringStore.removeEvent(record.id);
  ElMessage.success('已删除该捕获事件，个体主档与其他事件保留');
}

/** 主档仅在没有任何捕获事件（空主档）时允许删除，有历史的主档受保护 */
async function removeEmptyBird(bird: Bird) {
  if (bird.eventCount > 0) {
    ElMessage.warning('该主档下仍有捕获事件，不能删除；请先删除其全部事件');
    return;
  }
  const confirmed = await ElMessageBox.confirm(`确认删除空主档 ${bird.ringNo}（${bird.speciesCn}）？`, '删除空主档', {
    type: 'warning',
  })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  const ok = await birdStore.removeBird(bird.id);
  if (ok) {
    ElMessage.success('已删除空主档');
    detailId.value = '';
  } else {
    ElMessage.warning('主档仍有历史事件，已保留');
  }
}

function siteNameOf(siteId: string) {
  return siteStore.siteName(siteId);
}
function sessionNoOf(sessionId: string) {
  return sessionStore.byId(sessionId)?.sessionNo ?? '—';
}
function morphCountOf(eventId: string) {
  return measureStore.morphsOf(eventId).length;
}
function goMeasure(eventId: string) {
  void router.push({ path: '/measure', query: { ringId: eventId } });
}

const detailBird = computed(() => birdStore.byId(detailId.value));
const detailEvents = computed(() => (detailId.value ? ringStore.eventsOfBird(detailId.value) : []));
</script>

<template>
  <div>
    <h2 class="page-title">环志个体档案</h2>
    <p class="page-desc">一只鸟一个主档：金属环号首次出现（含站外回收）时建档，后续重捕 / 回收作为捕获事件续录在同一主档下，各自保留日期、鸟点、批次、量度与备注。</p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记捕获事件</el-button>
      <el-tag type="info" effect="plain">个体主档 {{ birdStore.birds.length }} 只 · 捕获事件 {{ totalEvents }} 条</el-tag>
    </div>

    <FilterBar
      :fields="[
        { key: 'species', label: '鸟种', options: entityOptions, width: 140 },
        { key: 'status', label: '事件状态', options: [...RING_STATUSES], width: 120 },
        { key: 'sessionSelect', label: '调查批次', options: sessionStore.sessions.map((s) => s.sessionNo), width: 130 },
      ]"
      keyword-placeholder="搜索环号 / 鸟种 / 环志人 / 网号"
      :result-count="rows.length"
      :total-count="birdStore.birds.length"
    />

    <EmptyPanel v-if="rows.length === 0" description="没有符合条件的个体档案" action-text="登记捕获事件" @action="openCreate" />

    <el-card v-else shadow="never" class="block">
      <el-table :data="rows" size="small" border>
        <el-table-column label="金属环号" width="110">
          <template #default="scope">{{ scope.row.bird.ringNo }}</template>
        </el-table-column>
        <el-table-column label="彩环" width="100">
          <template #default="scope">{{ scope.row.bird.colorRing }}</template>
        </el-table-column>
        <el-table-column label="鸟种" width="110">
          <template #default="scope">{{ scope.row.bird.speciesCn }}</template>
        </el-table-column>
        <el-table-column label="学名" min-width="160" show-overflow-tooltip>
          <template #default="scope">{{ scope.row.bird.speciesSci }}</template>
        </el-table-column>
        <el-table-column label="年龄" width="70">
          <template #default="scope">{{ scope.row.bird.age }}</template>
        </el-table-column>
        <el-table-column label="事件数" width="90" align="right">
          <template #default="scope">
            <el-link type="primary" :underline="false" @click="detailId = scope.row.bird.id">
              {{ scope.row.events.length }} 条
            </el-link>
          </template>
        </el-table-column>
        <el-table-column label="最近捕获" width="110">
          <template #default="scope">
            <span v-if="scope.row.last">{{ formatDate(scope.row.last.ringDate) }}</span>
            <span v-else class="empty-text">无事件</span>
          </template>
        </el-table-column>
        <el-table-column label="最近状态" width="90">
          <template #default="scope">
            <el-tag v-if="scope.row.last" :type="STATUS_COLOR[scope.row.last.status as RingStatus]" size="small">{{ scope.row.last.status }}</el-tag>
            <span v-else class="empty-text">—</span>
          </template>
        </el-table-column>
        <el-table-column label="最近鸟点 / 批次" min-width="170">
          <template #default="scope">
            <template v-if="scope.row.last">
              {{ siteNameOf(scope.row.last.siteId) }} · {{ sessionNoOf(scope.row.last.sessionId) }}
            </template>
            <span v-else class="empty-text">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="detailId = scope.row.bird.id">档案</el-button>
            <el-button link type="warning" @click="openContinue(scope.row.bird)">续录捕获</el-button>
            <el-button
              link
              type="danger"
              :disabled="scope.row.bird.eventCount > 0"
              :title="scope.row.bird.eventCount > 0 ? '有捕获事件的主档受保护，不能直接删除' : '删除空主档'"
              @click="removeEmptyBird(scope.row.bird)"
            >
              删主档
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑捕获事件' : '登记捕获事件'" width="760px">
      <RingCodeInput
        v-model:ring-no="form.ringNo"
        v-model:color-ring="form.colorRing"
        :mode="editingId ? 'edit' : 'create'"
        :matched-bird="matchedBird"
      />

      <el-divider content-position="left">鸟种与环志信息</el-divider>

      <SpeciesPicker v-model:species-cn="form.speciesCn" v-model:species-sci="form.speciesSci" />

      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" class="ring-form">
        <el-form-item label="金属环号" prop="ringNo">
          <el-input v-model="form.ringNo" placeholder="如：A-10231" maxlength="20" />
        </el-form-item>
        <el-form-item label="鸟种中文名" prop="speciesCn">
          <el-input v-model="form.speciesCn" placeholder="与上方鸟种选择一致" maxlength="30" />
        </el-form-item>
        <el-form-item label="学名">
          <el-input v-model="form.speciesSci" maxlength="60" />
        </el-form-item>
        <el-form-item label="年龄">
          <el-select v-model="form.age" style="width: 160px">
            <el-option v-for="age in BIRD_AGES" :key="age" :label="age" :value="age" />
          </el-select>
        </el-form-item>
        <el-form-item label="捕获日期">
          <el-date-picker v-model="form.ringDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="网号">
          <el-input v-model="form.netNo" style="width: 160px" maxlength="20" placeholder="如：3 号网" />
        </el-form-item>
        <el-form-item label="网次">
          <el-input-number v-model="form.netRound" :min="1" :max="20" placeholder="网次" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 160px">
            <el-option v-for="status in RING_STATUSES" :key="status" :label="status" :value="status" />
          </el-select>
        </el-form-item>
        <el-form-item label="环志人" prop="ringer">
          <el-input v-model="form.ringer" style="width: 160px" maxlength="16" placeholder="如：韩雪" />
        </el-form-item>
        <el-form-item label="鸟点">
          <el-select v-model="form.siteId" style="width: 240px">
            <el-option v-for="site in siteStore.sites" :key="site.id" :label="`${site.siteNo} · ${site.name}`" :value="site.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="调查批次">
          <el-select v-model="form.sessionId" style="width: 240px">
            <el-option v-for="session in sessionStore.sessions" :key="session.id" :label="`${session.sessionNo} · ${session.date}`" :value="session.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="80" placeholder="重捕位移、体况等" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog :model-value="!!detailBird" :title="`个体档案 · ${detailBird?.ringNo ?? ''}`" width="860px" @update:model-value="(v: boolean) => !v && (detailId = '')">
      <template v-if="detailBird">
        <el-descriptions :column="3" border size="small" class="detail-head">
          <el-descriptions-item label="金属环号">{{ detailBird.ringNo }}</el-descriptions-item>
          <el-descriptions-item label="彩环">{{ detailBird.colorRing }}</el-descriptions-item>
          <el-descriptions-item label="鸟种">{{ detailBird.speciesCn }}（{{ detailBird.speciesSci }}）</el-descriptions-item>
          <el-descriptions-item label="首次捕获">{{ formatDate(detailBird.firstDate) }}</el-descriptions-item>
          <el-descriptions-item label="最近捕获">{{ formatDate(detailBird.lastDate) }}</el-descriptions-item>
          <el-descriptions-item label="事件数">{{ detailBird.eventCount }} 条</el-descriptions-item>
        </el-descriptions>

        <div class="detail-toolbar">
          <el-button size="small" type="warning" @click="openContinue(detailBird)">续录捕获</el-button>
          <el-button v-if="detailBird.eventCount === 0" size="small" type="danger" @click="removeEmptyBird(detailBird)">删除空主档</el-button>
          <span v-else class="detail-note">有捕获事件的主档受保护；误删事件后主档与其他事件仍完整保留</span>
        </div>

        <el-table :data="detailEvents" size="small" border max-height="360">
          <el-table-column label="日期" width="105">
            <template #default="scope">{{ formatDate(scope.row.ringDate) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="scope">
              <el-tag :type="STATUS_COLOR[scope.row.status as RingStatus]" size="small">{{ scope.row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="netNo" label="网号" width="90" />
          <el-table-column label="鸟点" width="130">
            <template #default="scope">{{ siteNameOf(scope.row.siteId) }}</template>
          </el-table-column>
          <el-table-column label="批次" width="110">
            <template #default="scope">{{ sessionNoOf(scope.row.sessionId) }}</template>
          </el-table-column>
          <el-table-column prop="ringer" label="环志人" width="80" />
          <el-table-column label="量度" width="90">
            <template #default="scope">
              <el-tag v-if="morphCountOf(scope.row.id) > 0" type="success" size="small">{{ morphCountOf(scope.row.id) }} 条</el-tag>
              <el-button v-else link type="primary" size="small" @click="goMeasure(scope.row.id)">去量度</el-button>
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="goMeasure(scope.row.id)">量度</el-button>
              <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
              <el-button link type="danger" @click="removeEvent(scope.row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <template #footer>
        <el-button @click="detailId = ''">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #1f4a44;
}
.page-desc {
  margin: 0 0 12px;
  color: #6f8480;
  font-size: 13px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.block {
  border-radius: 8px;
}
.ring-form {
  margin-top: 10px;
}
.empty-text {
  color: #a8b5b1;
}
.detail-head {
  margin-bottom: 10px;
}
.detail-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
}
.detail-note {
  font-size: 12px;
  color: #8a99a5;
}
</style>
