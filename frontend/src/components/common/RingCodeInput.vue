<script setup lang="ts">
import { computed } from 'vue';
import { COLOR_RING_PRESETS, RING_PREFIXES } from '../../types/ring-record';
import type { Bird } from '../../types/bird';

const props = withDefaults(
  defineProps<{
    ringNo: string;
    colorRing: string;
    /** create：登记新事件（命中主档时续录到同一主档）；edit：编辑既有事件 */
    mode?: 'create' | 'edit';
    /** 环号命中的既有个体主档 */
    matchedBird?: Bird;
  }>(),
  { mode: 'create', matchedBird: undefined },
);

const emit = defineEmits<{
  (e: 'update:ringNo', value: string): void;
  (e: 'update:colorRing', value: string): void;
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
      v-if="mode === 'create' && matchedBird"
      class="ring-alert"
      type="success"
      show-icon
      :closable="false"
      :title="`环号 ${ringNo} 已有个体主档（${matchedBird.speciesCn} · 已记录 ${matchedBird.eventCount} 次捕获）`"
      description="本次保存会作为新的捕获事件（重捕 / 回收）续录到同一只鸟的主档下，不会另建档案；站外回收没有本地初捕时也可直接建档。"
    />
    <el-alert
      v-else-if="mode === 'create'"
      class="ring-alert"
      type="info"
      show-icon
      :closable="false"
      title="该环号首次出现，保存时将建立个体主档"
      description="初捕、仅重捕或站外回收都可以建档；之后同环号的捕获事件都会挂到这一条个体链。"
    />
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
