<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { usePolling } from '~/composables/usePolling'
import type { JobView } from '#shared/types/api'

// Cross-site job queue. Polls `/api/jobs` on a never-terminal loop so the
// panel appears when a job starts and clears when the queue drains; the poll
// stops on unmount. Display order = the API's claim order = execution order.
const polling = usePolling<JobView[]>(
  () => $fetch<JobView[]>('/api/jobs'),
  () => false,
)

onMounted(() => polling.start())
onUnmounted(() => polling.stop())

const jobs = computed<JobView[]>(() => polling.state.value ?? [])
const hasJobs = computed(() => jobs.value.length > 0)

function label(job: JobView): string {
  if (job.kind === 'scan') return `scan · ${(job.engines ?? []).join(', ') || 'no engines'}`
  return 'discovery'
}

// 1-based position among *queued* jobs (running rows are shown as "running").
// Counting queued rows up to and including this one keeps the numbering right
// regardless of how many running rows precede it.
function queuePosition(index: number): number {
  return jobs.value.slice(0, index + 1).filter((j) => j.status === 'queued').length
}
</script>

<template>
  <section v-if="hasJobs" data-testid="job-queue" class="card mt-6 flex flex-col gap-3">
    <h2 class="font-display text-heading-md uppercase">Job queue</h2>
    <ul class="flex flex-col gap-2">
      <li
        v-for="(job, index) in jobs"
        :key="`${job.kind}:${job.id}`"
        :data-testid="`job-${job.kind}-${job.id}`"
        class="flex flex-wrap items-center gap-2"
      >
        <span
          class="badge"
          :class="job.status === 'running' ? 'text-info' : 'text-mute'"
          :data-testid="`job-status-${job.id}`"
          >{{ job.status === 'running' ? 'running' : `#${queuePosition(index)}` }}</span
        >
        <span class="text-caption-md font-medium text-ink">{{ job.siteName }}</span>
        <span class="text-caption-sm text-mute">{{ label(job) }}</span>
      </li>
    </ul>
  </section>
</template>
