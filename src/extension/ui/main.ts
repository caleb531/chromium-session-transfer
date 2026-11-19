import { mount } from 'svelte';
import App from './App.svelte';
import './styles.css';

// The root element shared by the picker and options entry pages
const target = document.getElementById('app');
if (!target) throw new Error('The extension page is missing its root element');
mount(App, { target });
