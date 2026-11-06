import { TerminalUI, SLASH_COMMANDS } from '../src/cli/ui.js';

console.log('Testing renderCommandPopup:');
const res1 = TerminalUI.renderCommandPopup({ query: '/' });
console.log('Found commands:', res1.filtered.length);
console.log('Selected:', res1.selected?.name);

console.log('\nTesting renderCommandPopup with query /p:');
const res2 = TerminalUI.renderCommandPopup({ query: '/p' });
console.log('Found commands:', res2.filtered.length);
for (const c of res2.filtered) {
  console.log(' -', c.name, ':', c.description);
}

console.log('\nTesting renderProviderManagerCard:');
TerminalUI.renderProviderManagerCard({
  activeProvider: {
    id: 'nim',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKey: 'nvapi-mock-secret-key-1234',
    defaultRpm: 30,
    defaultTpm: 60000,
    defaultConcurrency: 4,
  },
  providers: {},
  statusMessage: '✔ Connected successfully to NVIDIA NIM catalog.',
});

console.log('\nTesting renderModelManagerCard:');
TerminalUI.renderModelManagerCard({
  mode: 'team',
  activeModel: 'meta/llama-3.3-70b-instruct',
  roles: {
    architect: 'deepseek-ai/deepseek-r1',
    coder: 'qwen/qwen2.5-coder-32b-instruct',
    tester: 'meta/llama-3.3-70b-instruct',
    verifier: 'meta/llama-3.3-70b-instruct',
  },
  selectedModels: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1', 'qwen/qwen2.5-coder-32b-instruct'],
  popularPresets: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1', 'qwen/qwen2.5-coder-32b-instruct'],
  providerName: 'NVIDIA NIM',
  statusMessage: '✔ Active SOLO model updated to meta/llama-3.3-70b-instruct',
});
