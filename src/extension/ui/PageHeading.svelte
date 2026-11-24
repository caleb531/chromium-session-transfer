<script lang="ts">
  import type { Settings } from '../settings';

  // The heading text and theme controls supplied by the page layout
  let {
    title,
    subtitle,
    theme,
    changeTheme,
  }: {
    /** The title shown beside the logo */
    title: string;
    /** The description shown under the title */
    subtitle: string;
    /** The saved theme shown in the selector */
    theme: Settings['theme'];
    /** Save the theme selected by the user */
    changeTheme: (event: Event) => Promise<void>;
  } = $props();
</script>

<header class="page-heading">
  <img src="/app-icon.svg" width="76" height="76" alt="" />
  <hgroup>
    <h1>{title}</h1>
    <p class="page-subtitle">{subtitle}</p>
  </hgroup>
  <label class="theme-control">
    Theme
    <select value={theme} onchange={changeTheme}>
      <option value="system">System</option>
      <option value="dark">Dark</option>
      <option value="light">Light</option>
    </select>
  </label>
</header>

<style>
  /* Center the logo, heading text, and theme switcher on the same row */
  .page-heading {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 20px;
  }

  /* Remove the global title margins to keep the text centered */
  h1 {
    margin: 0;
  }

  /* Use muted text and leave a small gap only between the two lines */
  .page-subtitle {
    color: var(--color-muted);
    margin: 4px 0 0;
  }

  /* Keep the label and selector together at the right edge of the heading */
  .theme-control {
    display: flex;
    align-items: center;
    justify-self: end;
    gap: 10px;
    color: var(--color-secondary);
    font-size: 14px;
  }

  /* Size the selector to its options */
  .theme-control select {
    width: auto;
  }

  @media (max-width: 600px) {
    /* Give the title room to wrap beside the logo on narrow pages */
    .page-heading {
      grid-template-columns: auto minmax(0, 1fr);
    }

    /* Put the switcher below the heading when the columns would crowd it */
    .theme-control {
      grid-column: 1 / -1;
    }
  }
</style>
