<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import RingCodeInput from '../components/common/RingCodeInput.vue';
import SpeciesPicker from '../components/common/SpeciesPicker.vue';
import { useRingStore } from '../stores/ringStore';
import { useSiteStore } from '../stores/siteStore';
import { useSessionStore } from '../stores/sessionStore';
import { useMeasureStore } from '../stores/measureStore';
import {
  BIRD_AGES,
  ORIGIN_COLOR,
  ORIGIN_HINT,
  RING_STATUSES,
  STATUS_COLOR,
  type BirdAge,
  type BirdProfile,
  type RingRecord,
  type RingStatus,
} from '../types/ring-record';
import { formatDate } from '../utils/format';
import { speciesCount } from '../utils/stats';

const route = useRoute();
const ringStore = useRingStore();
const siteStore = useSiteStore();
const sessionStore = useSessionStore();
const measureStore = useMeasureStore();

const dialogVisible = ref(false);
const editingId = ref('');
const formRef = ref<FormInstance>();
/** 个体档案弹窗 */
const profileVisible = ref(false);
const profileBirdId = ref('');

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
const sessionParam = computed(() => (typeof route.query.session === 'string' ? route.query.session : ''));
const sessionSelectParam = computed(() => (typeof route.query.sessionSelect === 'string' ? route.query.sessionSelect : ''));

const visible = computed(() => {
  const kw = kwParam.value.trim().toLowerCase();
  return ringStore.rings.filter((record) => {
    if (speciesParam.value && record.speciesCn !== speciesParam.value) return false;
    if (statusParam.value && record.status !== statusParam.value) return false;
    if (sessionSelectParam.value && record.sessionId !== sessionSelectParam.value) return false;
    if (kw) {
      const haystack = `${record.ringNo} ${record.colorRing} ${record.speciesCn} ${record.speciesSci} ${record.ringer} ${record.netNo}`.toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
});

/** 编辑中的事件 */
const editingRecord = computed(() => ringStore.rings.find((record) => record.id === editingId.value));
/** 表单环号当前命中的主档（编辑自身环号时排除自身主档，避免误提示） */
const matchedBird = computed<BirdProfile | undefined>(() => {
  const bird = ringStore.birdByRingNo(form.value.ringNo);
  if (!bird) return undefined;
  if (editingId.value && bird.id === editingRecord.value?.birdId) return undefined;
  return bird;
});
/** 编辑事件所属主档（弹窗内提示改名 / 改鸟种会影响同链） */
const editingBird = computed(() => (editingRecord.value ? ringStore.birdById(editingRecord.value.birdId) : undefined));

const entityOptions = computed(() => speciesCount(ringStore.rings).map((item) => item.speciesCn));

/** 续录时环号命中主档：鸟种以主档为准，并把状态从初捕切到重捕 */
watch(matchedBird, (bird) => {
  if (!bird || editingId.value) return;
  form.value.speciesCn = bird.speciesCn;
  form.value.speciesSci = bird.speciesSci;
  if (form.value.status === '初捕') form.value.status = '重捕';
});

function openCreate(prefill?: { ringNo: string; colorRing: string }) {
  editingId.value = '';
  formRef.value?.clearValidate();
  form.value = emptyForm();
  if (prefill) {
    form.value.ringNo = prefill.ringNo;
    form.value.colorRing = prefill.colorRing;
  }
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
  dialogVisible.value = true;
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  const bird = matchedBird.value;
  const payload = {
    ringNo: form.value.ringNo,
    colorRing: form.value.colorRing,
    // 续录到已有主档时，鸟种以主档为准（一只鸟一种）
    speciesCn: bird ? bird.speciesCn : form.value.speciesCn,
    speciesSci: bird ? bird.speciesSci : form.value.speciesSci,
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
    await ringStore.updateRing(editingId.value, payload);
    ElMessage.success(`已更新捕获事件 ${payload.ringNo}（${payload.status}）`);
  } else {
    const result = await ringStore.addRing(payload);
    ElMessage.success(
      result.created
        ? `已为 ${payload.ringNo} 建立个体档案，登记${payload.status}事件`
        : `已在 ${payload.ringNo} 个体档案下续录${payload.status}事件`,
    );
  }
  dialogVisible.value = false;
  if (profileVisible.value && !editingId.value && bird) {
    profileBirdId.value = bird.id;
  }
}

const profileBird = computed(() => ringStore.birdById(profileBirdId.value));
const profileEvents = computed(() => (profileBird.value ? ringStore.eventsOfBird(profileBird.value.id) : []));

function morphCountOf(eventId: string): number {
  return measureStore.morphsOf(eventId).length;
}

function sessionNoOf(sessionId: string): string {
  return sessionStore.sessions.find((session) => session.id === sessionId)?.sessionNo ?? '—';
}

function openProfile(birdId: string) {
  profileBirdId.value = birdId;
  profileVisible.value = true;
}

function openProfileByEvent(record: RingRecord) {
  openProfile(record.birdId);
}

/** 档案内续录：带环号 / 彩环打开登记窗 */
function continueEntry(bird: BirdProfile) {
  profileVisible.value = false;
  openCreate({ ringNo: bird.ringNo, colorRing: bird.colorRing });
}

function editFromProfile(record: RingRecord) {
  profileVisible.value = false;
  openEdit(record);
}

async function remove(record: RingRecord) {
  const chainSize = ringStore.eventsOfBird(record.birdId).length;
  const morphCount = morphCountOf(record.id);
  const confirmed = await ElMessageBox.confirm(
    `确认删除 ${record.ringNo} 在 ${formatDate(record.ringDate)} 的${record.status}事件？` +
      `个体主档${chainSize > 1 ? `与其余 ${chainSize - 1} 次捕获事件` : ''}会完整保留。` +
      (morphCount ? `该事件下的 ${morphCount} 条量度将一并删除。` : ''),
    '删除捕获事件',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await ringStore.removeRing(record.id);
  ElMessage.success('已删除该捕获事件，个体档案保留');
}

/** 列表行用：环号对应主档 */
function birdOfEvent(record: RingRecord): BirdProfile | undefined {
  return ringStore.birdById(record.birdId);
}
</script>

<template>
  <div>
    <h2 class="page-title">环志记录录入与检索</h2>
    <p class="page-desc">
      一只鸟一个个体主档：金属环号首次出现（含外站回收）即建档，重捕 / 回收作为捕获事件续录在同一主档下，各自保留日期、鸟点、批次、量度与备注。
    </p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate()">登记捕获事件</el-button>
      <el-tag type="success" effect="plain">个体主档 {{ ringStore.birds.length }} 条</el-tag>
      <el-tag type="info" effect="plain">捕获事件 {{ ringStore.rings.length }} 条</el-tag>
    </div>

    <FilterBar
      :fields="[
        { key: 'species', label: '鸟种', options: entityOptions, width: 140 },
        { key: 'status', label: '状态', options: [...RING_STATUSES], width: 110 },
        { key: 'sessionSelect', label: '调查批次', options: sessionStore.sessions.map((s) => s.sessionNo), width: 130 },
      ]"
      keyword-placeholder="搜索环号 / 鸟种 / 环志人 / 网号"
      :result-count="visible.length"
      :total-count="ringStore.rings.length"
    />

    <EmptyPanel v-if="visible.length === 0" description="没有符合条件的捕获事件" action-text="登记捕获事件" @action="openCreate()" />

    <el-card v-else shadow="never" class="block">
      <el-table :data="visible" size="small" border>
        <el-table-column label="金属环号" width="130">
          <template #default="scope">
            <el-link type="primary" :underline="false" @click="openProfileByEvent(scope.row)">{{ scope.row.ringNo }}</el-link>
            <el-tag
              v-if="birdOfEvent(scope.row)"
              :type="ORIGIN_COLOR[birdOfEvent(scope.row)!.origin]"
              size="small"
              effect="plain"
              class="origin-tag"
            >
              {{ birdOfEvent(scope.row)!.origin }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="colorRing" label="彩环" width="100" />
        <el-table-column prop="speciesCn" label="鸟种" width="110" />
        <el-table-column prop="speciesSci" label="学名" min-width="170" show-overflow-tooltip />
        <el-table-column prop="age" label="年龄" width="80" />
        <el-table-column label="捕获日期" width="110">
          <template #default="scope">{{ formatDate(scope.row.ringDate) }}</template>
        </el-table-column>
        <el-table-column prop="netNo" label="网号" width="90" />
        <el-table-column prop="netRound" label="网次" width="70" align="right" />
        <el-table-column label="状态" width="90">
          <template #default="scope">
            <el-tag :type="STATUS_COLOR[scope.row.status as RingStatus]" size="small">{{ scope.row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ringer" label="环志人" width="90" />
        <el-table-column label="鸟点 / 批次" width="170">
          <template #default="scope">
            <div>{{ siteStore.siteName(scope.row.siteId) }}</div>
            <div class="cell-sub">{{ sessionNoOf(scope.row.sessionId) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openProfileByEvent(scope.row)">个体档案</el-button>
            <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
            <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑捕获事件' : '登记捕获事件'" width="760px">
      <RingCodeInput
        v-model:ring-no="form.ringNo"
        v-model:color-ring="form.colorRing"
        :bird="matchedBird"
        :event-count="matchedBird ? ringStore.eventsOfBird(matchedBird.id).length : 0"
        @view-profile="openProfile(matchedBird!.id)"
      />

      <el-alert
        v-if="!editingId && !matchedBird && form.status !== '初捕'"
        class="identity-alert"
        :type="form.status === '回收' ? 'error' : 'warning'"
        show-icon
        :closable="false"
        :title="form.status === '回收' ? '环号无本地初捕：将按「外站回收」建立个体档案' : '环号无初捕记录：将先建立「缺初捕档案」主档'"
        :description="form.status === '回收' ? '自站外回收的个体不需要本地初捕，保存即建档并挂上本次回收事件。' : '保存后先保留主档，后续补到初捕事件仍挂在同一条个体链下。'"
      />
      <el-alert
        v-if="editingId && editingBird"
        class="identity-alert"
        type="info"
        show-icon
        :closable="false"
        title="修改环号或鸟种会同步到个体主档与同链其他捕获事件"
      />

      <el-divider content-position="left">鸟种与捕获信息</el-divider>

      <SpeciesPicker v-model:species-cn="form.speciesCn" v-model:species-sci="form.speciesSci" :disabled="!!matchedBird" />

      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" class="ring-form">
        <el-form-item label="金属环号" prop="ringNo">
          <el-input v-model="form.ringNo" placeholder="如：A-10231" maxlength="20" />
        </el-form-item>
        <el-form-item label="鸟种中文名" prop="speciesCn">
          <el-input v-model="form.speciesCn" placeholder="与上方鸟种选择一致" maxlength="30" :disabled="!!matchedBird" />
        </el-form-item>
        <el-form-item label="学名">
          <el-input v-model="form.speciesSci" maxlength="60" :disabled="!!matchedBird" />
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

    <el-dialog v-model="profileVisible" :title="`个体档案 · ${profileBird?.ringNo ?? ''}`" width="860px">
      <template v-if="profileBird">
        <el-descriptions :column="3" border size="small" class="profile-desc">
          <el-descriptions-item label="金属环号">{{ profileBird.ringNo }}</el-descriptions-item>
          <el-descriptions-item label="彩环">{{ profileBird.colorRing }}</el-descriptions-item>
          <el-descriptions-item label="个体来源">
            <el-tag :type="ORIGIN_COLOR[profileBird.origin]" size="small">{{ profileBird.origin }}</el-tag>
            <span class="cell-sub">{{ ORIGIN_HINT[profileBird.origin] }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="鸟种">{{ profileBird.speciesCn }}</el-descriptions-item>
          <el-descriptions-item label="学名" :span="2">{{ profileBird.speciesSci }}</el-descriptions-item>
        </el-descriptions>

        <div class="profile-head">
          <span>捕获事件（{{ profileEvents.length }} 次，日期 / 鸟点 / 批次 / 量度 / 备注各自独立保留）</span>
          <el-button type="primary" size="small" @click="continueEntry(profileBird)">续录重捕 / 回收</el-button>
        </div>

        <el-table :data="profileEvents" size="small" border>
          <el-table-column label="捕获日期" width="110">
            <template #default="scope">{{ formatDate(scope.row.ringDate) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="80">
            <template #default="scope">
              <el-tag :type="STATUS_COLOR[scope.row.status as RingStatus]" size="small">{{ scope.row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="鸟点" width="130">
            <template #default="scope">{{ siteStore.siteName(scope.row.siteId) }}</template>
          </el-table-column>
          <el-table-column label="批次" width="110">
            <template #default="scope">{{ sessionNoOf(scope.row.sessionId) }}</template>
          </el-table-column>
          <el-table-column prop="netNo" label="网号 / 网次" width="110">
            <template #default="scope">{{ scope.row.netNo }} · {{ scope.row.netRound }}</template>
          </el-table-column>
          <el-table-column prop="ringer" label="环志人" width="80" />
          <el-table-column label="量度" width="70" align="right">
            <template #default="scope">{{ morphCountOf(scope.row.id) }} 条</template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="editFromProfile(scope.row)">编辑</el-button>
              <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <template #footer>
        <el-button @click="profileVisible = false">关闭</el-button>
        <el-button v-if="profileBird" type="primary" @click="continueEntry(profileBird)">续录捕获事件</el-button>
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
.origin-tag {
  margin-left: 6px;
}
.cell-sub {
  font-size: 12px;
  color: #8a99a5;
}
.identity-alert {
  margin-top: 8px;
}
.profile-desc {
  margin-bottom: 12px;
}
.profile-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 4px 0 8px;
  font-size: 13px;
  color: #2f4a44;
}
</style>
