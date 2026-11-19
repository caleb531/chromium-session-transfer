<script lang="ts">
  import { onMount } from 'svelte';
  import {
    DEFAULT_SETTINGS,
    isPattern,
    readSettings,
    writeSettings,
  } from '../settings';
  import type { Settings } from '../settings';

  // The preferences edited in this options page
  let settings = $state<Settings>({ ...DEFAULT_SETTINGS, patterns: [] });
  // The domain pattern being added or edited
  let pattern = $state('');
  // The original pattern when updating an existing entry
  let editing = $state<string | null>(null);
  // The latest validation or persistence result
  let message = $state('');
  // Whether the latest result represents an error
  let error = $state(false);
  // Whether the saved preferences have finished loading
  let ready = $state(false);
  // The extension ID required to register the native helper
  const extensionId = chrome.runtime.id;

  onMount(() => {
    void readSettings()
      .then((saved) => {
        settings = saved;
        ready = true;
      })
      .catch(() => {
        message = 'Could not read settings';
        error = true;
      });
  });

  // Persist an edit and display a result without losing the current form
  async function save(next: Settings): Promise<void> {
    try {
      await writeSettings(next);
      settings = next;
      message = 'Settings saved';
      error = false;
    } catch {
      message = 'Could not save settings';
      error = true;
    }
  }

  // Add or update one normalized Chrome host match pattern
  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    // The normalized host permission pattern entered by the user
    const value = pattern.trim().toLowerCase();
    if (!isPattern(value)) {
      message = 'Use a Chrome host pattern, e.g. https://*.example.com/*';
      error = true;
      return;
    }
    if (settings.patterns.includes(value) && value !== editing) {
      message = 'That pattern is already saved';
      error = true;
      return;
    }
    await save({
      ...settings,
      patterns: editing
        ? settings.patterns.map((entry) => (entry === editing ? value : entry))
        : [...settings.patterns, value],
    });
    if (!error) {
      pattern = '';
      editing = null;
    }
  }
</script>

<section class="panel">
  <h2>Transfer Behavior</h2>
  <label class="field">
    After a successful transfer
    <select
      disabled={!ready}
      value={settings.behavior}
      onchange={(event) =>
        save({
          ...settings,
          behavior: event.currentTarget.value as Settings['behavior'],
        })}
    >
      <option value="keep">Keep the original Brave tabs open</option>
      <option value="close">Close the original Brave tabs</option>
    </select>
  </label>
  <p class="muted">
    Brave tabs stay open if any part of the batch fails. Closing follows storage
    restoration and navigation; it does not prove the website accepted the
    login.
  </p>
</section>

<section class="panel">
  <h2>Saved domains</h2>
  <p class="muted">
    Matching tabs are preselected in the picker. Selecting a new website saves
    its host after you grant access. Chrome host permissions apply to all ports.
  </p>
  <form class="row wrap" onsubmit={submit}>
    <label class="field" style="flex: 1; min-width: 240px">
      Domain pattern
      <input
        type="text"
        bind:value={pattern}
        placeholder="https://*.example.com/*"
        required
        disabled={!ready}
      />
    </label>
    <button type="submit" class="primary" disabled={!ready}>
      {editing ? 'Update' : 'Add domain'}
    </button>
    {#if editing}<button
        type="button"
        onclick={() => {
          editing = null;
          pattern = '';
        }}
      >
        Cancel
      </button>{/if}
  </form>
  <div class="stack" style="margin-top: 20px">
    {#each settings.patterns as entry (entry)}
      <div class="row between wrap">
        <code>{entry}</code>
        <div class="actions">
          <button
            onclick={() => {
              editing = entry;
              pattern = entry;
            }}
          >
            Edit
          </button>
          <button
            class="danger"
            onclick={() =>
              save({
                ...settings,
                patterns: settings.patterns.filter((value) => value !== entry),
              })}
          >
            Delete
          </button>
        </div>
      </div>
    {:else}<p class="muted">
        No saved domains yet. Choose tabs to get started.
      </p>{/each}
  </div>
  <p class="muted">
    Deleting a pattern stops preselection; it does not revoke browser
    permissions. Manage granted access in Brave’s extension details.
  </p>
</section>

<section class="panel">
  <h2>Local helper</h2>
  <p>After building the project, register this extension with the helper:</p>
  <code>pnpm host:install {extensionId}</code>
  <p class="muted">
    Keep Chrome open and enable remote debugging at <code>
      chrome://inspect/#remote-debugging
    </code>. The helper runs only during transfers. No authentication data is
    saved in extension settings.
  </p>
  <small>Extension ID: {extensionId}</small>
</section>
{#if message}<p role="status" class={error ? 'error' : 'success'}>
    {message}
  </p>{/if}
