<script setup lang="ts">
import DiscoveryPanel from '~/components/site/DiscoveryPanel.vue'
import SiteForm from '~/components/site/SiteForm.vue'
import type { SiteUpdateInput } from '#shared/schemas/site'
import type { SitePublic } from '#shared/types/api'

const route = useRoute()
// `route.params.id` is `string | string[]` generically; this route only has
// a single `[id]` segment, so it is always a plain string at runtime.
const rawSiteId = route.params.id
const siteId = Array.isArray(rawSiteId) ? (rawSiteId[0] ?? '') : rawSiteId

const { data: site, error: loadError } = await useFetch<SitePublic>(`/api/sites/${siteId}`)

const submitting = ref(false)
const errorMessage = ref<string | null>(null)

/** The discovery panel saves and removes targets through its own endpoints
 * and hands the updated site back; swapping our copy keeps the panel's saved
 * badges and the form's Target paths in step without a refetch. */
function handleTargetsChanged(updated: SitePublic) {
  site.value = updated
}

async function handleSubmit(payload: SiteUpdateInput) {
  submitting.value = true
  errorMessage.value = null
  try {
    await $fetch<SitePublic>(`/api/sites/${siteId}`, { method: 'PUT', body: payload })
    await navigateTo(`/sites/${siteId}`)
  } catch (err) {
    errorMessage.value = toApiErrorMessage(err)
  } finally {
    submitting.value = false
  }
}

async function handleDelete() {
  if (!window.confirm('Delete this site? This cannot be undone.')) return
  try {
    await $fetch(`/api/sites/${siteId}`, { method: 'DELETE' })
    await navigateTo('/')
  } catch (err) {
    errorMessage.value = toApiErrorMessage(err)
  }
}
</script>

<template>
  <div>
    <h1 class="font-display text-heading-xl uppercase">Edit site</h1>

    <p v-if="loadError" class="mt-6 text-sale text-body-md">{{ toApiErrorMessage(loadError) }}</p>

    <template v-else-if="site">
      <section class="card mt-6 flex flex-col gap-4" data-testid="targets-section">
        <h2 class="font-display text-heading-md uppercase">Targets</h2>
        <p class="text-caption-sm text-mute">
          One saved list, read by every engine (Nuclei, ZAP Frontend, ZAP API, dalfox). Discover
          URLs with ZAP's spiders and katana, review them, and save the ones you want scanned;
          remove a saved one here. The same list is editable as text under Target paths below.
        </p>
        <DiscoveryPanel
          :site="site"
          @saved="handleTargetsChanged"
          @removed="handleTargetsChanged"
        />
      </section>

      <SiteForm
        class="mt-6"
        :initial="site"
        :submitting="submitting"
        :error-message="errorMessage"
        :cancel-to="`/sites/${siteId}`"
        @submit="handleSubmit"
      />
      <button type="button" class="btn-secondary mt-6" @click="handleDelete">Delete site</button>
    </template>
  </div>
</template>
