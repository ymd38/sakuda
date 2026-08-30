<script setup lang="ts">
import type { ScanStatus } from '#shared/types/api'

const props = defineProps<{ status: ScanStatus }>()

function statusTextClass(status: ScanStatus): string {
  switch (status) {
    case 'failed':
      return 'text-sale'
    case 'done':
      return 'text-success'
    case 'running':
      return 'text-info'
    case 'queued':
      return 'text-mute'
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}
</script>

<template>
  <span data-testid="scan-status-badge" class="badge" :class="statusTextClass(props.status)">
    {{ props.status }}
  </span>
</template>
