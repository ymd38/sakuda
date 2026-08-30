<script setup lang="ts">
import type { HistoryPoint } from '#shared/types/api'
import ChartCanvas from '~/components/chart/ChartCanvas.vue'

const props = defineProps<{ history: HistoryPoint[] }>()

const enough = computed(() => hasTrendData(props.history))
// resolveChartPalette() is client-only — only evaluate it once we're inside
// <ClientOnly> and actually rendering the chart.
const config = computed(() => buildSeverityStackConfig(props.history, resolveChartPalette()))
</script>

<template>
  <section>
    <h2 class="font-display text-heading-md text-mute uppercase">Findings by severity</h2>
    <ClientOnly>
      <div v-if="enough" class="mt-4 h-64">
        <ChartCanvas :config="config" />
      </div>
      <p v-else class="text-caption-md text-mute mt-4">
        Not enough data — charts appear after 2 finished scans
      </p>
    </ClientOnly>
  </section>
</template>
