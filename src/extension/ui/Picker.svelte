<script lang="ts">
  import { onMount, tick } from 'svelte';
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
  import { describeError } from '../../shared/errors';
  import { BROWSERS } from '../../shared/browsers';
  import type { BrowserId } from '../../shared/browsers';

  // The open HTTP(S) tabs eligible for a transfer
  let tabs = $state<chrome.tabs.Tab[]>([]);
  // The IDs explicitly selected in this picker
  let selected = $state<number[]>([]);
  // The preferences used to preselect tabs and choose closing behavior
  let settings = $state<Settings>({ ...DEFAULT_SETTINGS, patterns: [] });
  // The destination shown in action labels and storage replacement notices
  const destination = $derived(BROWSERS[settings.destination]);
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
  // The rendered status message to reveal and focus after a transfer error
  let statusElement = $state<HTMLParagraphElement>();
  // Whether the most recent batch completed successfully
  let complete = $state(false);
  // The last clicked tab used as the anchor for a visible selection range
  let anchor: number | null = null;
  // The latest query number prevents older tab snapshots replacing newer ones
  let refreshId = 0;
  // The currently visible subset of the tab list
  const visible = $derived(
    tabs.filter((tab) =>
      `${tab.title} ${tab.url}`.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  // Whether every tab in the filtered list is currently selected
  const allVisible = $derived(
    visible.length > 0 && visible.every((tab) => selected.includes(tab.id!)),
  );
  // Whether the select-all control should display a partially selected state
  const someVisible = $derived(
    visible.some((tab) => selected.includes(tab.id!)) && !allVisible,
  );

  // Update live tabs while retaining choices for pages that keep their origin
  async function refresh(): Promise<void> {
    if (busy) return;
    // The query number checked again before applying this asynchronous result
    const requestId = ++refreshId;
    try {
      // The saved patterns used only to preselect new or newly navigated origins
      const saved = await readSettings();
      // The eligible tabs in window order and then their visual tab-strip order
      const current = (await chrome.tabs.query({}))
        .filter(
          (tab) =>
            !tab.incognito &&
            tab.id !== undefined &&
            /^https?:\/\//.test(tab.url ?? ''),
        )
        .sort(
          (left, right) =>
            left.windowId - right.windowId || left.index - right.index,
        );
      if (requestId !== refreshId || busy) return;
      // The old origins distinguish changed pages from simple title updates
      const previous = new Map(
        tabs.map((tab) => [tab.id!, new URL(tab.url!).origin]),
      );
      selected = current
        .filter((tab) =>
          previous.get(tab.id!) === new URL(tab.url!).origin
            ? selected.includes(tab.id!)
            : saved.patterns.some((pattern) =>
                matchesPattern(tab.url!, pattern),
              ),
        )
        .map((tab) => tab.id!);
      if (
        anchor !== null &&
        !current.some(
          (tab) =>
            tab.id === anchor &&
            previous.get(anchor) === new URL(tab.url!).origin,
        )
      )
        anchor = null;
      tabs = current;
      settings = saved;
      ready = true;
    } catch (cause) {
      if (requestId !== refreshId || busy) return;
      console.error(
        '[chromium-session-transfer] Could not refresh tabs',
        cause,
      );
      message = `Could not read open tabs: ${describeError(cause)}`;
      error = true;
    }
  }
  onMount(() => {
    // The pending update coalesces bursts of tab events into one fresh query
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Schedule a list update without changing the batch during a transfer
    const scheduleRefresh = (): void => {
      if (busy) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
      }, 100);
    };
    // Ignore updates such as favicons that do not affect the displayed list
    const updated = (_id: number, changes: chrome.tabs.OnUpdatedInfo): void => {
      if (
        changes.url !== undefined ||
        changes.title !== undefined ||
        changes.discarded !== undefined
      )
        scheduleRefresh();
    };
    chrome.tabs.onCreated.addListener(scheduleRefresh);
    chrome.tabs.onRemoved.addListener(scheduleRefresh);
    chrome.tabs.onMoved.addListener(scheduleRefresh);
    chrome.tabs.onAttached.addListener(scheduleRefresh);
    chrome.tabs.onDetached.addListener(scheduleRefresh);
    chrome.tabs.onReplaced.addListener(scheduleRefresh);
    chrome.tabs.onUpdated.addListener(updated);
    void refresh();
    return () => {
      clearTimeout(timer);
      refreshId++;
      chrome.tabs.onCreated.removeListener(scheduleRefresh);
      chrome.tabs.onRemoved.removeListener(scheduleRefresh);
      chrome.tabs.onMoved.removeListener(scheduleRefresh);
      chrome.tabs.onAttached.removeListener(scheduleRefresh);
      chrome.tabs.onDetached.removeListener(scheduleRefresh);
      chrome.tabs.onReplaced.removeListener(scheduleRefresh);
      chrome.tabs.onUpdated.removeListener(updated);
    };
  });

  // Ask before closing the page that owns an in-progress native transfer
  function guardTransfer(event: BeforeUnloadEvent): void {
    if (!busy) return;
    event.preventDefault();
    event.returnValue = '';
  }

  // Apply a checkbox state while retaining selected tabs outside the given set
  function setSelection(ids: number[], checked: boolean): void {
    selected = checked
      ? [...new Set([...selected, ...ids])]
      : selected.filter((id) => !ids.includes(id));
  }

  // Select one row or apply its checkbox state to a Shift-clicked visible range
  function toggle(id: number, event: MouseEvent): void {
    // The checkbox state after the browser processes this click
    const checked = (event.currentTarget as HTMLInputElement).checked;
    // The last clicked row's position in the currently filtered list
    const start = visible.findIndex((tab) => tab.id === anchor);
    // The current row's position in the same displayed order
    const end = visible.findIndex((tab) => tab.id === id);
    setSelection(
      event.shiftKey && start !== -1
        ? visible
            .slice(Math.min(start, end), Math.max(start, end) + 1)
            .map((tab) => tab.id!)
        : [id],
      checked,
    );
    anchor = id;
  }

  // Bring the failed transfer back into view without hiding its original error
  async function revealTransferError(): Promise<void> {
    try {
      // The picker may have moved to another window while the helper was running
      const picker = await chrome.tabs.getCurrent();
      if (picker?.id === undefined)
        throw new Error('Could not identify the picker tab');
      if (busy || !error) return;
      await chrome.tabs.update(picker.id, { active: true });
      // Restore only minimized windows; preserve other window states
      const pickerWindow = await chrome.windows.get(picker.windowId);
      if (busy || !error) return;
      await chrome.windows.update(picker.windowId, {
        ...(pickerWindow.state === 'minimized'
          ? { state: 'normal' as const }
          : {}),
        focused: true,
      });
    } catch (cause) {
      console.error(
        '[chromium-session-transfer] Could not bring the picker forward',
        cause,
      );
    }
    // Wait for Svelte to render the error before moving focus and scrolling
    await tick();
    if (busy || !error) return;
    statusElement?.focus({ preventScroll: true });
    statusElement?.scrollIntoView({ block: 'center' });
  }

  // Handle native form submission, then request access and send the batch
  async function send(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || !ready || !selected.length) return;
    // The snapshot of the user's selection at the start of this operation
    const chosen = tabs.filter((tab) => selected.includes(tab.id!));
    // Lock the displayed destination so concurrent settings edits cannot reroute
    // authenticated data after the user clicks Send
    const target = settings.destination;
    // The host permission patterns needed for the selected origins
    const patterns = [...new Set(chosen.map((tab) => originPattern(tab.url!)))];
    busy = true;
    console.info(
      `[chromium-session-transfer] Starting transfer of ${chosen.length} tabs`,
    );
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
        destination: target,
        patterns: [...new Set([...latest.patterns, ...additions])],
      };
      await writeSettings({ patterns: settings.patterns });
      // The helper's credential-free completion response
      const result = await transferTabs(chosen, target, (progress) => {
        console.info('[chromium-session-transfer]', progress);
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
          } catch (cause) {
            console.warn(
              '[chromium-session-transfer] A source tab disappeared before closing',
              cause,
            );
          }
        }
        try {
          await chrome.tabs.remove(closable);
        } catch (cause) {
          console.error(
            '[chromium-session-transfer] Could not close source tabs',
            cause,
          );
          message += ' Some source tabs could not be closed.';
          error = true;
        }
      }
    } catch (cause) {
      console.error('[chromium-session-transfer] Transfer failed', cause);
      message = describeError(cause);
      error = true;
    } finally {
      busy = false;
      await refresh();
    }
    if (!busy && complete && !error && settings.closePickerOnSuccess) {
      try {
        // Closing after busy clears avoids the in-progress beforeunload guard
        const picker = await chrome.tabs.getCurrent();
        if (picker?.id === undefined)
          throw new Error('Could not identify the picker tab');
        // Keep the page if another transfer started while its tab was identified
        if (busy || !complete || error) return;
        await chrome.tabs.remove(picker.id);
      } catch (cause) {
        console.error(
          '[chromium-session-transfer] Could not close the picker',
          cause,
        );
        message = `Transfer completed, but the picker could not close: ${describeError(cause)}`;
        error = true;
      }
    }
    if (!busy && error) await revealTransferError();
  }
</script>

<svelte:window onbeforeunload={guardTransfer} />

<form class="panel" onsubmit={send}>
  <div class="row between wrap">
    <div>
      <h2>Choose tabs to transfer</h2>
      <p class="muted">Choose the pages to continue in {destination.name}.</p>
    </div>
    <button
      type="button"
      disabled={busy}
      onclick={() => chrome.runtime.openOptionsPage()}
    >
      Settings
    </button>
  </div>
  <label class="field">
    Destination browser
    <select
      disabled={busy || !ready}
      value={settings.destination}
      onchange={async (event) => {
        // Show and use this choice immediately while its preference is saved
        const target = event.currentTarget.value as BrowserId;
        settings = { ...settings, destination: target };
        try {
          await writeSettings({ destination: target });
        } catch (cause) {
          message = `Could not save the destination: ${describeError(cause)}`;
          error = true;
        }
      }}
    >
      {#each Object.entries(BROWSERS) as [id, browser] (id)}
        <option value={id}>{browser.name}</option>
      {/each}
    </select>
  </label>
  <label class="field">
    Find a tab
    <input
      type="text"
      bind:value={search}
      placeholder="Search by title or URL"
      disabled={busy}
    />
  </label>
  <label class="row" style="margin-top: 16px">
    <input
      type="checkbox"
      aria-label={search ? 'Select all results' : 'Select all tabs'}
      checked={allVisible}
      indeterminate={someVisible}
      disabled={busy || !ready || !visible.length}
      onchange={(event) => {
        setSelection(
          visible.map((tab) => tab.id!),
          event.currentTarget.checked,
        );
        anchor = null;
      }}
    />
    <small>{selected.length} selected · {tabs.length} available</small>
  </label>
  <div style="margin-top: 12px">
    {#each visible as tab (tab.id)}
      <label class="tab row">
        <input
          type="checkbox"
          checked={selected.includes(tab.id!)}
          disabled={busy}
          onclick={(event) => toggle(tab.id!, event)}
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
  {#if message}<p
      bind:this={statusElement}
      role="status"
      aria-live={error ? 'assertive' : 'polite'}
      tabindex="-1"
      class={error ? 'error' : complete ? 'success' : 'notice'}
    >
      {message}
    </p>{/if}
  {#if busy}<p class="muted">
      Keep this picker open until the transfer finishes.
    </p>{/if}
  <div class="row between wrap" style="margin-top: 20px">
    <small>
      {settings.behavior === 'close'
        ? 'Close source tabs after success'
        : 'Keep source tabs after success'}
    </small>
    <button
      type="submit"
      class="primary"
      disabled={busy || !ready || !selected.length}
    >
      {busy
        ? 'Transferring…'
        : `Send ${selected.length || ''} ${selected.length === 1 ? 'tab' : 'tabs'} to ${destination.name}`}
    </button>
  </div>
</form>

<p class="notice">
  Cookies, localStorage, IndexedDB, and each tab’s sessionStorage will be copied
  for the selected top-level origins. This replaces stored data for those
  origins in {destination.name}. Close existing {destination.name} tabs for those
  origins first. Separate SSO providers and embedded sites are not included automatically.
</p>
<p class="muted">
  Your browser may request parent-domain access to include shared cookies (for
  example, <code> *.netsuite.com </code>). Only cookies applicable to the
  selected hosts and storage for the selected origins are exported.
</p>
