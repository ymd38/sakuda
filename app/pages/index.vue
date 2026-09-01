<script setup lang="ts">
import ScanStatusBadge from '~/components/scan/ScanStatusBadge.vue'
import type { SiteListItem } from '#shared/types/api'

const { data: sites } = await useFetch<SiteListItem[]>('/api/sites', { key: 'sites-list' })
</script>

<template>
  <div>
    <h1 class="font-display text-heading-xl uppercase">Sites</h1>

    <div
      v-if="!sites || sites.length === 0"
      data-testid="empty-state"
      class="card mt-6 flex flex-col items-start gap-4"
    >
      <p class="text-body-md text-mute">No sites yet. Add one to start scanning.</p>
      <NuxtLink to="/sites/new" class="btn-primary">New site</NuxtLink>
    </div>

    <ul v-else class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <li v-for="site in sites" :key="site.id" class="card flex flex-col gap-3">
        <div>
          <NuxtLink :to="`/sites/${site.id}`" class="text-heading-md font-display uppercase">
            {{ site.name }}
          </NuxtLink>
          <p class="text-caption-md text-mute">{{ site.frontBaseUrl }}</p>
        </div>

        <div v-if="site.lastScan" class="flex flex-wrap items-center gap-2">
          <ScanStatusBadge :status="site.lastScan.status" />
          <span class="text-caption-sm text-mute">{{ site.lastScan.createdAt.slice(0, 10) }}</span>
          <span class="text-caption-sm text-ink"
            >{{ reportedTotal(site.lastScan.counts) }} findings</span
          >
        </div>
        <p v-else class="text-caption-sm text-mute">No scans yet.</p>

        <NuxtLink :to="`/sites/${site.id}/edit`" class="btn-secondary self-start">Edit</NuxtLink>
      </li>
    </ul>
  </div>
</template>
