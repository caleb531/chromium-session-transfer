import { mountPage } from './mount-page';
import Picker from './Picker.svelte';

mountPage({
  title: 'Chromium Session Transfer',
  subtitle: 'Transfer tabs to another Chromium browser',
  page: Picker,
});
