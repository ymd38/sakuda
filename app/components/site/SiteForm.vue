<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { BrowserStorageItem } from '#shared/schemas/browserStorage'
import { BROWSER_STORAGE_KINDS } from '#shared/schemas/browserStorage'
import type { Header } from '#shared/schemas/headers'
import type { SiteInput } from '#shared/schemas/site'
import type { RiskTag, SitePublic } from '#shared/types/api'

const props = defineProps<{
  initial?: SitePublic
  submitting: boolean
  errorMessage: string | null
}>()

const emit = defineEmits<{ submit: [payload: SiteInput] }>()

const isEditMode = computed(() => !!props.initial)

const form = reactive({
  name: props.initial?.name ?? '',
  frontBaseUrl: props.initial?.frontBaseUrl ?? '',
  apiBaseUrl: props.initial?.apiBaseUrl ?? '',
  nucleiPaths: props.initial?.nucleiPaths ?? '',
  openapiUrl: props.initial?.openapiUrl ?? '',
  openapiJson: props.initial?.openapiJson ?? '',
  zapFeSeedPath: props.initial?.zapFeSeedPath ?? '/',
  discoverySeedPaths: props.initial?.discoverySeedPaths ?? '',
  excludePaths: props.initial?.excludePaths ?? '',
  nucleiRateLimit: props.initial?.nucleiRateLimit ?? 50,
  zapApiMaxMinutes: props.initial?.zapApiMaxMinutes ?? 45,
  zapFeSpiderMaxMinutes: props.initial?.zapFeSpiderMaxMinutes ?? 5,
  nonLocalConfirmed: props.initial?.nonLocalConfirmed ?? false,
  allowMutatingRequests: props.initial?.allowMutatingRequests ?? false,
  nucleiEnabledRiskTags: [...(props.initial?.nucleiEnabledRiskTags ?? [])] as RiskTag[],
})

/** nuclei risk-template groups the user can opt into (see server/domain/activeScan);
 * each is excluded by default and needs Active injection checks on to take effect. */
const RISK_TAG_GROUPS: { tag: RiskTag; label: string; help: string }[] = [
  {
    tag: 'intrusive',
    label: 'Known CVE exploit checks',
    help: 'runs the intrusive CVE templates that send a real exploit attempt.',
  },
  {
    tag: 'fuzz',
    label: 'Command injection / RCE',
    help: 'fuzzes for OS command execution — can run commands on the target host.',
  },
  {
    tag: 'dos',
    label: 'Denial of service (dangerous)',
    help: 'sends templates that may crash or hang the target. Leave off unless you can afford downtime.',
  },
]

// `shared/utils/localHost.ts` — auto-imported from `shared/utils/*`. A blank
// or unparsable frontBaseUrl must not show the confirmation gate on a fresh
// form — `siteRequiresConfirmation('', ...)` would otherwise report `true`
// because an unparsable URL is treated as "not local". openapiUrl is the one
// other user-supplied URL the server dereferences (ZAP's openapi job), so it
// must gate the same as frontBaseUrl/apiBaseUrl.
const requiresConfirmation = computed(() => {
  const front = form.frontBaseUrl.trim()
  if (front === '' || !URL.canParse(front)) return false
  return siteRequiresConfirmation(
    form.frontBaseUrl,
    form.apiBaseUrl || null,
    form.openapiUrl || null,
  )
})

// Headers are write-only: the API never returns values, only `headerNames`.
// In edit mode the editor starts hidden — submitting without touching it
// omits `headers` from the payload so the API keeps the existing set.
const headersEditable = ref(!isEditMode.value)
const headerRows = reactive<{ name: string; value: string }[]>([])

function addHeaderRow() {
  headerRows.push({ name: '', value: '' })
}

function removeHeaderRow(index: number) {
  headerRows.splice(index, 1)
}

function startReplacingHeaders() {
  headersEditable.value = true
}

function emptyToNull(value: string): string | null {
  return value.trim() === '' ? null : value
}

// A header row is only sendable once both fields are filled — a row with
// just a name (or just a value) is dropped rather than submitted, since
// `HeaderSchema` requires both and the server-side error would be confusing
// for a row the user hasn't finished typing yet.
function isCompleteHeader(row: { name: string; value: string }): boolean {
  return row.name.trim() !== '' && row.value.trim() !== ''
}

function toHeader(row: { name: string; value: string }): Header {
  return { name: row.name, value: row.value }
}

// Browser storage follows the same write-only contract as headers: the API
// only ever returns kind + name, so in edit mode the editor starts hidden and
// an untouched form omits `browserStorage` (keeps the stored set).
type StorageRow = { kind: BrowserStorageItem['kind']; name: string; value: string }
const storageEditable = ref(!isEditMode.value)
const storageRows = reactive<StorageRow[]>([])

function addStorageRow() {
  storageRows.push({ kind: 'localStorage', name: '', value: '' })
}

function removeStorageRow(index: number) {
  storageRows.splice(index, 1)
}

function startReplacingStorage() {
  storageEditable.value = true
}

function isCompleteStorage(row: StorageRow): boolean {
  return row.name.trim() !== '' && row.value.trim() !== ''
}

function toStorageItem(row: StorageRow): BrowserStorageItem {
  return { kind: row.kind, name: row.name, value: row.value }
}

const canSubmit = computed(
  () => !props.submitting && (!requiresConfirmation.value || form.nonLocalConfirmed),
)

// `v-model.number` leaves the bound field as the raw string when the input
// is empty or unparsable (Vue's `looseToNumber` gives up on non-numeric
// text) — fall back to the schema default rather than submitting a string
// or a non-finite number.
function toFiniteNumber(value: number | string, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function buildPayload(): SiteInput {
  const base = {
    name: form.name,
    frontBaseUrl: form.frontBaseUrl,
    apiBaseUrl: emptyToNull(form.apiBaseUrl),
    nucleiPaths: form.nucleiPaths,
    openapiUrl: emptyToNull(form.openapiUrl),
    openapiJson: emptyToNull(form.openapiJson),
    zapFeSeedPath: form.zapFeSeedPath,
    discoverySeedPaths: form.discoverySeedPaths,
    excludePaths: form.excludePaths,
    nucleiRateLimit: toFiniteNumber(form.nucleiRateLimit, 50),
    zapApiMaxMinutes: toFiniteNumber(form.zapApiMaxMinutes, 45),
    zapFeSpiderMaxMinutes: toFiniteNumber(form.zapFeSpiderMaxMinutes, 5),
    nonLocalConfirmed: form.nonLocalConfirmed,
    allowMutatingRequests: form.allowMutatingRequests,
    nucleiEnabledRiskTags: form.nucleiEnabledRiskTags,
  }
  return {
    ...base,
    ...(headersEditable.value
      ? { headers: headerRows.filter(isCompleteHeader).map(toHeader) }
      : {}),
    ...(storageEditable.value
      ? { browserStorage: storageRows.filter(isCompleteStorage).map(toStorageItem) }
      : {}),
  }
}

function handleSubmit() {
  if (!canSubmit.value) return
  emit('submit', buildPayload())
}
</script>

<template>
  <form data-testid="site-form" class="flex flex-col gap-6" @submit.prevent="handleSubmit">
    <div class="card flex flex-col gap-1 text-caption-sm text-mute" data-testid="form-legend">
      <p><span class="text-sale">*</span> = required. Everything else can stay empty.</p>
      <p>
        Which engines you can start depends on what you fill in: <strong>ZAP frontend</strong> needs
        only the base URL + seed path · <strong>Nuclei</strong> scans the base URL, plus any Nuclei
        paths you list · <strong>ZAP API</strong> needs an OpenAPI URL or JSON.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-name" class="text-caption-md font-medium text-ink"
        >Name <span class="text-sale">*</span></label
      >
      <input
        id="site-name"
        v-model="form.name"
        data-testid="name"
        type="text"
        required
        class="input-pill"
      />
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-front-base-url" class="text-caption-md font-medium text-ink"
        >Front base URL <span class="text-sale">*</span></label
      >
      <input
        id="site-front-base-url"
        v-model="form.frontBaseUrl"
        data-testid="front-base-url"
        type="text"
        placeholder="http://localhost:4001"
        required
        class="input-pill"
      />
      <p class="text-caption-sm text-mute">
        Scheme + host + port of the web app, no trailing path. Nuclei paths and the ZAP seed path
        are appended to it.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-api-base-url" class="text-caption-md font-medium text-ink"
        >API base URL (optional)</label
      >
      <input
        id="site-api-base-url"
        v-model="form.apiBaseUrl"
        data-testid="api-base-url"
        type="text"
        placeholder="https://api.example.com"
        class="input-pill"
      />
      <p class="text-caption-sm text-mute">
        Only when the API lives on a different origin. Used by "api:" Nuclei paths and as the ZAP
        API target.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-nuclei-paths" class="text-caption-md font-medium text-ink"
        >Target paths
        <span class="text-mute">(optional — empty scans the base URL only)</span></label
      >
      <textarea
        id="site-nuclei-paths"
        v-model="form.nucleiPaths"
        data-testid="nuclei-paths"
        rows="4"
        placeholder="/&#10;/api/products&#10;/rest/products/search?q=a&#10;api:/health"
        class="textarea-soft"
      />
      <p class="text-caption-sm text-mute">
        The URLs Nuclei scans, one path per line, relative to the front base URL (prefix "api:" to
        use the API base URL). Nuclei does not crawl — use "Discover URLs" on the site page to fill
        this list from ZAP's spider, or hand-list the pages and endpoints you care about (top page,
        login, API routes with query params). "#" starts a comment.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-openapi-url" class="text-caption-md font-medium text-ink"
        >OpenAPI URL <span class="text-mute">(ZAP API engine — this or JSON below)</span></label
      >
      <input
        id="site-openapi-url"
        v-model="form.openapiUrl"
        data-testid="openapi-url"
        type="text"
        placeholder="http://localhost:8080/swagger/doc.json"
        class="input-pill"
      />
      <p class="text-caption-sm text-mute">
        URL of the OpenAPI/Swagger document ZAP imports for the active API scan.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-openapi-json" class="text-caption-md font-medium text-ink"
        >OpenAPI JSON <span class="text-mute">(paste the document instead of a URL)</span></label
      >
      <textarea
        id="site-openapi-json"
        v-model="form.openapiJson"
        data-testid="openapi-json"
        rows="4"
        placeholder='{"openapi":"3.0.0","info":{"title":"x","version":"1"},"servers":[{"url":"http://localhost:4001"}],"paths":{"/rest/products/search":{"get":{"parameters":[{"name":"q","in":"query","schema":{"type":"string"}}],"responses":{"200":{"description":"ok"}}}}}}'
        class="textarea-soft"
      />
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-zap-fe-seed-path" class="text-caption-md font-medium text-ink"
        >ZAP frontend seed path <span class="text-sale">*</span></label
      >
      <input
        id="site-zap-fe-seed-path"
        v-model="form.zapFeSeedPath"
        data-testid="zap-fe-seed-path"
        type="text"
        placeholder="/"
        required
        class="input-pill"
      />
      <p class="text-caption-sm text-mute">
        Where the ZAP spider starts crawling, relative to the front base URL. "/" is fine for most
        sites; SPAs with hash routing use e.g. "/#/". With auth headers, point it at a page only a
        logged-in user can reach (e.g. "/dashboard") so sakuda can warn when the session was not
        accepted.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-discovery-seed-paths" class="text-caption-md font-medium text-ink"
        >Discovery seed paths
        <span class="text-mute">(optional — empty uses the ZAP frontend seed path)</span></label
      >
      <textarea
        id="site-discovery-seed-paths"
        v-model="form.discoverySeedPaths"
        data-testid="discovery-seed-paths"
        rows="3"
        placeholder="/#/&#10;/#/search?q=apple&#10;/#/basket&#10;/profile"
        class="textarea-soft"
      />
      <p class="text-caption-sm text-mute">
        Where "Discover URLs" starts, one path per line; each gets its own Ajax spider run. List the
        pages of your app (hash routes are fine) so the APIs behind them are found.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-exclude-paths" class="text-caption-md font-medium text-ink"
        >Exclude paths</label
      >
      <textarea
        id="site-exclude-paths"
        v-model="form.excludePaths"
        data-testid="exclude-paths"
        rows="4"
        class="textarea-soft"
      />
      <p class="text-caption-sm text-mute">
        Paths no engine may touch — one glob per line, "*" spans "/". Typical: "/logout",
        "/auth/refresh", "*/send-code" (anything that ends the session, sends mail, or deletes
        data).
      </p>
    </div>

    <div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
      <div class="flex flex-col gap-2">
        <label for="site-nuclei-rate-limit" class="text-caption-md font-medium text-ink"
          >Nuclei rate limit</label
        >
        <input
          id="site-nuclei-rate-limit"
          v-model.number="form.nucleiRateLimit"
          data-testid="nuclei-rate-limit"
          type="number"
          required
          min="1"
          max="1000"
          class="input-pill"
        />
      </div>
      <div class="flex flex-col gap-2">
        <label for="site-zap-api-max-minutes" class="text-caption-md font-medium text-ink"
          >ZAP API max minutes</label
        >
        <input
          id="site-zap-api-max-minutes"
          v-model.number="form.zapApiMaxMinutes"
          data-testid="zap-api-max-minutes"
          type="number"
          required
          min="1"
          max="600"
          class="input-pill"
        />
      </div>
      <div class="flex flex-col gap-2">
        <label for="site-zap-fe-spider-max-minutes" class="text-caption-md font-medium text-ink"
          >ZAP frontend spider max minutes</label
        >
        <input
          id="site-zap-fe-spider-max-minutes"
          v-model.number="form.zapFeSpiderMaxMinutes"
          data-testid="zap-fe-spider-max-minutes"
          type="number"
          required
          min="1"
          max="120"
          class="input-pill"
        />
      </div>
    </div>

    <div v-if="requiresConfirmation" class="card flex items-start gap-3">
      <input
        id="site-non-local-confirm"
        v-model="form.nonLocalConfirmed"
        data-testid="non-local-confirm"
        type="checkbox"
        class="mt-1"
      />
      <label for="site-non-local-confirm" class="text-caption-md text-ink">
        The target host is not local. I confirm I am authorized to scan it.
      </label>
    </div>

    <div class="card flex flex-col gap-2">
      <div class="flex items-start gap-3">
        <input
          id="site-allow-mutating-requests"
          v-model="form.allowMutatingRequests"
          data-testid="allow-mutating-requests"
          type="checkbox"
          class="mt-1"
        />
        <label for="site-allow-mutating-requests" class="text-caption-md font-medium text-ink">
          Active injection checks (sends attack payloads; may modify data)
        </label>
      </div>
      <p class="text-caption-sm text-mute">
        Off (default): passive and signature checks only — nothing that changes state. On: nuclei
        also runs its DAST templates (SQLi, LFI, SSTI, SSRF, …) against saved targets that have
        query parameters, e.g. "/search?q=". Only enable this for an environment you own and can
        reset; it may corrupt or delete data.
      </p>

      <div class="flex flex-col gap-2 border-t border-hairline-soft pt-3">
        <span class="text-caption-md font-medium text-ink">Extra risk template groups</span>
        <p class="text-caption-sm text-mute">
          Normally excluded even in active mode. Each needs Active injection checks on to take
          effect.
        </p>
        <label
          v-for="group in RISK_TAG_GROUPS"
          :key="group.tag"
          class="flex items-start gap-3"
          :class="{ 'opacity-50': !form.allowMutatingRequests }"
        >
          <input
            v-model="form.nucleiEnabledRiskTags"
            :value="group.tag"
            :data-testid="`risk-tag-${group.tag}`"
            type="checkbox"
            :disabled="!form.allowMutatingRequests"
            class="mt-1"
          />
          <span class="text-caption-sm">
            <span class="font-medium text-ink">{{ group.label }}</span>
            <span class="text-mute"> — {{ group.help }}</span>
          </span>
        </label>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <span class="text-caption-md font-medium text-ink">Headers</span>

      <div v-if="isEditMode && !headersEditable" class="flex flex-col gap-3">
        <ul class="flex flex-wrap gap-2">
          <li
            v-for="headerName in props.initial?.headerNames ?? []"
            :key="headerName"
            data-testid="header-chip"
            class="badge"
          >
            {{ headerName }}
          </li>
          <li v-if="!props.initial?.headerNames.length" class="text-caption-sm text-mute">
            No headers configured.
          </li>
        </ul>
        <button
          type="button"
          data-testid="replace-headers"
          class="btn-secondary self-start"
          @click="startReplacingHeaders"
        >
          Replace headers
        </button>
      </div>

      <div v-else data-testid="headers-editor" class="flex flex-col gap-3">
        <div
          v-for="(row, index) in headerRows"
          :key="index"
          class="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <input
            v-model="row.name"
            :data-testid="`header-name-${index}`"
            type="text"
            placeholder="Header name"
            class="input-pill"
          />
          <input
            v-model="row.value"
            :data-testid="`header-value-${index}`"
            type="password"
            autocomplete="off"
            placeholder="Header value"
            class="input-pill"
          />
          <button
            type="button"
            :data-testid="`remove-header-${index}`"
            class="btn-secondary"
            @click="removeHeaderRow(index)"
          >
            Remove
          </button>
        </div>
        <button
          type="button"
          data-testid="add-header"
          class="btn-secondary self-start"
          @click="addHeaderRow"
        >
          Add header
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <span class="text-caption-md font-medium text-ink">Browser storage</span>
      <p class="text-caption-sm text-mute">
        Values seeded into ZAP's browser (localStorage / sessionStorage / cookie) before the Ajax
        spider crawls, so a single-page app renders as logged in. Headers authenticate requests;
        this authenticates the UI. Stored encrypted, never shown again.
      </p>

      <div v-if="isEditMode && !storageEditable" class="flex flex-col gap-3">
        <ul class="flex flex-wrap gap-2">
          <li
            v-for="item in props.initial?.browserStorageNames ?? []"
            :key="`${item.kind}:${item.name}`"
            data-testid="storage-chip"
            class="badge"
          >
            {{ item.kind }}:{{ item.name }}
          </li>
          <li v-if="!props.initial?.browserStorageNames.length" class="text-caption-sm text-mute">
            No browser storage configured.
          </li>
        </ul>
        <button
          type="button"
          data-testid="replace-storage"
          class="btn-secondary self-start"
          @click="startReplacingStorage"
        >
          Replace browser storage
        </button>
      </div>

      <div v-else data-testid="storage-editor" class="flex flex-col gap-3">
        <div
          v-for="(row, index) in storageRows"
          :key="index"
          class="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <select v-model="row.kind" :data-testid="`storage-kind-${index}`" class="input-pill">
            <option v-for="kind in BROWSER_STORAGE_KINDS" :key="kind" :value="kind">
              {{ kind }}
            </option>
          </select>
          <input
            v-model="row.name"
            :data-testid="`storage-name-${index}`"
            type="text"
            placeholder="Key / cookie name"
            class="input-pill"
          />
          <input
            v-model="row.value"
            :data-testid="`storage-value-${index}`"
            type="password"
            autocomplete="off"
            placeholder="Value"
            class="input-pill"
          />
          <button
            type="button"
            :data-testid="`remove-storage-${index}`"
            class="btn-secondary"
            @click="removeStorageRow(index)"
          >
            Remove
          </button>
        </div>
        <button
          type="button"
          data-testid="add-storage"
          class="btn-secondary self-start"
          @click="addStorageRow"
        >
          Add item
        </button>
      </div>
    </div>

    <p v-if="errorMessage" data-testid="form-error" class="text-sale text-body-md">
      {{ errorMessage }}
    </p>

    <button
      type="submit"
      data-testid="submit"
      class="btn-primary self-start"
      :disabled="!canSubmit"
    >
      {{ isEditMode ? 'Save changes' : 'Create site' }}
    </button>
  </form>
</template>
