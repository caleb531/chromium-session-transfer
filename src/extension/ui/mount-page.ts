import { mount } from 'svelte';
import type { ComponentProps } from 'svelte';
import PageLayout from './PageLayout.svelte';
import './styles.css';

// Mount the given page and its heading inside the shared layout
export function mountPage(props: ComponentProps<typeof PageLayout>): void {
  // The root element provided by the current HTML entry point
  const target = document.getElementById('app');
  if (!target)
    throw new Error('The extension page is missing its root element');
  mount(PageLayout, { target, props });
}
