<script setup lang="ts">
import Chart from 'chart.js/auto'
import type { ChartConfiguration } from 'chart.js'
import { toRaw } from 'vue'

const props = defineProps<{ config: ChartConfiguration }>()

const canvasRef = ref<HTMLCanvasElement>()

// The Chart.js instance must never be made reactive — Vue proxying its
// internal state breaks Chart.js's own bookkeeping. Keep it as a plain,
// non-reactive local instead of a ref.
let chart: Chart

onMounted(() => {
  chart = new Chart(canvasRef.value!, toRaw(props.config))
})

watch(
  () => props.config,
  (config) => {
    // Options are resolved once at mount (palette is read client-side up
    // front); only the data is expected to change on re-render.
    chart.data = toRaw(config).data
    chart.update()
  },
)

onUnmounted(() => {
  chart.destroy()
})
</script>

<template>
  <canvas ref="canvasRef" />
</template>
