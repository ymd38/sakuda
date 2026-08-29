<template>
  <div class="min-h-screen bg-canvas text-ink">
    <header class="h-14 border-b border-hairline-soft">
      <div class="mx-auto flex h-full w-full max-w-page items-center justify-between px-6">
        <NuxtLink to="/" class="font-display text-heading-lg uppercase tracking-wide"
          >sakuda</NuxtLink
        >
        <NuxtLink to="/sites/new" class="btn-secondary h-10 px-6 text-button-sm">New site</NuxtLink>
      </div>
    </header>
    <main class="mx-auto w-full max-w-page px-6 py-10"><slot /></main>
  </div>
</template>
