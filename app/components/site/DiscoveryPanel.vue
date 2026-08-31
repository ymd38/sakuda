<script setup lang="ts">
import type {
  AddTargetsResult,
  DiscoveredUrl,
  DiscoverySummary,
  SitePublic,
} from '#shared/types/api'
import { parseNucleiPathLines } from '#shared/utils/nucleiPaths'
import { urlToTargetLine } from '#shared/utils/targetLines'

const props = defineProps<{ site: SitePublic }>()
const emit = defineEmits<{ saved: [site: SitePublic] }>()

const { data: discoveries, refresh: refreshList } = await useFetch<DiscoverySummary[]>(
  `/api/sites/${props.site.id}/discoveries`,
)

// The discovery whose result the panel shows: the newest one, or the one
// just started. `polling` fetches it once and keeps going while it is
// queued/running; when it ends the list is refreshed so the summary row
// (status, count) matches the detail.
const currentId = ref<string | null>(discoveries.value?.[0]?.id ?? null)
const polling = useDiscoveryPolling(() => currentId.value ?? '')
watch(polling.done, (isDone) => {
  if (isDone) void refreshList()
})
onMounted(() => {
  if (currentId.value) polling.start()
})

const detail = computed(() => polling.state.value)
const isActive = computed(() => {
  const status = detail.value?.status
  return currentId.value !== null && (!detail.value || status === 'queued' || status === 'running')
})

const starting = ref(false)
const startError = ref<string | null>(null)

async function startDiscovery() {
  starting.value = true
  startError.value = null
  try {
    const d = await $fetch<DiscoverySummary>(`/api/sites/${props.site.id}/discoveries`, {
      method: 'POST',
    })
    currentId.value = d.id
    selected.value = new Set()
    saveMessage.value = null
    polling.start()
  } catch (err) {
    startError.value = toApiErrorMessage(err)
  } finally {
    starting.value = false
  }
}

// --- result review -------------------------------------------------------

interface ReviewRow {
  url: DiscoveredUrl
  /** The line that would be saved, or null when the URL is on neither base origin. */
  line: string | null
  saved: boolean
}

const savedKeys = computed(() => {
  const parsed = parseNucleiPathLines(props.site.nucleiPaths)
  return new Set(parsed.lines.map((l) => `${l.base}|${l.path}`))
})

function lineKey(line: string): string {
  return line.startsWith('api:') ? `api|${line.slice(4)}` : `front|${line}`
}

const rows = computed<ReviewRow[]>(() =>
  (detail.value?.urls ?? []).map((url) => {
    const line = urlToTargetLine(props.site, url.url)
    return { url, line, saved: line !== null && savedKeys.value.has(lineKey(line)) }
  }),
)
const selectableLines = computed(() =>
  rows.value.flatMap((r) => (r.line !== null && !r.saved ? [r.line] : [])),
)

// Selection is keyed by line; default = everything not yet saved.
const selected = ref<Set<string>>(new Set())
watch(
  selectableLines,
  (lines) => {
    selected.value = new Set(lines)
  },
  { immediate: true },
)

function toggle(line: string) {
  const next = new Set(selected.value)
  if (next.has(line)) next.delete(line)
  else next.add(line)
  selected.value = next
}
function selectAll() {
  selected.value = new Set(selectableLines.value)
}
function selectNone() {
  selected.value = new Set()
}

const manualText = ref('')
const manualLines = computed(() =>
  manualText.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== ''),
)
const linesToSave = computed(() => [...new Set([...selected.value, ...manualLines.value])])

const saving = ref(false)
const saveError = ref<string | null>(null)
const saveMessage = ref<string | null>(null)

async function saveTargets() {
  if (linesToSave.value.length === 0) return
  saving.value = true
  saveError.value = null
  saveMessage.value = null
  try {
    const result = await $fetch<AddTargetsResult>(`/api/sites/${props.site.id}/targets`, {
      method: 'POST',
      body: { lines: linesToSave.value },
    })
    manualText.value = ''
    saveMessage.value = `Saved ${result.added.length} new target path${result.added.length === 1 ? '' : 's'}${result.skipped.length ? ` (${result.skipped.length} already saved)` : ''}.`
    emit('saved', result.site)
  } catch (err) {
    saveError.value = toApiErrorMessage(err)
  } finally {
    saving.value = false
  }
}

function droppedSummary(meta: Record<string, unknown>): string | null {
  const dropped = meta['dropped']
  if (typeof dropped !== 'object' || dropped === null) return null
  const parts = Object.entries(dropped)
    .filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0)
    .map(([k, v]) => `${k} ${v}`)
  return parts.length ? parts.join(', ') : null
}
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="discovery-panel">
    <div class="flex flex-wrap items-center gap-4">
      <button
        type="button"
        data-testid="start-discovery"
        class="btn-secondary"
        :disabled="starting || isActive"
        @click="startDiscovery"
      >
        {{ isActive ? 'Discovering…' : 'Discover URLs' }}
      </button>
      <p v-if="detail" class="text-caption-md text-mute" data-testid="discovery-status">
        Last discovery: {{ detail.status }} · {{ detail.createdAt.slice(0, 16).replace('T', ' ') }}
        <template v-if="detail.status === 'done'"> · {{ detail.urlCount }} URLs</template>
      </p>
      <p v-else-if="!currentId" class="text-caption-md text-mute">
        No discovery yet. ZAP's spider crawls from the seed path for up to
        {{ site.zapFeSpiderMaxMinutes }} min each (traditional + Ajax).
      </p>
    </div>

    <p v-if="startError" data-testid="discovery-error" class="text-sale text-body-md">
      {{ startError }}
    </p>
    <p v-if="polling.error.value" class="text-sale text-body-md">{{ polling.error.value }}</p>

    <template v-if="detail">
      <ul v-if="detail.warnings.length > 0" class="flex flex-col gap-2">
        <li
          v-for="(warning, index) in detail.warnings"
          :key="index"
          data-testid="discovery-warning"
          class="border-sale bg-soft-cloud text-caption-md text-ink border-l-4 px-4 py-2"
        >
          {{ warning }}
        </li>
      </ul>
      <pre
        v-if="detail.error"
        class="bg-soft-cloud text-caption-md text-sale overflow-x-auto p-4 whitespace-pre-wrap"
        >{{ detail.error }}</pre>

      <template v-if="detail.status === 'done'">
        <p class="text-caption-sm text-mute">
          {{ detail.meta.nodeCount ?? detail.urlCount }} nodes crawled → {{ detail.urlCount }} URLs
          kept<template v-if="droppedSummary(detail.meta)">
            (dropped: {{ droppedSummary(detail.meta) }})</template
          >. Tick the URLs to scan and save them as target paths.
        </p>

        <div v-if="rows.length > 0" class="flex flex-wrap items-center gap-4 text-caption-md">
          <button type="button" class="text-ink underline" @click="selectAll">Select all</button>
          <button type="button" class="text-ink underline" @click="selectNone">Select none</button>
          <span class="text-mute">{{ selected.size }} selected</span>
        </div>

        <div v-if="rows.length > 0" class="overflow-x-auto">
          <table class="text-caption-md w-full" data-testid="discovered-urls">
            <thead>
              <tr class="text-mute text-left">
                <th class="pb-2" />
                <th class="pb-2">Target path</th>
                <th class="pb-2">Status</th>
                <th class="pb-2">Source</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.url.url"
                class="border-hairline-soft border-t"
                data-testid="discovered-url"
              >
                <td class="py-1 pr-2 align-top">
                  <input
                    v-if="row.line !== null"
                    type="checkbox"
                    :disabled="row.saved"
                    :checked="row.saved || selected.has(row.line)"
                    :data-testid="`discovered-url-checkbox`"
                    @change="toggle(row.line)"
                  />
                </td>
                <td class="py-1 pr-4 align-top break-all">
                  {{ row.line ?? row.url.url }}
                  <span v-if="row.saved" class="badge text-mute ml-2">saved</span>
                </td>
                <td class="py-1 pr-4 align-top">{{ row.url.statusCode }}</td>
                <td class="py-1 align-top">{{ row.url.source }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <div class="flex flex-col gap-2">
      <label for="manual-target-lines" class="text-caption-md text-ink font-medium">
        Add paths by hand
        <span class="text-mute">(optional — one per line, "api:" prefix for the API base)</span>
      </label>
      <textarea
        id="manual-target-lines"
        v-model="manualText"
        data-testid="manual-target-lines"
        rows="2"
        placeholder="/rest/products/search?q=a&#10;api:/health"
        class="textarea-soft"
      />
    </div>

    <p v-if="saveError" data-testid="save-error" class="text-sale text-body-md">{{ saveError }}</p>
    <p v-if="saveMessage" data-testid="save-message" class="text-success text-body-md">
      {{ saveMessage }}
    </p>

    <button
      type="button"
      data-testid="save-targets"
      class="btn-primary self-start"
      :disabled="saving || linesToSave.length === 0"
      @click="saveTargets"
    >
      Save {{ linesToSave.length }} to targets
    </button>
  </div>
</template>
