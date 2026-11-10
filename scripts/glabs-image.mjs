#!/usr/bin/env node
/**
 * Generates one image through a local G-Labs webhook server and saves it.
 *
 * Usage:
 *   GLABS_API_KEY=... node scripts/glabs-image.mjs --prompt-file <path> --out <path>
 *                                                  [--aspect 1:1] [--ref <image>]...
 *
 * The API key is read from the environment only. GLABS_URL overrides the default http://127.0.0.1:8765.
 */
import fs from 'node:fs';
import path from 'node:path';

const POLL_INTERVAL_MS = 5000;
const POLL_LIMIT_MS = 10 * 60 * 1000;
const MAX_REFS = 5;
const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function parseArgs(argv) {
  const args = { aspect: '1:1', refs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === '--prompt-file') args.promptFile = value;
    else if (argv[i] === '--out') args.out = value;
    else if (argv[i] === '--aspect') args.aspect = value;
    else if (argv[i] === '--ref') args.refs.push(value);
    else fail(`Unknown argument: ${argv[i]}`, 2);
    i += 1;
  }
  if (!args.promptFile || !args.out) fail('Both --prompt-file and --out are required', 2);
  if (args.refs.length > MAX_REFS) fail(`At most ${MAX_REFS} --ref images are allowed`, 2);
  return args;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function toDataUrl(file) {
  const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

const args = parseArgs(process.argv.slice(2));
const secret = process.env.GLABS_API_KEY;
if (!secret) fail('GLABS_API_KEY is not set', 2);
const base = (process.env.GLABS_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
const auth = { 'X-API-Key': secret };

const submit = await fetch(`${base}/api/openai/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...auth },
  body: JSON.stringify({
    prompt: fs.readFileSync(args.promptFile, 'utf8'),
    aspect_ratio: args.aspect,
    quality: 'high',
    prompt_mode: 'direct',
    reasoning: 'none',
    web_search: false,
    reference_images: args.refs.map(toDataUrl)
  })
});
const submitted = await submit.json().catch(() => ({}));
if (submit.status !== 202 || !submitted.task_id) {
  fail(`Submit failed: HTTP ${submit.status} ${JSON.stringify(submitted)}`);
}

const deadline = Date.now() + POLL_LIMIT_MS;
let resultUrl = null;
while (!resultUrl) {
  if (Date.now() > deadline) fail(`Timed out waiting for task ${submitted.task_id}`);
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  const poll = await fetch(`${base}/api/status/${submitted.task_id}`, { headers: auth });
  const task = await poll.json().catch(() => ({}));
  if (task.status === 'failed') fail(`Generation failed: ${task.error_code ?? ''} ${task.error ?? ''}`);
  if (task.status === 'completed') {
    if (!task.results?.[0]) fail('Generation completed without a result');
    resultUrl = task.results[0];
  }
}

const target = resultUrl.startsWith('http') ? resultUrl : `${base}${resultUrl.startsWith('/') ? '' : '/'}${resultUrl}`;
// The key is only sent to the G-Labs server itself, never to another host that serves the image.
const download = await fetch(target, target.startsWith(base) ? { headers: auth } : {});
if (!download.ok) fail(`Download failed: HTTP ${download.status}`);
const image = Buffer.from(await download.arrayBuffer());
fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
fs.writeFileSync(args.out, image);
console.log(`saved ${args.out} ${image.length}`);
