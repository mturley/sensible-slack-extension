import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  manifest: {
    name: 'Sensible Slack',
    description: 'Enhances the Slack web client with manual thread read control and quick message actions.',
    permissions: ['storage', 'webRequest', 'webRequestBlocking'],
    host_permissions: ['*://*.slack.com/*'],
    browser_specific_settings: {
      gecko: {
        id: 'sensible-slack@mturley',
      },
    },
  },
});
