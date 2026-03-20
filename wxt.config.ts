import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Slack Enhancements',
    description: 'Enhances the Slack web interface with redirect prevention, quick message actions, recent threads tracking, and manual read control.',
    permissions: ['storage', 'declarativeNetRequest'],
    host_permissions: ['*://*.slack.com/*'],
  },
});
