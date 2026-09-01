<script setup lang="ts">
import ScanStatusBadge from '~/components/scan/ScanStatusBadge.vue'
import SeverityStackChart from '~/components/chart/SeverityStackChart.vue'
import EngineCountChart from '~/components/chart/EngineCountChart.vue'
import DiffTrendChart from '~/components/chart/DiffTrendChart.vue'
import DiscoveryPanel from '~/components/site/DiscoveryPanel.vue'
import type { Engine, HistoryPoint, ScanSummary, SitePublic } from '#shared/types/api'
import { parseNucleiPathLines } from '#shared/utils/nucleiPaths'

const route = useRoute()
// `route.params.id` is `string | string[]` generically; this route only has
// a single `[id]` segment, so it is always a plain string at runtime.
const rawSiteId = route.params.id
const siteId = Array.isArray(rawSiteId) ? (rawSiteId[0] ?? '') : rawSiteId

const { data: site, error: siteError } = await useFetch<SitePublic>(`/api/sites/${siteId}`)
const { data: scans } = await useFetch<ScanSummary[]>(`/api/sites/${siteId}/scans`)
const { data: history } = await useFetch<HistoryPoint[]>(`/api/sites/${siteId}/history`)

const nucleiChecked = ref(true)
const zapApiChecked = ref(false)
const zapFeChecked = ref(true)

const submitting = ref(false)
const errorMessage = ref<string | null>(null)

// nuclei always runs: with no paths configured it scans the base URL(s).
const nucleiAvailable = computed(() => !!site.value)
const savedTargetCount = computed(() =>
  site.value ? parseNucleiPathLines(site.value.nucleiPaths).lines.length : 0,
)
const nucleiScansRootOnly = computed(() => !!site.value && savedTargetCount.value === 0)

/** The discovery panel saves targets through its own endpoint and hands the
 * updated site back, so the page reflects the new count without a refetch. */
function handleTargetsSaved(updated: SitePublic) {
  site.value = updated
}
const zapApiAvailable = computed(
  () => !!site.value && (!!site.value.openapiUrl || !!site.value.openapiJson),
)

const canStartScan = computed(
  () => !submitting.value && (nucleiChecked.value || zapApiChecked.value || zapFeChecked.value),
)

function selectedEngines(): Engine[] {
  const engines: Engine[] = []
  if (nucleiChecked.value) engines.push('nuclei')
  if (zapApiChecked.value) engines.push('zap-api')
  if (zapFeChecked.value) engines.push('zap-fe')
  return engines
}

async function handleStartScan() {
  if (!canStartScan.value) return
  submitting.value = true
  errorMessage.value = null
  try {
    const scan = await $fetch<ScanSummary>(`/api/sites/${siteId}/scans`, {
      method: 'POST',
      body: { engines: selectedEngines() },
    })
    await navigateTo(`/scans/${scan.id}`)
  } catch (err) {
    errorMessage.value = toApiErrorMessage(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <p v-if="siteError" class="text-sale text-body-md">{{ toApiErrorMessage(siteError) }}</p>

    <template v-else-if="site">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="font-display text-heading-xl uppercase">{{ site.name }}</h1>
          <p class="text-caption-md text-mute">{{ site.frontBaseUrl }}</p>
          <p v-if="site.apiBaseUrl" class="text-caption-md text-mute">{{ site.apiBaseUrl }}</p>
        </div>
        <NuxtLink :to="`/sites/${siteId}/edit`" class="btn-secondary">Edit</NuxtLink>
      </div>

      <section class="mt-6">
        <h2 class="font-display text-heading-md uppercase">History</h2>
        <div class="mt-2 grid gap-6 md:grid-cols-3">
          <SeverityStackChart :history="history ?? []" />
          <EngineCountChart :history="history ?? []" />
          <DiffTrendChart :history="history ?? []" />
        </div>
      </section>

      <section class="card mt-6 flex flex-col gap-4" data-testid="targets-section">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-display text-heading-md uppercase">Targets</h2>
          <p class="text-caption-md text-mute" data-testid="saved-target-count">
            {{ savedTargetCount }} saved target path{{ savedTargetCount === 1 ? '' : 's' }}
            <NuxtLink :to="`/sites/${siteId}/edit`" class="text-ink ml-2 underline">Edit</NuxtLink>
          </p>
        </div>
        <p class="text-caption-sm text-mute">
          Nuclei scans the saved target paths. Discover URLs with ZAP's spider, review them, and
          save the ones you want scanned — you only need to discover again when the site changes.
        </p>
        <DiscoveryPanel :site="site" @saved="handleTargetsSaved" />
      </section>

      <section class="card mt-6 flex flex-col gap-4">
        <h2 class="font-display text-heading-md uppercase">Start scan</h2>

        <div class="flex flex-col gap-3">
          <div>
            <label class="text-body-md text-ink flex items-center gap-2">
              <input
                v-model="nucleiChecked"
                data-testid="engine-nuclei"
                type="checkbox"
                :disabled="!nucleiAvailable"
              />
              {{ ENGINE_LABELS.nuclei }}
            </label>
            <p v-if="nucleiScansRootOnly" class="text-caption-sm text-mute mt-1">
              No target paths saved — nuclei scans the base URL only. Discover URLs below or add
              paths in Edit to cover more pages/endpoints.
            </p>
          </div>

          <div>
            <label class="text-body-md text-ink flex items-center gap-2">
              <input
                v-model="zapApiChecked"
                data-testid="engine-zap-api"
                type="checkbox"
                :disabled="!zapApiAvailable"
              />
              {{ ENGINE_LABELS['zap-api'] }}
            </label>
            <p v-if="!zapApiAvailable" class="text-caption-sm text-mute mt-1">
              Add an OpenAPI URL or JSON in Edit to enable this engine.
            </p>
          </div>

          <label class="text-body-md text-ink flex items-center gap-2">
            <input v-model="zapFeChecked" data-testid="engine-zap-fe" type="checkbox" />
            {{ ENGINE_LABELS['zap-fe'] }}
          </label>
        </div>

        <p v-if="errorMessage" data-testid="scan-error" class="text-sale text-body-md">
          {{ errorMessage }}
        </p>

        <button
          type="button"
          data-testid="start-scan"
          class="btn-primary self-start"
          :disabled="!canStartScan"
          @click="handleStartScan"
        >
          Start scan
        </button>
      </section>

      <section class="mt-6">
        <h2 class="font-display text-heading-md uppercase">Scans</h2>

        <p v-if="!scans || scans.length === 0" class="text-caption-md text-mute mt-2">
          No scans yet.
        </p>

        <div v-else class="mt-2 overflow-x-auto">
          <table class="text-caption-md w-full">
            <thead>
              <tr class="text-mute text-left">
                <th class="pb-2">Status</th>
                <th class="pb-2">Engines</th>
                <th class="pb-2">Created</th>
                <th class="pb-2">Findings</th>
                <th class="pb-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="scan in scans" :key="scan.id" class="border-hairline-soft border-t">
                <td class="py-2"><ScanStatusBadge :status="scan.status" /></td>
                <td class="py-2">{{ scan.engines.join(', ') }}</td>
                <td class="py-2">{{ scan.createdAt.slice(0, 10) }}</td>
                <td class="py-2">{{ reportedTotal(scan.counts) }}</td>
                <td class="py-2">
                  <NuxtLink :to="`/scans/${scan.id}`" class="text-body-md text-ink underline">
                    View
                  </NuxtLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
