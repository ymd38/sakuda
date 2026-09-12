<script setup lang="ts">
import type {
  AddTargetsResult,
  BodyShape,
  DiscoveredUrl,
  DiscoverySummary,
  RemoveTargetResult,
  SitePublic,
} from '#shared/types/api'
import { isActiveScanEnabled } from '#shared/utils/activeScan'
import { parseNucleiPathLines, targetLineKey } from '#shared/utils/nucleiPaths'
import { resolveDiscoverySeeds } from '#shared/utils/seedPaths'
import { formatTargetLine, urlToTargetLine } from '#shared/utils/targetLines'

const props = defineProps<{ site: SitePublic }>()
// Both events hand back the server's updated site: the host page swaps its
// copy so the saved badges (and any form bound to nucleiPaths) follow.
const emit = defineEmits<{ saved: [site: SitePublic]; removed: [site: SitePublic] }>()

const seeds = computed(() => resolveDiscoverySeeds(props.site))
// Same gate the engines read (katana -aff, ZAP postForm): the warning must
// say what discovery will actually do, ownership confirmation included.
const activeDiscovery = computed(() => isActiveScanEnabled(props.site))
const storageSummary = computed(() =>
  props.site.browserStorageNames.map((n) => `${n.kind}:${n.name}`).join(', '),
)

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

type RowSource = DiscoveredUrl['source'] | 'manual'

/** One row of the "discovered & saved" table: a discovered URL, or a saved
 * line the latest discovery did not produce (hand-added, or found by an
 * earlier run) — shown so the saved list is always visible here, whatever
 * the last crawl returned. */
interface ReviewRow {
  key: string
  method: string
  /** The line that would be (or is) saved, or null when the discovered URL is on neither base origin. */
  line: string | null
  /** Path column text: the line, or the raw URL when it cannot become a line. */
  display: string
  statusCode: number | null
  source: RowSource
  bodyShape: BodyShape | null
  contentType: string | null
  saved: boolean
}

/** The saved lines keyed by identity (method|base|path) — what "saved"
 * means in this table, and what {@link mergeTargetLines} dedupes on. */
const savedLines = computed(() => {
  const parsed = parseNucleiPathLines(props.site.nucleiPaths)
  return new Map(
    parsed.lines.map((l) => [targetLineKey(l), formatTargetLine(l.method, l.base, l.path)]),
  )
})

/** The method|base|path key of a produced target line, or null if it does
 * not parse (never, for a line urlToTargetLine built) — matches the saved
 * key set so a re-discovered target shows as already saved. */
function lineKey(line: string): string | null {
  const only = parseNucleiPathLines(line).lines[0]
  return only ? targetLineKey(only) : null
}

const rows = computed<ReviewRow[]>(() => {
  const discovered: ReviewRow[] = (detail.value?.urls ?? []).map((url) => {
    const line = urlToTargetLine(props.site, url.url, url.method)
    const key = line !== null ? lineKey(line) : null
    return {
      key: `${url.method} ${url.url}`,
      method: url.method,
      line,
      display: line ?? url.url,
      statusCode: url.statusCode,
      source: url.source,
      bodyShape: url.bodyShape ?? null,
      contentType: url.contentType ?? null,
      saved: key !== null && savedLines.value.has(key),
    }
  })
  const covered = new Set(discovered.flatMap((r) => (r.line !== null ? [lineKey(r.line)] : [])))
  const manual: ReviewRow[] = [...savedLines.value.entries()]
    .filter(([key]) => !covered.has(key))
    .map(([key, line]) => ({
      key: `manual ${key}`,
      method: parseNucleiPathLines(line).lines[0]?.method ?? 'GET',
      line,
      display: line,
      statusCode: null,
      source: 'manual',
      bodyShape: null,
      contentType: null,
      saved: true,
    }))
  return [...discovered, ...manual]
})
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

/** A short, value-free badge for a captured body shape: "json {email,
 * password}" (top-level keys), "form {q}", or the bare kind. Only names and
 * types appear — never a captured value. */
function bodyShapeBadge(shape: BodyShape): string {
  if (shape.kind === 'form') return `form {${shape.fields.join(', ')}}`
  if (shape.kind === 'other') return 'other'
  const root = shape.root
  if (root.type === 'object' && root.fields) return `json {${Object.keys(root.fields).join(', ')}}`
  return `json ${root.type}`
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
  // Approved non-GET rows carry their captured shape along with the line, so
  // the server stores each shape under its target line (values never sent).
  const shapes = rows.value.flatMap((r) =>
    r.line !== null && selected.value.has(r.line) && r.bodyShape
      ? [{ line: r.line, contentType: r.contentType, bodyShape: r.bodyShape }]
      : [],
  )
  try {
    const result = await $fetch<AddTargetsResult>(`/api/sites/${props.site.id}/targets`, {
      method: 'POST',
      body: { lines: linesToSave.value, shapes },
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

// --- un-saving a line -----------------------------------------------------

const removingLine = ref<string | null>(null)
const removeError = ref<string | null>(null)

/** Removes one saved line from the site's targets (all engines read that
 * list), so a wrongly approved URL can be dropped here rather than by editing
 * the whole text in the form. */
async function removeTarget(line: string) {
  removingLine.value = line
  removeError.value = null
  saveMessage.value = null
  try {
    const result = await $fetch<RemoveTargetResult>(`/api/sites/${props.site.id}/targets`, {
      method: 'DELETE',
      body: { line },
    })
    emit('removed', result.site)
  } catch (err) {
    removeError.value = toApiErrorMessage(err)
  } finally {
    removingLine.value = null
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
  <div class="flex flex-col gap-6" data-testid="discovery-panel">
    <!-- Area 1: what discovery found, and what is saved — no free text here -->
    <div class="flex flex-col gap-4" data-testid="targets-detected">
      <p class="text-caption-md text-ink font-medium">Discovered &amp; saved</p>

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
          Last discovery: {{ detail.status }} ·
          {{ detail.createdAt.slice(0, 16).replace('T', ' ') }}
          <template v-if="detail.status === 'done'"> · {{ detail.urlCount }} URLs</template>
        </p>
        <p v-else-if="!currentId" class="text-caption-md text-mute">
          No discovery yet. ZAP's spiders crawl for up to {{ site.zapFeSpiderMaxMinutes }} min each
          (traditional + Ajax per seed), and katana parses the JS bundles for API paths in parallel.
        </p>
      </div>

      <p class="text-caption-sm text-mute" data-testid="discovery-seeds">
        Seeds: <code>{{ seeds.join('  ') }}</code>
        <template v-if="storageSummary"> · browser storage: {{ storageSummary }}</template>
        <template v-else>
          · no browser storage — SPA pages behind a login stay hidden; add the login token under
          Authentication above
        </template>
      </p>

      <p
        v-if="activeDiscovery"
        data-testid="active-discovery-warning"
        class="border-sale bg-soft-cloud text-caption-md text-ink border-l-4 px-4 py-2"
      >
        Active checks are on, so discovery submits forms while it crawls (ZAP's spider and katana's
        form fill) — this writes to the target before you review anything. Only run it against an
        environment you own and can reset.
      </p>

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
        <p v-if="detail.status === 'done'" class="text-caption-sm text-mute">
          {{ detail.meta.nodeCount ?? detail.urlCount }} nodes crawled → {{ detail.urlCount }} URLs
          kept<template v-if="droppedSummary(detail.meta)">
            (dropped: {{ droppedSummary(detail.meta) }})</template
          >. Tick the URLs to scan and save them as target paths; saved lines the crawl did not
          return stay listed as "manual".
        </p>
      </template>

      <div
        v-if="selectableLines.length > 0"
        class="flex flex-wrap items-center gap-4 text-caption-md"
      >
        <button type="button" class="text-ink underline" @click="selectAll">Select all</button>
        <button type="button" class="text-ink underline" @click="selectNone">Select none</button>
        <span class="text-mute">{{ selected.size }} selected</span>
      </div>

      <div v-if="rows.length > 0" class="overflow-x-auto">
        <table class="text-caption-md w-full" data-testid="discovered-urls">
          <thead>
            <tr class="text-mute text-left">
              <th class="pb-2" />
              <th class="pb-2">Method</th>
              <th class="pb-2">Target path</th>
              <th class="pb-2">Status</th>
              <th class="pb-2">Source</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.key"
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
              <td class="py-1 pr-2 align-top font-mono" data-testid="discovered-url-method">
                {{ row.method }}
              </td>
              <td class="py-1 pr-4 align-top break-all">
                {{ row.display }}
                <span v-if="row.saved" class="badge text-mute ml-2">saved</span>
                <button
                  v-if="row.saved && row.line !== null"
                  type="button"
                  class="text-ink ml-2 underline"
                  data-testid="remove-target"
                  :disabled="removingLine !== null"
                  @click="removeTarget(row.line)"
                >
                  {{ removingLine === row.line ? 'Removing…' : 'Remove' }}
                </button>
                <span
                  v-if="row.bodyShape"
                  class="badge text-mute ml-2"
                  data-testid="discovered-url-shape"
                >
                  {{ bodyShapeBadge(row.bodyShape) }}
                </span>
              </td>
              <td class="py-1 pr-4 align-top">{{ row.statusCode ?? '—' }}</td>
              <td class="py-1 align-top" data-testid="discovered-url-source">
                {{ row.source }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="text-caption-sm text-mute" data-testid="no-targets">
        Nothing saved yet — every engine works from the base URL until you save a path here.
      </p>

      <p v-if="removeError" data-testid="remove-error" class="text-sale text-body-md">
        {{ removeError }}
      </p>
    </div>

    <!-- Area 2: paths typed by hand — the only free text on this list -->
    <div class="flex flex-col gap-2" data-testid="targets-add">
      <label for="manual-target-lines" class="text-caption-md text-ink font-medium">
        Add paths
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
      <p class="text-caption-sm text-mute">
        Saved with the ticked URLs above; a saved line then stays in the table (source "manual")
        until you remove it. A line may start with an HTTP method, e.g. "POST /api/x" — method
        omitted means GET; non-GET lines are replayed only under active checks.
      </p>
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
