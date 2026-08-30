<script setup lang="ts">
import type { SeverityCounts, SeverityLevel } from '#shared/types/api'

defineProps<{ counts: SeverityCounts }>()

// `FindingView.severity` only ever carries critical/high/medium — low and
// info are counted by the engines but never itemized as individual
// findings, so their cells get an explicit note instead of implying a list.
const COUNTS_ONLY_LEVELS: readonly SeverityLevel[] = ['low', 'info']
</script>

<template>
  <div class="grid grid-cols-3 gap-3 sm:grid-cols-5" data-testid="severity-count-cards">
    <div
      v-for="level in SEVERITY_LEVELS"
      :key="level"
      class="card flex flex-col items-center gap-1 py-4"
      :data-testid="`severity-count-${level}`"
    >
      <span class="text-heading-lg font-display" :class="severityTextClass(level)">{{
        counts[level]
      }}</span>
      <span class="text-caption-sm text-mute uppercase">{{ level }}</span>
      <span v-if="COUNTS_ONLY_LEVELS.includes(level)" class="text-caption-sm text-mute">
        counts only
      </span>
    </div>
  </div>
</template>
