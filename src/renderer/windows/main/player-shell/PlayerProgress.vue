<script setup lang="ts">
defineProps<{
  progress: number;
}>();
</script>

<template>
  <div class="progress" aria-hidden="true">
    <div :style="{ width: `${Math.max(0, Math.min(100, progress))}%` }"></div>
  </div>
</template>

<style scoped>
.progress {
  height: 7px;
  border-radius: 99px;
  overflow: hidden;
  background: #303030;
}

.progress div {
  height: 100%;
  border-radius: 99px;
  background: #d72b2b;
}
</style>
