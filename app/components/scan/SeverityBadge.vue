<script setup lang="ts">
defineProps<{ severity?: string }>()
</script>

<template>
  <span data-testid="severity-badge" class="badge" :class="severityTextClass(severity ?? 'info')">
    {{ severity ?? 'info' }}
  </span>
</template>
