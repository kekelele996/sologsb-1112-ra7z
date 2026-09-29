<script setup lang="ts">
import { computed } from 'vue';
import { COLOR_RING_PRESETS, ORIGIN_HINT, RING_PREFIXES, type BirdProfile } from '../../types/ring-record';

const props = withDefaults(
  defineProps<{
    ringNo: string;
    colorRing: string;
    /** 环号已命中的个体主档（续录重捕 / 回收） */
    bird?: BirdProfile;
    /** 该主档下已有捕获事件数 */
    eventCount?: number;
  }>(),
  { bird: undefined, eventCount: 0 },
);

const emit = defineEmits<{
  (e: 'update:ringNo', value: string): void;
  (e: 'update:colorRing', value: string): void;
  (e: 'view-profile', birdId: string): void;
}>();

const prefix = computed(() => {
  const [head] = props.ringNo.split('-');
  return RING_PREFIXES.includes(head) ? head : RING_PREFIXES[0];
});

const serial = computed(() => {
  const parts = props.ringNo.split('-');
  return parts.length > 1 ? parts.slice(1).join('-') : '';
});

function compose(nextPrefix: string, nextSerial: string) {
  const clean = nextSerial.replace(/[^0-9A-Za-z]/g, '');
  emit('update:ringNo', clean ? `${nextPrefix}-${clean}` : nextPrefix);
}
</script>

<template>
  <div class="ring-code">
    <div class="ring-row">
      <span class="ring-label">金属环号</span>
      <el-select :model-value="prefix" style="width: 90px" @change="(value: string) => compose(value, serial)">
        <el-option v-for="item in RING_PREFIXES" :key="item" :label="item" :value="item" />
      </el-select>
      <el-input
        :model-value="serial"
        placeholder="环号序号，如 10231"
        maxlength="10"
        style="width: 180px"
        @update:model-value="(value: string) => compose(prefix, value)"
      />
      <span class="ring-preview">完整环号：{{ ringNo || '—' }}</span>
    </div>
    <div class="ring-row">
      <span class="ring-label">彩环组合</span>
      <el-select
        :model-value="colorRing"
        filterable
        allow-create
        default-first-option
        placeholder="选择或输入彩环组合"
        style="width: 220px"
        @update:model-value="(value: string) => emit('update:colorRing', value || '无')"
      >
        <el-option v-for="item in COLOR_RING_PRESETS" :key="item" :label="item" :value="item" />
      </el-select>
      <span class="ring-hint">彩环用于野外远距离识别，可与金属环号组合使用</span>
    </div>
    <el-alert
      v-if="bird"
      class="ring-alert"
      type="success"
      show-icon
      :closable="false"
      :title="`环号 ${ringNo} 已有个体档案（${bird.speciesCn} · ${bird.origin} · 已录 ${eventCount} 次捕获事件）`"
      :description="`${ORIGIN_HINT[bird.origin]}。保存后本次「重捕 / 回收」将作为新事件挂在同一主档下，鸟种沿用主档。`"
    >
      <template #default>
        <el-button link type="primary" @click="emit('view-profile', bird.id)">查看个体档案与全部捕获事件</el-button>
      </template>
    </el-alert>
  </div>
</template>

<style scoped>
.ring-code {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ring-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ring-label {
  width: 80px;
  font-size: 13px;
  color: #2f4a44;
}
.ring-preview {
  font-size: 12px;
  color: #2f7d6f;
}
.ring-hint {
  font-size: 12px;
  color: #8a99a5;
}
.ring-alert {
  margin-top: 4px;
}
</style>
