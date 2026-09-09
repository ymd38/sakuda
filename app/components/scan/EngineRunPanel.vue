<script setup lang="ts">
import type { EngineRunView, FindingView } from '#shared/types/api'
import EngineRunTiming from './EngineRunTiming.vue'
import FindingList from './FindingList.vue'
import SeverityCountCards from './SeverityCountCards.vue'

const MAX_LIST_ITEMS = 60

const props = withDefaults(
  defineProps<{ run: EngineRunView; findings: FindingView[]; serverNow?: string | null }>(),
  { serverNow: null },
)

const engineFindings = computed(() => props.findings.filter((f) => f.engine === props.run.engine))

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item): item is string => typeof item === 'string')
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

interface MetaValueRow {
  kind: 'value'
  key: string
  value: string
}
interface MetaListRow {
  kind: 'list'
  key: string
  items: string[]
  moreCount: number
}
interface MetaObjectRow {
  kind: 'object'
  key: string
  rows: { key: string; value: string }[]
}
type MetaRow = MetaValueRow | MetaListRow | MetaObjectRow

/** Renders `run.meta` generically since each engine writes different keys
 * (see server/engines/{nuclei,zap}/*): primitives print as-is, string
 * arrays get capped so a large URL list can't blow up the page, one-level
 * objects (e.g. `stats`, `alertCounts`) become a nested key/value block, and
 * anything deeper or of another shape is skipped rather than guessed at. */
function buildMetaRows(meta: Record<string, unknown>): MetaRow[] {
  const rows: MetaRow[] = []
  for (const [key, value] of Object.entries(meta)) {
    if (isPrimitive(value)) {
      rows.push({ kind: 'value', key, value: String(value) })
    } else if (isStringArray(value)) {
      rows.push({
        kind: 'list',
        key,
        items: value.slice(0, MAX_LIST_ITEMS),
        moreCount: Math.max(0, value.length - MAX_LIST_ITEMS),
      })
    } else if (isPlainObject(value)) {
      const nested = Object.entries(value)
        .filter((entry): entry is [string, string | number | boolean] => isPrimitive(entry[1]))
        .map(([k, v]) => ({ key: k, value: String(v) }))
      rows.push({ kind: 'object', key, rows: nested })
    }
  }
  return rows
}

const metaRows = computed(() => buildMetaRows(props.run.meta))
</script>

<template>
  <section class="card flex flex-col gap-4" data-testid="engine-run-panel">
    <header class="flex flex-col gap-2">
      <h2 class="font-display text-heading-md uppercase">{{ ENGINE_LABELS[run.engine] }}</h2>
      <EngineRunTiming
        :engine="run.engine"
        :run="run"
        :server-now="serverNow"
        :show-label="false"
      />
    </header>

    <SeverityCountCards :counts="run.counts" />

    <ul v-if="run.warnings.length > 0" class="flex flex-col gap-2">
      <li
        v-for="(warning, index) in run.warnings"
        :key="index"
        data-testid="engine-warning"
        class="border-sale bg-soft-cloud text-caption-md text-ink border-l-4 px-4 py-2"
      >
        {{ warning }}
      </li>
    </ul>

    <pre
      v-if="run.error"
      data-testid="engine-error"
      class="bg-soft-cloud text-caption-md text-sale overflow-x-auto p-4 whitespace-pre-wrap"
      >{{ run.error }}</pre>

    <details class="text-caption-md">
      <summary class="text-ink cursor-pointer font-medium">Metadata</summary>
      <table class="mt-2 w-full text-left" data-testid="engine-meta-table">
        <tbody>
          <tr>
            <td class="text-mute pr-4 align-top">Exit code</td>
            <td>{{ run.exitCode ?? '—' }}</td>
          </tr>
          <tr v-if="run.signal">
            <td class="text-mute pr-4 align-top">Signal</td>
            <td>{{ run.signal }}</td>
          </tr>
          <template v-for="row in metaRows" :key="row.key">
            <tr v-if="row.kind === 'value'">
              <td class="text-mute pr-4 align-top">{{ row.key }}</td>
              <td>{{ row.value }}</td>
            </tr>
            <tr v-else-if="row.kind === 'list'">
              <td class="text-mute pr-4 align-top">{{ row.key }}</td>
              <td>
                <ul>
                  <li v-for="item in row.items" :key="item" class="break-all">{{ item }}</li>
                </ul>
                <p v-if="row.moreCount > 0" class="text-mute">… {{ row.moreCount }} more</p>
              </td>
            </tr>
            <tr v-else>
              <td class="text-mute pr-4 align-top">{{ row.key }}</td>
              <td>
                <table>
                  <tbody>
                    <tr v-for="nested in row.rows" :key="nested.key">
                      <td class="text-mute pr-4">{{ nested.key }}</td>
                      <td>{{ nested.value }}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </details>

    <FindingList :findings="engineFindings" />
  </section>
</template>
