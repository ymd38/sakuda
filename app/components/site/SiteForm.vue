<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Header } from '#shared/schemas/headers'
import type { SiteInput } from '#shared/schemas/site'
import type { SitePublic } from '#shared/types/api'

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
  excludePaths: props.initial?.excludePaths ?? '',
  nucleiRateLimit: props.initial?.nucleiRateLimit ?? 50,
  zapApiMaxMinutes: props.initial?.zapApiMaxMinutes ?? 45,
  zapFeSpiderMaxMinutes: props.initial?.zapFeSpiderMaxMinutes ?? 5,
  nonLocalConfirmed: props.initial?.nonLocalConfirmed ?? false,
})

// `shared/utils/localHost.ts` — auto-imported from `shared/utils/*`.
const requiresConfirmation = computed(() =>
  siteRequiresConfirmation(form.frontBaseUrl, form.apiBaseUrl || null),
)

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

function hasContent(row: { name: string; value: string }): boolean {
  return row.name.trim() !== '' || row.value.trim() !== ''
}

function toHeader(row: { name: string; value: string }): Header {
  return { name: row.name, value: row.value }
}

const canSubmit = computed(
  () => !props.submitting && (!requiresConfirmation.value || form.nonLocalConfirmed),
)

function buildPayload(): SiteInput {
  const base = {
    name: form.name,
    frontBaseUrl: form.frontBaseUrl,
    apiBaseUrl: emptyToNull(form.apiBaseUrl),
    nucleiPaths: form.nucleiPaths,
    openapiUrl: emptyToNull(form.openapiUrl),
    openapiJson: emptyToNull(form.openapiJson),
    zapFeSeedPath: form.zapFeSeedPath,
    excludePaths: form.excludePaths,
    nucleiRateLimit: form.nucleiRateLimit,
    zapApiMaxMinutes: form.zapApiMaxMinutes,
    zapFeSpiderMaxMinutes: form.zapFeSpiderMaxMinutes,
    nonLocalConfirmed: form.nonLocalConfirmed,
  }
  if (!headersEditable.value) return base
  return { ...base, headers: headerRows.filter(hasContent).map(toHeader) }
}

function handleSubmit() {
  if (!canSubmit.value) return
  emit('submit', buildPayload())
}
</script>

<template>
  <form data-testid="site-form" class="flex flex-col gap-6" @submit.prevent="handleSubmit">
    <div class="flex flex-col gap-2">
      <label for="site-name" class="text-caption-md font-medium text-ink">Name</label>
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
        >Front base URL</label
      >
      <input
        id="site-front-base-url"
        v-model="form.frontBaseUrl"
        data-testid="front-base-url"
        type="text"
        placeholder="https://example.com"
        required
        class="input-pill"
      />
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
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-nuclei-paths" class="text-caption-md font-medium text-ink"
        >Nuclei paths</label
      >
      <textarea
        id="site-nuclei-paths"
        v-model="form.nucleiPaths"
        data-testid="nuclei-paths"
        rows="4"
        class="textarea-soft"
      />
      <p class="text-caption-sm text-mute">
        One path per line, "#" comments, prefix "api:" for apiBaseUrl.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-openapi-url" class="text-caption-md font-medium text-ink"
        >OpenAPI URL (optional)</label
      >
      <input
        id="site-openapi-url"
        v-model="form.openapiUrl"
        data-testid="openapi-url"
        type="text"
        class="input-pill"
      />
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-openapi-json" class="text-caption-md font-medium text-ink"
        >OpenAPI JSON (optional)</label
      >
      <textarea
        id="site-openapi-json"
        v-model="form.openapiJson"
        data-testid="openapi-json"
        rows="4"
        class="textarea-soft"
      />
    </div>

    <div class="flex flex-col gap-2">
      <label for="site-zap-fe-seed-path" class="text-caption-md font-medium text-ink"
        >ZAP frontend seed path</label
      >
      <input
        id="site-zap-fe-seed-path"
        v-model="form.zapFeSeedPath"
        data-testid="zap-fe-seed-path"
        type="text"
        required
        class="input-pill"
      />
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
      <p class="text-caption-sm text-mute">Glob per line, "*" spans "/".</p>
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
