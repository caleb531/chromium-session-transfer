<script lang="ts">
  import Options from './Options.svelte';
  import Picker from './Picker.svelte';
  // Whether this extension page is the settings panel
  const options = location.pathname.endsWith('options.html');
</script>

<main>
  <header>
    <span class="eyebrow">BRAVE → CHROME</span>
    <h1>
      {options ? 'Make yourself at home.' : 'Pick up where you left off.'}
    </h1>
    <p class="muted">Chrome Session Transfer</p>
  </header>
  {#if options}<Options />{:else}<Picker />{/if}
</main>
