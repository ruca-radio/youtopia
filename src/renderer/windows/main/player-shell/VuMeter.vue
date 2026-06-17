<script setup lang="ts">
defineProps<{
  enabled: boolean;
  variant?: "compact" | "expanded" | "console";
}>();

const levels = [34, 58, 82, 66, 44, 28, 72, 52];
</script>

<template>
  <div :class="['vu-meter', variant ?? 'compact', { disabled: !enabled }]" aria-hidden="true">
    <span v-for="(level, index) in levels" :key="index" :style="{ height: `${enabled ? level : 12}%` }"></span>
  </div>
</template>

<style scoped>
.vu-meter {
  height: 46px;
  display: flex;
  align-items: end;
  gap: 3px;
}

.vu-meter span {
  width: 5px;
  min-height: 4px;
  border-radius: 4px;
  background: #27ce73;
}

.vu-meter span:nth-child(3),
.vu-meter span:nth-child(7) {
  background: #f3c34c;
}

.vu-meter.expanded {
  height: 92px;
  gap: 4px;
}

.vu-meter.expanded span,
.vu-meter.console span {
  width: 7px;
}

.vu-meter.console {
  height: 128px;
  justify-content: center;
}

.vu-meter.disabled span {
  background: #3a3a3a;
}
</style>
