import https from 'node:https';

const apiKey = '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';
const model = 'nvidia/nemotron-3-ultra-550b-a55b';

const payload = JSON.stringify({
  model,
  messages: [{ role: 'user', content: 'Say hello in one word' }],
  max_tokens: 10,
});

const req = https.request('https://integrate.api.nvidia.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
}, (res) => {
  console.log('STATUS:', res.statusCode);
  console.log('HEADERS:', JSON.stringify(res.headers, null, 2));
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('BODY:', data.slice(0, 1000));
  });
});

req.on('error', err => {
  console.error('ERROR:', err);
});

req.write(payload);
req.end();
