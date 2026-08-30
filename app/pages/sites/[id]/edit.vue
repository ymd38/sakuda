<script setup lang="ts">
import SiteForm from '~/components/site/SiteForm.vue'
import type { SiteInput } from '#shared/schemas/site'
import type { SitePublic } from '#shared/types/api'

const route = useRoute()
// `route.params.id` is `string | string[]` generically; this route only has
// a single `[id]` segment, so it is always a plain string at runtime.
const rawSiteId = route.params.id
const siteId = Array.isArray(rawSiteId) ? (rawSiteId[0] ?? '') : rawSiteId

const { data: site, error: loadError } = await useFetch<SitePublic>(`/api/sites/${siteId}`)

const submitting = ref(false)
const errorMessage = ref<string | null>(null)

async function handleSubmit(payload: SiteInput) {
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
      <SiteForm
        class="mt-6"
        :initial="site"
        :submitting="submitting"
        :error-message="errorMessage"
        @submit="handleSubmit"
      />
      <button type="button" class="btn-secondary mt-6" @click="handleDelete">Delete site</button>
    </template>
  </div>
</template>
