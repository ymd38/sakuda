<script setup lang="ts">
import type { Engine, EngineRunStatus, EngineRunView } from '#shared/types/api'

/** One engine's run at a glance: status, elapsed (running) or total
 * (finished) time, and the time budget the runner enforced — the three
 * things a reader needs to tell "still going", "finished" and "cut off at
 * the limit" apart (#84). `run` is null for an engine the scan has not
 * reached yet. */
const props = withDefaults(
  defineProps<{
    engine: Engine
    run: EngineRunView | null
    /** Server clock at the last poll; elapsed time is measured against it,
     * advanced locally between polls, so a skewed browser clock cannot
     * distort the display. */
    serverNow: string | null
    /** Off when the surrounding panel already names the engine. */
    showLabel?: boolean
  }>(),
  { showLabel: true },
)

type TimingStatus = EngineRunStatus | 'pending'
const status = computed<TimingStatus>(() => props.run?.status ?? 'pending')

function statusTextClass(s: TimingStatus): string {
  switch (s) {
    case 'done':
      return 'text-success'
    case 'failed':
      return 'text-sale'
    case 'running':
      return 'text-info'
    case 'pending':
      return 'text-mute'
    case 'skipped':
      return 'text-mute'
    default: {
      const exhaustive: never = s
      return exhaustive
    }
  }
}

const { now } = useServerClock(toRef(props, 'serverNow'))

const elapsed = computed(() => {
  if (!props.run) return null
  if (props.run.status === 'running') return formatElapsed(props.run.startedAt, now.value)
  if (!props.run.finishedAt) return null
  return formatElapsed(props.run.startedAt, new Date(props.run.finishedAt))
})
const elapsedLabel = computed(() => (props.run?.status === 'running' ? 'Elapsed' : 'Took'))

const stoppedAtLimit = computed(() => (props.run ? isStoppedAtLimit(props.run) : false))
const limitTitle = computed(() =>
  props.run ? props.run.limits.parts.map((p) => `${p.label}: ${p.minutes} min`).join('\n') : '',
)
</script>

<template>
  <div
    class="text-caption-md flex flex-wrap items-center gap-x-4 gap-y-1"
    data-testid="engine-run-timing"
    :data-engine="engine"
  >
    <span v-if="showLabel" class="text-ink font-medium">{{ ENGINE_LABELS[engine] }}</span>
    <span class="badge" :class="statusTextClass(status)" data-testid="engine-status-pill">
      {{ status }}
    </span>
    <span v-if="stoppedAtLimit" class="badge text-sale" data-testid="engine-stopped-at-limit">
      stopped at limit
    </span>
    <span v-if="elapsed" data-testid="engine-elapsed" class="text-mute">
      {{ elapsedLabel }} {{ elapsed }}
    </span>
    <span v-if="run" data-testid="engine-limit" class="text-mute" :title="limitTitle">
      Limit {{ run.limits.totalMinutes }} min<template v-if="run.limits.estimated">
        (estimated)</template
      >
    </span>
  </div>
</template>
