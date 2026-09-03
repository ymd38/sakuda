<script setup lang="ts">
import SiteForm from '~/components/site/SiteForm.vue'
import type { SiteUpdateInput } from '#shared/schemas/site'
import type { SitePublic } from '#shared/types/api'

const submitting = ref(false)
const errorMessage = ref<string | null>(null)

async function handleSubmit(payload: SiteUpdateInput) {
  submitting.value = true
  errorMessage.value = null
  try {
    const site = await $fetch<SitePublic>('/api/sites', { method: 'POST', body: payload })
    await navigateTo(`/sites/${site.id}`)
  } catch (err) {
    errorMessage.value = toApiErrorMessage(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="font-display text-heading-xl uppercase">New site</h1>
    <SiteForm
      class="mt-6"
      :submitting="submitting"
      :error-message="errorMessage"
      cancel-to="/"
      @submit="handleSubmit"
    />
  </div>
</template>
