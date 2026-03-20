import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Slack Enhancements',
    description: 'Enhances the Slack web interface with quick message actions, recent threads tracking, and manual read control.',
    permissions: ['storage', 'webRequest', 'webRequestBlocking'],
    host_permissions: ['*://*.slack.com/*'],
  },
});
