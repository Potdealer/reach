import dotenv from 'dotenv';
dotenv.config();

import { Reach } from '../src/index.js';

const reach = new Reach();
let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    failed++;
  }
}

async function testPersist() {
  console.log('\n--- persist/recall ---');

  // Store and recall a string
  const r1 = reach.persist('test-key', 'hello world');
  assert(r1.stored === true, 'persist returns stored: true');

  const v1 = reach.recall('test-key');
  assert(v1 === 'hello world', 'recall returns stored string');

  // Store and recall an object
  reach.persist('test-obj', { name: 'ollie', version: 1 });
  const v2 = reach.recall('test-obj');
  assert(v2?.name === 'ollie', 'recall returns stored object');

  // TTL expiry
  reach.persist('test-ttl', 'expires', { ttl: 1 });
  const v3 = reach.recall('test-ttl');
  assert(v3 === 'expires', 'TTL value accessible before expiry');

  // Forget
  const f1 = reach.forget('test-key');
  assert(f1 === true, 'forget returns true for existing key');
  const v4 = reach.recall('test-key');
  assert(v4 === null, 'recall returns null after forget');

  // Not found
  const v5 = reach.recall('nonexistent-key-xyz');
  assert(v5 === null, 'recall returns null for missing key');

  // List keys
  const keys = reach.listKeys();
  assert(keys.length >= 1, 'listKeys returns stored keys');

  // Cleanup
  reach.forget('test-obj');
  reach.forget('test-ttl');
}

async function testFetch() {
  console.log('\n--- fetch (HTTP) ---');

  // Fetch a simple page
  const result = await reach.fetch('https://example.com');
  assert(result.source === 'http' || result.source === 'browser', 'example.com fetched via HTTP or browser fallback');
  assert(result.format === 'markdown', 'returned as markdown');
  assert(result.content.includes('Example Domain'), 'content contains expected text');

  // Fetch JSON
  const json = await reach.fetch('https://httpbin.org/json', { format: 'json' });
  assert(json.format === 'json', 'JSON format returned');
  assert(json.content?.slideshow, 'JSON content has expected structure');
}

async function testSign() {
  console.log('\n--- sign ---');

  const key = process.env.PRIVATE_KEY || process.env.DEPLOYMENT_KEY;
  if (!key) {
    console.log('  SKIP: No PRIVATE_KEY or DEPLOYMENT_KEY in .env');
    return;
  }

  const result = await reach.sign('hello from reach');
  assert(result.signature?.startsWith('0x'), 'signature starts with 0x');
  assert(result.address?.startsWith('0x'), 'address starts with 0x');
  assert(result.type === 'message', 'type is message');

  const addr = reach.getAddress();
  assert(addr === result.address, 'getAddress matches signer');
}

async function testRouter() {
  console.log('\n--- router ---');

  // Read task — default
  const r1 = reach.route({ type: 'read', url: 'https://example.com' });
  assert(r1.primitive === 'fetch', 'read routes to fetch');
  assert(r1.layer === 'http', 'unknown site defaults to http');

  // Read task — known API
  const r2 = reach.route({ type: 'read', url: 'https://api.github.com/repos/Potdealer/exoskeletons' });
  assert(r2.layer === 'api', 'github routes to api layer');

  // Interact task
  const r3 = reach.route({ type: 'interact', url: 'https://example.com' });
  assert(r3.primitive === 'act', 'interact routes to act');
  assert(r3.layer === 'browser', 'interact uses browser');

  // Auth task
  const r4 = reach.route({ type: 'auth', url: 'https://cantina.xyz', params: { service: 'cantina', method: 'login' } });
  assert(r4.primitive === 'authenticate', 'auth routes to authenticate');

  // Sign task
  const r5 = reach.route({ type: 'sign' });
  assert(r5.primitive === 'sign', 'sign routes to sign');

  // Store task
  const r6 = reach.route({ type: 'store', params: { key: 'test' } });
  assert(r6.primitive === 'persist', 'store routes to persist');

  // Learn and re-route
  reach.learnSite('https://spa-app.example.com', { needsJS: true });
  const r7 = reach.route({ type: 'read', url: 'https://spa-app.example.com/page' });
  assert(r7.params?.javascript === true, 'learned JS-needed site routes with javascript:true');
}

async function testAuthenticate() {
  console.log('\n--- authenticate ---');

  // Cookie auth with no saved cookies
  const r1 = await reach.authenticate('nonexistent-service', 'cookie');
  assert(r1.success === false, 'cookie auth fails for unknown service');

  // API key auth
  const r2 = await reach.authenticate('test-service', 'apikey', { apiKey: 'test-key-123', headerName: 'X-API-Key' });
  assert(r2.success === true, 'apikey auth succeeds');
  assert(r2.session.type === 'apikey', 'session type is apikey');

  // Verify session was saved
  const session = reach.getSession('test-service');
  assert(session?.type === 'apikey', 'saved session is retrievable');
}

async function main() {
  console.log('Reach Test Suite\n================');

  await testPersist();
  await testRouter();
  await testAuthenticate();
  await testFetch();
  await testSign();

  console.log(`\n================`);
  console.log(`${passed} passed, ${failed} failed`);

  await reach.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
