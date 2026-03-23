import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  manifest: {
    name: 'Sensible Slack',
    description: 'Enhances the Slack web interface with quick message actions and manual read control.',
    permissions: ['storage', 'webRequest', 'webRequestBlocking'],
    host_permissions: ['*://*.slack.com/*'],
    browser_specific_settings: {
      gecko: {
        id: 'sensible-slack@mturley',
      },
    },
  },
});
