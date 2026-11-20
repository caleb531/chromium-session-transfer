<script lang="ts">
  // The title and subtitle shown beside the logo on the current page
  let { title, subtitle }: { title: string; subtitle: string } = $props();
</script>

<header class="page-heading">
  <img src="/app-icon.svg" width="76" height="76" alt="" />
  <hgroup>
    <h1>{title}</h1>
    <p class="page-subtitle">{subtitle}</p>
  </hgroup>
</header>

<style>
  /* Center the title and subtitle together alongside the logo */
  .page-heading {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  /* Keep the logo at its full size when the text wraps */
  img {
    flex-shrink: 0;
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
</style>
