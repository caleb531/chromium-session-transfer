import { defineBackground } from 'wxt/utils/define-background';

// Register the toolbar listener when the service worker starts
export default defineBackground({
  type: 'module',
  main() {
    // Open one picker tab when the toolbar action or keyboard shortcut is used
    chrome.action.onClicked.addListener(async () => {
      // The extension page that owns the transfer and its native messaging port
      const pickerUrl = chrome.runtime.getURL('picker.html');
      // Any picker already open in this browser profile
      const existing = (await chrome.tabs.query({})).find(
        // Check the exact extension page without selecting ordinary website tabs
        (tab) => tab.url === pickerUrl,
      );
      if (existing?.id) {
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: pickerUrl });
      }
    });
  },
});
