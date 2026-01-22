import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Viceroy',
    author: 'Alex Beals',
    description:
      'Automatically match Monarch transactions with other platforms (currently just Uber and Uber Eats).',
    homepage_url: 'https://alexbeals.com',
    version: '1.0.1',
    incognito: 'split',
    action: {
      default_icon: {
        '32': 'icons/icon-32.png',
        '128': 'icons/icon-128.png',
      },
    },
    permissions: [
      'tabs',
      'scripting',
      'webRequest',
      'declarativeNetRequest',
      'cookies',
      'storage',
    ],
    host_permissions: [
      'https://riders.uber.com/*',
      'https://www.ubereats.com/*',
      'https://api.monarch.com/*',
      'https://app.monarch.com/*',
      'https://static-maps.uber.com/*',
      'https://account.baywheels.com/*',
    ],
    web_accessible_resources: [
      {
        resources: ['app.html', 'app.js'],
        matches: ['<all_urls>'],
      },
    ],
    declarative_net_request: {
      rule_resources: [{ id: 'rules', enabled: true, path: 'rules.json' }],
    },
  },
});
