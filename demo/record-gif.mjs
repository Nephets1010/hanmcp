/**
 * Record `npm run demo` as the animated GIF the README leads with.
 *
 * There are two ways to produce `docs/demo.gif`, and this is the fallback:
 *
 *   1. `vhs docs/demo.tape` — the canonical path. It records a real terminal,
 *      which is strictly better. Use it whenever vhs and ffmpeg are available.
 *   2. `node demo/record-gif.mjs` — this. It runs the same paced demo, keeps
 *      the timestamps, and replays that timeline onto a canvas. Same spec
 *      (1200x700, GitHub Dark, 18px, 60ms/char), no vhs.
 *
 * The reason the fallback is worth having is the reason it exists: whatever
 * produced the committed GIF, the GIF has to show the tool's *actual* output.
 * This records a live run rather than drawing an impression of one, so the
 * holds in the GIF are the holds `--pace` really inserted and the recording
 * cannot flatter the tool it is advertising. Re-run it after any change to the
 * CLI's output; the numbers in the recording are the numbers it will print.
 *
 * ## Geometry, and why it is not arbitrary
 *
 * - The demo prints Chinese paragraphs unwrapped, up to 282 display columns.
 *   They are wrapped here at the terminal's own width, because that is what a
 *   terminal does with them and therefore what a viewer would see.
 * - The screen holds 26 lines, so output scrolls. Also what a terminal does.
 *
 * ## Fonts
 *
 * `Consolas` for Latin, `Microsoft YaHei` for CJK. A CJK-capable fallback is
 * not optional — the demo's punchline is a Chinese query. `MS Gothic` looks
 * like a reasonable choice on a Windows box and is not one: it has no
 * simplified-Chinese coverage and the recording fills with tofu boxes. A
 * missing glyph is not an error in canvas, and `measureText` still returns a
 * plausible width, so the only way to catch that is to look at the pixels.
 *
 * ## Requirements
 *
 * `npm install @napi-rs/canvas gifencoder` somewhere, then point
 * `RECORDER_MODULES` at that `node_modules`. They are deliberately not
 * dependencies of this package: `package.json` has to stay empty in both
 * dependency fields, and CI fails the build if either gains an entry.
 *
 *   RECORDER_MODULES=/path/to/node_modules node demo/record-gif.mjs
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = path.resolve(HERE, '..');
const OUT = path.join(REPO, 'docs', 'demo.gif');

// Resolve the tools from RECORDER_MODULES when it is given, and from this
// package otherwise. createRequire takes a path to resolve relative to, so a
// bare directory is enough.
const requireFrom = process.env.RECORDER_MODULES
  ? createRequire(path.join(process.env.RECORDER_MODULES, 'resolve-from-here.js'))
  : createRequire(import.meta.url);

let createCanvas;
let GIFEncoder;
try {
  ({ createCanvas } = requireFrom('@napi-rs/canvas'));
  GIFEncoder = requireFrom('gifencoder');
} catch (error) {
  throw new Error(
    'recording needs @napi-rs/canvas and gifencoder, which are not dependencies of this package.\n' +
      'They are not dependencies on purpose: package.json must stay empty in both dependency fields.\n' +
      'Install them anywhere and point RECORDER_MODULES at that node_modules:\n' +
      '  npm install --prefix /tmp/hanmcp-recorder @napi-rs/canvas gifencoder\n' +
      '  RECORDER_MODULES=/tmp/hanmcp-recorder/node_modules node demo/record-gif.mjs\n' +
      `\noriginal error: ${error instanceof Error ? error.message : String(error)}`,
  );
}

// -- spec, mirroring docs/demo.tape ----------------------------------------
const W = 1200;
const H = 700;
const PAD = 24;
const FONT_SIZE = 18;
const LINE_H = 25;
const TYPING_MS = 60;
const COMMAND = 'npm run demo';
// The tape sleeps 400ms between typing the command and pressing Enter.
const PRE_ENTER_MS = 400;
// The tape records for 29s; the run itself takes about 27. Leave the closing
// line on screen for the rest of the take.
const TAIL_HOLD_MS = 1100;
const MIN_FRAME_MS = 40;

const BG = '#0d1117';
const FG = '#e6edf3';
const MUTED = '#7d8590';

const FONT = `${FONT_SIZE}px Consolas, "Microsoft YaHei"`;
const METRIC_FONT = `${FONT_SIZE}px Consolas`;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.font = METRIC_FONT;
const ADVANCE = ctx.measureText('M').width;
const COLS = Math.floor((W - PAD * 2) / ADVANCE);
const ROWS = Math.floor((H - PAD * 2) / LINE_H);
const ASCENT = ctx.measureText('Mg').fontBoundingBoxAscent ?? FONT_SIZE * 0.8;

console.log(`canvas    ${W}x${H} — ${COLS} cols x ${ROWS} rows, advance ${ADVANCE.toFixed(2)}px`);

// -- east asian width ------------------------------------------------------
// The same ranges the project's own tokenizer treats as wide, so the renderer
// wraps on the same definition the tool indexes by.
const isWide = (cp) =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe6f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x20000 && cp <= 0x3fffd);

/** Hard-wrap at the terminal width, the way a terminal does. */
function wrap(line) {
  const out = [];
  let current = '';
  let width = 0;
  for (const ch of line) {
    const w = isWide(ch.codePointAt(0)) ? 2 : 1;
    if (width + w > COLS) {
      out.push(current);
      current = '';
      width = 0;
    }
    current += ch;
    width += w;
  }
  out.push(current);
  return out;
}

// -- 1. run the real demo, keep the rhythm ---------------------------------
// npm is a script, not a binary, and on Windows its `.cmd` shim needs cmd.exe,
// which a restricted shell may refuse to spawn. Running npm's entry point with
// the current node avoids the shell entirely.
function npmInvocation() {
  if (process.env.npm_execpath) {
    return { command: process.env.npm_node_execpath || process.execPath, args: [process.env.npm_execpath] };
  }
  const beside = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(beside)) {
    return { command: process.execPath, args: [beside] };
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [], shell: true };
}

const startedAt = Date.now();
const chunks = [];
const invocation = npmInvocation();
const child = spawn(invocation.command, [...invocation.args, 'run', 'demo'], {
  cwd: REPO,
  shell: invocation.shell ?? false,
  env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
});
const onData = (name) => (buf) => chunks.push({ at: Date.now() - startedAt, text: buf.toString('utf8') });
child.stdout.on('data', onData('out'));
child.stderr.on('data', onData('err'));

const code = await new Promise((resolve) => child.on('close', resolve));
const elapsed = Date.now() - startedAt;
if (code !== 0) {
  throw new Error(`the demo exited ${code}; refusing to record a failing run`);
}
console.log(`demo      exit 0, ${(elapsed / 1000).toFixed(2)}s, ${chunks.length} chunks`);

// The tool emits no ANSI, but npm colourises its own banner and the renderer
// draws plain text on a background of its own.
const strip = (s) =>
  s
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*\u0007/g, '')
    .replace(/\r(?!\n)/g, '\n');

const ENTER_AT = COMMAND.length * TYPING_MS + PRE_ENTER_MS;

/** The screen as a grow-only list of wrapped lines, plus a style per line. */
const screen = [];
const styles = [];
let cursorOnFreshLine = false;

function push(text, style) {
  const clean = strip(text);
  // A chunk that ended in a newline left the cursor on a line that is empty for
  // the moment. The next chunk's first line belongs *on* that line, not after
  // it — without this the recording gains one blank line per chunk boundary and
  // the closing line drifts off the bottom.
  if (cursorOnFreshLine && screen.length > 0 && screen[screen.length - 1] === '') {
    screen.pop();
    styles.pop();
  }
  for (const raw of clean.split('\n')) {
    for (const line of wrap(raw)) {
      screen.push(line);
      styles.push(style);
    }
  }
  cursorOnFreshLine = clean.endsWith('\n');
}

// -- 2. build the frames ---------------------------------------------------
const frames = [];

// Typing. Every other character is enough: a 60ms frame delay is below what
// viewers honour anyway, and the result reads the same.
for (let i = 0; i < COMMAND.length; i += 2) {
  frames.push({ at: i * TYPING_MS, lines: [`$ ${COMMAND.slice(0, i)}`], styles: ['prompt'] });
}
frames.push({ at: COMMAND.length * TYPING_MS, lines: [`$ ${COMMAND}`], styles: ['prompt'] });

// The run. One frame per chunk, because that is the granularity at which the
// output actually appeared.
push(`$ ${COMMAND}\n`, 'prompt');
for (const chunk of chunks) {
  // npm's banner is packaging chrome, not hanmcp's output. Rendering it in the
  // muted colour keeps the two from reading as one message.
  push(chunk.text, chunk.text.trimStart().startsWith('>') ? 'chrome' : 'body');
  frames.push({ at: ENTER_AT + chunk.at, lines: [...screen], styles: [...styles] });
}

const totalMs = ENTER_AT + elapsed + TAIL_HOLD_MS;
frames.push({ at: totalMs, lines: [...screen], styles: [...styles] });

// docs/DEMO.md's publishing checklist opens with "total length is 30 seconds or
// under", and the demo's own holds account for 24.1s of a ~28.7s take, so there
// is not much slack. A busy machine stretches the paced run — the holds are
// fixed sleeps but the work between them is not — and the first recording made
// here came out at 33.8s for exactly that reason. It looked fine. Nothing said
// anything. That is the failure this check exists for: re-run on a quiet
// machine rather than publish something over its own stated ceiling.
//
// The sum checked is the one the encoder will actually write, not the timeline
// above it. Every delay is quantised onto GIF's centisecond grid and floored at
// MIN_FRAME_MS, and both operations only ever move a delay outward, so the
// encoded GIF runs slightly longer than the frames it was built from — this
// recording plans 28.48s and encodes 28.78s. Checking the plan would let a
// 29.9s take pass a 30s ceiling and still ship a GIF over it, which is the same
// class of mistake as the 33.8s take: the artifact does not match the claim.
//
// MIN_FRAME_MS is the other half of that quantisation. GIF delays are
// centiseconds, and viewers clamp anything under 20ms up to 100ms; flooring at
// 40ms keeps the timeline honest instead of letting a viewer invent one.
const delays = frames.map((frame, i) => {
  const next = frames[i + 1]?.at ?? totalMs;
  return Math.max(MIN_FRAME_MS, Math.round((next - frame.at) / 10) * 10);
});
const encodedMs = delays.reduce((sum, ms) => sum + ms, 0);

const CEILING_MS = 30000;
if (encodedMs > CEILING_MS) {
  const cameOut = (encodedMs / 1000).toFixed(2);
  const planned = (totalMs / 1000).toFixed(2);
  const paced = (elapsed / 1000).toFixed(1);
  throw new Error(
    `the recording encodes to ${cameOut}s, over the ${CEILING_MS / 1000}s ceiling in docs/DEMO.md.\n` +
      `Its timeline planned ${planned}s, and the paced run itself took ${paced}s, whose fixed holds ` +
      'only account for 24.1s — so the machine was busy while it ran.\n' +
      'Close what is running and record again; the output is fine, the timing is not.',
  );
}

const scrolls = Math.max(0, screen.length - ROWS);
console.log(`frames    ${frames.length} over ${(encodedMs / 1000).toFixed(2)}s encoded`);
console.log(`content   ${screen.length} wrapped lines, ${ROWS} visible (scrolls by ${scrolls})`);

// The shot the whole recording exists for has to survive the scroll. If an edit
// ever pushes the answer off the top, the GIF quietly loses its point, so fail
// rather than write a worse one.
const finalScreen = frames[frames.length - 1].lines.slice(-ROWS);
for (const landmark of ['索引内存占用怎么估算', 'no API key. no embeddings. no cloud.']) {
  const visible = finalScreen.some((line) => line.includes(landmark));
  console.log(`  ${visible ? 'on screen  ' : 'SCROLLED OFF'} ${landmark}`);
  if (!visible) {
    throw new Error(`"${landmark}" is not on screen in the final frame`);
  }
}

// -- 3. draw and encode ----------------------------------------------------
const COLORS = { body: FG, prompt: MUTED, chrome: MUTED };

function drawFrame(frame) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  ctx.textBaseline = 'alphabetic';

  const lines = frame.lines.slice(-ROWS);
  const lineStyles = frame.styles.slice(-ROWS);
  for (let i = 0; i < lines.length; i += 1) {
    const y = PAD + ASCENT + i * LINE_H;
    if (lineStyles[i] === 'prompt' && lines[i].startsWith('$ ')) {
      ctx.fillStyle = MUTED;
      ctx.fillText('$ ', PAD, y);
      ctx.fillStyle = FG;
      ctx.fillText(lines[i].slice(2), PAD + ADVANCE * 2, y);
      continue;
    }
    ctx.fillStyle = COLORS[lineStyles[i]] ?? FG;
    ctx.fillText(lines[i], PAD, y);
  }
}

const encoder = new GIFEncoder(W, H);
const gifStream = createWriteStream(OUT);
const gifDone = once(gifStream, 'finish');
encoder.createReadStream().pipe(gifStream);
encoder.start();
encoder.setRepeat(0);
encoder.setQuality(8);

// -- 4. and a video, rendered rather than converted -------------------------
// docs/DEMO.md asks for a demo.mp4 alongside the GIF, and notes that re-encoding
// the GIF looks noticeably worse — GIF has already thrown away the timing and
// the colour depth by then. So the video is rendered from the same frames at a
// real 30fps. It is optional: no ffmpeg, no video, and the recording still
// succeeds, because the GIF is the artifact the README needs.
const VIDEO = path.join(REPO, 'docs', 'demo.mp4');
const FPS = 30;

function findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  for (const mod of ['@ffmpeg-installer/ffmpeg']) {
    try {
      return requireFrom(mod).path;
    } catch {
      /* not installed, which is fine */
    }
  }
  return null;
}

const ffmpegPath = findFfmpeg();
let video = null;
if (ffmpegPath) {
  video = spawn(
    ffmpegPath,
    [
      '-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS),
      '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      VIDEO,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  video.on('error', () => {
    video = null;
  });
} else {
  console.log('ffmpeg    not found — skipping docs/demo.mp4 (set FFMPEG_PATH to enable)');
}

// A pixel buffer read back once per distinct frame and reused, rather than
// reallocating 3.4 MB hundreds of times.
const pixels = ctx.getImageData(0, 0, W, H).data;
let videoFramesWritten = 0;
let clockMs = 0;

/**
 * Emit however many 30fps video frames fit in this GIF frame's delay.
 *
 * Two things this has to get right rather than fast:
 *   - `stdin.write` does not copy, so the buffer has to be a fresh one. Writing
 *     the reused pixel buffer would let frame N+1 overwrite frame N while
 *     ffmpeg was still reading it.
 *   - A whole recording is ~3 GB of raw pixels. Without waiting for `drain` it
 *     all queues in memory instead of streaming.
 */
async function writeVideoFrames(delay) {
  if (!video) return;
  clockMs += delay;
  const wanted = Math.round((clockMs / 1000) * FPS);
  while (videoFramesWritten < wanted) {
    if (!video.stdin.write(Buffer.from(pixels))) {
      await once(video.stdin, 'drain');
    }
    videoFramesWritten += 1;
  }
}

for (let i = 0; i < frames.length; i += 1) {
  // The delays were computed and checked above, before anything was written,
  // because the ceiling has to reject the take before the encoder truncates the
  // file that is already there.
  const delay = delays[i];
  drawFrame(frames[i]);
  encoder.setDelay(delay);
  encoder.addFrame(ctx);
  pixels.set(ctx.getImageData(0, 0, W, H).data);
  await writeVideoFrames(delay);
  process.stdout.write(`\r  frame ${i + 1}/${frames.length} · ${delay}ms        `);
}
encoder.finish();
await gifDone;

// Over GitHub's inline limit a GIF stops autoplaying and renders as a
// click-to-play box, which is worse than a smaller one that plays itself. That
// is the whole reason for the size ceiling in the checklist, so it is asserted
// rather than eyeballed.
const gifBytes = (await stat(OUT)).size;
const INLINE_LIMIT = 10 * 1024 * 1024;
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
if (gifBytes > INLINE_LIMIT) {
  throw new Error(
    `docs/demo.gif is ${mb(gifBytes)} MB, over GitHub's ${mb(INLINE_LIMIT)} MB inline limit.\n` +
      'It will render as a click-to-play box instead of autoplaying. Lower the quality or shorten the run.',
  );
}
console.log(`wrote     ${path.relative(REPO, OUT)} — ${(gifBytes / 1024).toFixed(0)} KB, ${frames.length} frames`);

if (video) {
  video.stdin.end();
  const videoCode = await new Promise((resolve) => video.on('close', resolve));
  const size = existsSync(VIDEO) ? (await stat(VIDEO)).size : 0;
  if (videoCode !== 0 || size === 0) {
    throw new Error(`ffmpeg exited ${videoCode}; docs/demo.mp4 is missing or empty`);
  }
  console.log(`\nwrote     docs/demo.mp4 — ${videoFramesWritten} frames at ${FPS}fps, ${(size / 1024).toFixed(0)} KB`);
}
