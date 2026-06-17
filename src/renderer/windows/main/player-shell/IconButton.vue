<script setup lang="ts">
defineProps<{
  icon: string;
  label: string;
  prominent?: boolean;
  disabled?: boolean;
}>();

defineEmits<{
  click: [];
}>();
</script>

<template>
  <button :class="{ 'icon-button': true, prominent }" :disabled="disabled" :title="label" :aria-label="label" @click="$emit('click')">
    <span class="material-symbols-outlined">{{ icon }}</span>
  </button>
</template>

<style scoped>
.icon-button {
  width: 34px;
  height: 34px;
  border: 1px solid #2d2d2d;
  border-radius: 8px;
  background: #1b1b1b;
  color: #d7d7d7;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
  cursor: pointer;
}

.icon-button:hover:not(:disabled) {
  background: #282828;
  color: #ffffff;
}

.icon-button:disabled {
  opacity: 0.42;
  cursor: default;
}

.icon-button.prominent {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border-color: #d72b2b;
  background: #d72b2b;
  color: #ffffff;
  box-shadow: 0 8px 20px rgba(215, 43, 43, 0.24);
}

.icon-button .material-symbols-outlined {
  font-size: 21px;
  font-variation-settings:
    "FILL" 0,
    "wght" 260,
    "GRAD" 0,
    "opsz" 24;
}
</style>
