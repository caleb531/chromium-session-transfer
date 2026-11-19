<script lang="ts">
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
  <section class="panel">
    <h2>{options ? 'Settings' : 'Send to Chrome'}</h2>
    <p>Your browser sessions, ready to go.</p>
  </section>
</main>
