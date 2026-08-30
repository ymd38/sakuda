<script setup lang="ts">
import type { FindingView } from '#shared/types/api'
import FindingCard from './FindingCard.vue'

const props = defineProps<{ findings: FindingView[] }>()

const sorted = computed(() => sortBySeverity(props.findings))
</script>

<template>
  <div>
    <p
      v-if="sorted.length === 0"
      data-testid="finding-list-empty"
      class="text-caption-md text-mute"
    >
      No findings.
    </p>
    <ul v-else class="flex flex-col gap-3">
      <FindingCard v-for="finding in sorted" :key="finding.id" :finding="finding" />
    </ul>
  </div>
</template>
