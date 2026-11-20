<script lang="ts">
  import { onMount } from 'svelte';
  import { DEFAULT_SETTINGS, readSettings, writeSettings } from '../settings';
  import type { Settings } from '../settings';
  import Options from './Options.svelte';
  import PageHeading from './PageHeading.svelte';
  import Picker from './Picker.svelte';
  // Whether this extension page is the settings panel
  const options = location.pathname.endsWith('options.html');
  // The saved theme choice shared by the picker and settings pages
  let theme = $state<Settings['theme']>(DEFAULT_SETTINGS.theme);
  // The message displayed if the theme preference cannot be saved
  let themeError = $state('');

  // Let CSS resolve the system preference and style native controls as well
  $effect(() => {
    document.documentElement.dataset.theme = theme;
  });

  onMount(() => {
    // Apply theme changes made from another open extension page
    const syncTheme = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area !== 'local' || !changes.settings) return;
      // The new saved preference, or defaults if settings have been removed
      const saved = changes.settings.newValue as Partial<Settings> | undefined;
      theme = saved?.theme ?? DEFAULT_SETTINGS.theme;
    };
    chrome.storage.onChanged.addListener(syncTheme);
    void readSettings()
      .then((saved) => {
        theme = saved.theme;
      })
      .catch(() => {
        themeError = 'Could not read the saved theme';
      });
    return () => chrome.storage.onChanged.removeListener(syncTheme);
  });

  // Save the theme separately so domain and transfer preferences stay intact
  async function changeTheme(event: Event): Promise<void> {
    // The theme selected through the three-option native control
    const choice = (event.currentTarget as HTMLSelectElement)
      .value as Settings['theme'];
    try {
      theme = (await writeSettings({ theme: choice })).theme;
      themeError = '';
    } catch {
      themeError = 'Could not save the theme';
    }
  }
</script>

<main>
  <div class="page-intro">
    <label class="theme-control">
      Theme
      <select value={theme} onchange={changeTheme}>
        <option value="system">System</option>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </label>
    <PageHeading
      title={options ? 'Extension Settings' : 'Chromium Session Transfer'}
      subtitle={options
        ? 'Chromium Session Transfer'
        : 'Transfer tabs to another Chromium browser'}
    />
    {#if themeError}<p role="status" class="error">{themeError}</p>{/if}
  </div>
  {#if options}<Options />{:else}<Picker />{/if}
</main>

<style>
  /* Separate the heading, theme control, and any error from the first panel */
  .page-intro {
    margin-bottom: 32px;
  }
</style>
