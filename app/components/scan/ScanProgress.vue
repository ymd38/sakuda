<script setup lang="ts">
const props = defineProps<{ status: string; startedAt?: string | null }>()

// Elapsed time needs a "now" that changes on its own — the polled `status`
// can stay `running` for a long stretch, so a computed keyed only on
// `startedAt` would never re-run and the display would freeze.
const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})
onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer)
})

const label = computed(() => (props.status === 'queued' ? 'Queued…' : 'Scanning…'))
// Target size and response times vary too widely to promise a remaining
// time or progress percentage — elapsed time only confirms it's moving.
const elapsed = computed(() =>
  props.status === 'queued' ? null : formatElapsed(props.startedAt, now.value),
)
</script>

<template>
  <div v-if="status === 'failed'" data-testid="scan-failed" class="card border-l-4 border-sale">
    <p class="text-body-md text-sale">Scan failed. Please try again later.</p>
  </div>
  <div v-else class="card">
    <p class="font-display text-heading-md uppercase">{{ label }}</p>
    <p v-if="elapsed" data-testid="scan-elapsed" class="mt-2 text-caption-md text-mute">
      Elapsed {{ elapsed }}
    </p>
    <p class="mt-2 text-caption-sm text-mute">
      This can take a few minutes depending on target size. This page updates automatically.
    </p>
  </div>
</template>
