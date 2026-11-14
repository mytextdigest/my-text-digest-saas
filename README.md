
## Getting Started


First, install packages

``` bash
npm install

```
Run, the below command to build SQLite binaries

``` bash
npm rebuild better-sqlite3 --runtime=electron --target=38.1.2 --disturl=https://electronjs.org/headers

```


Run the development server:

```bash
npm run dev
```

### Building packages step by step

1. Check the nextjs build

```bash
npm run build:next
```

2. Update the patch version:

```bash
npm version patch
```

3. Start building packages in github

```bash
git push & git push --tags
```

4. Track the build in github actions:

```bash
https://github.com/mytextdigest/mytextdigest/actions
```

5. Click on the latest build version, scroll down and download the latest one.

## Worker: slide talking points, narration and video export

See `docs/SLIDE_TALKING_POINTS_PRESENTER_NARRATION_FEATURE_SPEC.md`. Long slide work (whole-deck talking points, narration, the talking-points PDF, video export, WebM recording fix-up) runs on the EC2 worker from its own queue, so it never holds up document processing.

### AWS

1. Create an SQS queue for slide media jobs (visibility timeout 600 s, same DLQ redrive policy as the main queue).
2. Set `SQS_MEDIA_QUEUE_URL` on **both** Vercel and the EC2 worker. Unset, media jobs go to the main queue.
3. S3 lifecycle rule: expire objects under `slide-exports/` after 2 days. Exported `.pptx` / `.pdf` / `.mp4` files are re-created on every export.
   Narration clips live under `slide-audio/<deckId>/` and are removed with the deck. Do not expire them.

### EC2 worker environment

| Variable | Value |
|---|---|
| `SQS_MEDIA_QUEUE_URL` | the queue above |
| `APP_BASE_URL` | the public app URL, e.g. `https://my-text-digest-saas.vercel.app` (headless Chromium loads `/present/frame` from it). Falls back to `NEXTAUTH_URL`. |
| `NEXTAUTH_SECRET` | **the same value as on Vercel**. It signs the 10-minute render token the frame page accepts. (Or set `RENDER_TOKEN_SECRET` on both.) |
| `FFMPEG_PATH` | optional, defaults to the `ffmpeg-static` binary |
| `PUPPETEER_EXECUTABLE_PATH` | optional, defaults to the Chromium Puppeteer downloads on `npm install` |
| `VIDEO_ENCODE_CONCURRENCY` | ffmpeg encoders run at once (default `2`). **Set `1` on a 1 GB instance (t3.micro).** |
| `VIDEO_ENCODE_THREADS` | x264 threads per encoder (default `2`) |
| `VIDEO_STAGE_BUDGET_MS` | how long one queue message keeps encoding before the export re-queues itself (default `300000`, 5 min, inside the 8-minute job watchdog) |

### Small instances (t3.micro, 1 GB)

Measured with `VIDEO_ENCODE_CONCURRENCY=1` on 2 CPUs, for a 9-slide deck with 4 min 20 s of narration:

| Stage | Worker total memory |
|---|---|
| Drawing slides | ~440 MB peak (Node ~145 + Chromium ~290) |
| Encoding | ~430 MB peak (Node ~160 + ffmpeg ~270) |
| Time | ~1.5 min here; expect ~2–3 min on a t3.micro |

The export runs in stages (render, then encode in time-boxed chunks that re-queue themselves, then join), so long decks don't hit the watchdog. Each stage passes its work files through S3 under `slide-exports/<deckId>/work-<jobId>/`; they're deleted when the export finishes, fails or is cancelled.

Add swap so a memory peak, such as OCR running at the same moment, slows the worker down instead of crashing it:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

On a 2 GB+ instance, leave `VIDEO_ENCODE_CONCURRENCY` at 2 for faster exports.

### Chromium system libraries and fonts (Ubuntu)

```bash
sudo apt-get install -y libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 \
  libgtk-3-0 libnss3 libpango-1.0-0 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 \
  libxrandr2 libxshmfence1 \
  fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fonts-noto-color-emoji
# Ubuntu 22.04: libasound2 instead of libasound2t64.
npm install   # downloads Puppeteer's Chromium (~170 MB) and ffmpeg-static (~80 MB)
```

The fonts matter: video frames and the PDF are drawn by this Chromium, so missing fonts show up as substitutes in the video. Carlito and Caladea are metric-compatible with Calibri and Cambria.

### Vercel

Set `PUPPETEER_SKIP_DOWNLOAD=true` so builds don't download Chromium. No route uses it.

### Local

`docker/elasticmq.conf` has `slide-media-queue`, and `.env.development.local` points `SQS_MEDIA_QUEUE_URL` at it. `npm run dev:worker` starts the third poll loop automatically. Tests: `npm run test:slides`.
