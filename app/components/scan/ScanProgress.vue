<script setup lang="ts">
import type { Engine, EngineRunView } from '#shared/types/api'
import EngineRunTiming from './EngineRunTiming.vue'

const props = withDefaults(
  defineProps<{
    status: string
    startedAt?: string | null
    /** The scan's engines in run order; each gets a row, started or not. */
    engines?: Engine[]
    engineRuns?: EngineRunView[]
    serverNow?: string | null
  }>(),
  { startedAt: null, engines: () => [], engineRuns: () => [], serverNow: null },
)

// Same server-anchored, self-ticking clock as the engine rows, so the scan
// total and the per-engine times can never disagree with each other.
const { now } = useServerClock(toRef(props, 'serverNow'))

const label = computed(() => (props.status === 'queued' ? 'Queued…' : 'Scanning…'))
// Target size and response times vary too widely to promise a remaining
// time or progress percentage — elapsed time only confirms it's moving.
const elapsed = computed(() =>
  props.status === 'queued' ? null : formatElapsed(props.startedAt, now.value),
)

const engineRows = computed(() =>
  orderEngines(props.engines).map((engine) => ({
    engine,
    run: props.engineRuns.find((r) => r.engine === engine) ?? null,
  })),
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
    <ul v-if="engineRows.length > 0" class="mt-4 flex flex-col gap-2" data-testid="engine-timeline">
      <li v-for="row in engineRows" :key="row.engine">
        <EngineRunTiming :engine="row.engine" :run="row.run" :server-now="serverNow" />
      </li>
    </ul>
    <p class="mt-2 text-caption-sm text-mute">
      This can take a few minutes depending on target size. This page updates automatically.
    </p>
  </div>
</template>
