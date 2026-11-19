<script lang="ts">
  import { onMount } from 'svelte';
  import {
    DEFAULT_SETTINGS,
    matchesPattern,
    originPattern,
    readSettings,
    writeSettings,
  } from '../settings';
  import type { Settings } from '../settings';
  import { transferTabs } from '../transfer';
  import { cookiePermission } from '../../shared/sites';

  // The open HTTP(S) tabs eligible for a transfer
  let tabs = $state<chrome.tabs.Tab[]>([]);
  // The IDs explicitly selected in this picker
  let selected = $state<number[]>([]);
  // The preferences used to preselect tabs and choose closing behavior
  let settings = $state<Settings>({ ...DEFAULT_SETTINGS, patterns: [] });
  // The tab title or URL filter entered by the user
  let search = $state('');
  // Whether a transfer is currently reading or restoring storage
  let busy = $state(false);
  // Whether the initial tab list has loaded
  let ready = $state(false);
  // The current progress or completion message
  let message = $state('');
  // Whether the message describes a failed operation
  let error = $state(false);
  // Whether the most recent batch completed successfully
  let complete = $state(false);
  // The currently visible subset of the tab list
  const visible = $derived(
    tabs.filter((tab) =>
      `${tab.title} ${tab.url}`.toLowerCase().includes(search.toLowerCase()),
    ),
  );

  // Read live tabs and preselect sites matching the current saved patterns
  async function refresh(): Promise<void> {
    try {
      settings = await readSettings();
      tabs = (await chrome.tabs.query({})).filter(
        (tab) =>
          !tab.incognito &&
          tab.id !== undefined &&
          /^https?:\/\//.test(tab.url ?? ''),
      );
      selected = tabs
        .filter((tab) =>
          settings.patterns.some((pattern) =>
            matchesPattern(tab.url!, pattern),
          ),
        )
        .map((tab) => tab.id!);
      ready = true;
    } catch {
      message = 'Could not read open tabs';
      error = true;
    }
  }
  onMount(() => {
    void refresh();
  });

  // Ask before closing the page that owns an in-progress native transfer
  function guardTransfer(event: BeforeUnloadEvent): void {
    if (!busy) return;
    event.preventDefault();
    event.returnValue = '';
  }

  // Update a single checkbox without changing the rest of the selection
  function toggle(id: number): void {
    selected = selected.includes(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id];
  }

  // Request host access during the click gesture, then capture and send the
  // batch
  async function send(): Promise<void> {
    // The snapshot of the user's selection at the start of this operation
    const chosen = tabs.filter((tab) => selected.includes(tab.id!));
    // The host permission patterns needed for the selected origins
    const patterns = [...new Set(chosen.map((tab) => originPattern(tab.url!)))];
    busy = true;
    error = false;
    complete = false;
    message = 'Requesting access to the selected websites…';
    try {
      if (
        !(await chrome.permissions.request({
          origins: [
            ...new Set(chosen.map((tab) => cookiePermission(tab.url!))),
          ],
        }))
      ) {
        throw new Error(
          'Website access was not granted; nothing was transferred',
        );
      }
      // The current options reread so another options tab cannot lose its edits
      const latest = await readSettings();
      // The selected hosts not already covered by a saved wildcard pattern
      const additions = patterns.filter(
        (pattern) =>
          !latest.patterns.some((saved) =>
            matchesPattern(pattern.replace(/\*$/, ''), saved),
          ),
      );
      settings = {
        ...latest,
        patterns: [...new Set([...latest.patterns, ...additions])],
      };
      await writeSettings(settings);
      // The helper's credential-free completion response
      const result = await transferTabs(chosen, (progress) => {
        message = progress;
      });
      if (!result.ok) throw new Error(result.message);
      message = result.message;
      complete = true;
      if (settings.behavior === 'close') {
        // The source tabs that still point at their originally selected pages
        const closable: number[] = [];
        for (const tab of chosen) {
          try {
            if ((await chrome.tabs.get(tab.id!)).url === tab.url)
              closable.push(tab.id!);
          } catch {
            /* A tab already closed by the user needs no further action */
          }
        }
        try {
          await chrome.tabs.remove(closable);
        } catch {
          message += ' Some Brave tabs could not be closed.';
        }
      }
      await refresh();
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Transfer failed';
      error = true;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onbeforeunload={guardTransfer} />

<section class="panel">
  <div class="row between wrap">
    <div>
      <h2>Your tabs, your call.</h2>
      <p class="muted">Choose the pages to continue in Chrome.</p>
    </div>
    <button disabled={busy} onclick={() => chrome.runtime.openOptionsPage()}>
      Settings
    </button>
  </div>
  <label class="field">
    Find a tab
    <input
      type="text"
      bind:value={search}
      placeholder="Search by title or URL"
      disabled={busy}
    />
  </label>
  <div class="row between wrap" style="margin-top: 16px">
    <small>{selected.length} selected · {tabs.length} available</small>
    <div class="actions">
      <button
        disabled={busy || !ready}
        onclick={() => {
          selected = [
            ...new Set([...selected, ...visible.map((tab) => tab.id!)]),
          ];
        }}
      >
        Select visible
      </button>
      <button
        disabled={busy}
        onclick={() => {
          selected = [];
        }}
      >
        Clear
      </button>
      <button disabled={busy} onclick={refresh}>Refresh</button>
    </div>
  </div>
  <div style="margin-top: 12px">
    {#each visible as tab (tab.id)}
      <label class="tab row">
        <input
          type="checkbox"
          checked={selected.includes(tab.id!)}
          disabled={busy}
          onchange={() => toggle(tab.id!)}
        />
        <span class="tab-text">
          <span class="tab-title">
            {tab.title || new URL(tab.url!).hostname}
          </span>
          <span class="tab-url">{tab.url}</span>
        </span>
        {#if tab.discarded}<small>Unloaded</small>{/if}
      </label>
    {:else}<p class="muted">
        {ready ? 'No matching tabs.' : 'Reading open tabs…'}
      </p>{/each}
  </div>
</section>

<p class="notice">
  Cookies, localStorage, IndexedDB, and each tab’s sessionStorage will be copied
  for the selected top-level origins. This replaces stored data for those
  origins in Chrome. Close existing Chrome tabs for those origins first. SSO
  discovery and other embedded origins are outside this MVP.
</p>
<p class="muted">
  Brave may request parent-domain access to include shared cookies (for example, <code>
    *.netsuite.com
  </code>). Only cookies applicable to the selected hosts and storage for the
  selected origins are exported.
</p>
<div class="row between wrap">
  <small>
    {settings.behavior === 'close'
      ? 'Close Brave tabs after success'
      : 'Keep Brave tabs after success'}
  </small>
  <button
    class="primary"
    disabled={busy || !ready || !selected.length}
    onclick={send}
  >
    {busy
      ? 'Transferring…'
      : `Send ${selected.length || ''} ${selected.length === 1 ? 'tab' : 'tabs'} to Chrome`}
  </button>
</div>
{#if message}<p
    role="status"
    aria-live="polite"
    class={error ? 'error' : complete ? 'success' : 'notice'}
  >
    {message}
  </p>{/if}
{#if busy}<p class="muted">
    Keep this picker open until the transfer finishes.
  </p>{/if}
