-- CreateTable
CREATE TABLE "slide_talking_points" (
    "deck_id" TEXT NOT NULL,
    "slide_id" TEXT NOT NULL,
    "html" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL DEFAULT 'ai',
    "seconds" INTEGER,
    "content_hash" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slide_talking_points_pkey" PRIMARY KEY ("deck_id","slide_id")
);

-- CreateTable
CREATE TABLE "slide_audio" (
    "deck_id" TEXT NOT NULL,
    "slide_id" TEXT NOT NULL,
    "source" TEXT,
    "s3_key" TEXT,
    "mime" TEXT,
    "duration_ms" INTEGER,
    "script" TEXT,
    "script_origin" TEXT,
    "notes_hash" TEXT,
    "voice" TEXT,
    "audio_script_hash" TEXT,
    "numbers_ok_hash" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slide_audio_pkey" PRIMARY KEY ("deck_id","slide_id")
);

-- CreateTable
CREATE TABLE "slide_narration_settings" (
    "deck_id" TEXT NOT NULL,
    "voice" TEXT,
    "tone" TEXT,
    "gap_ms" INTEGER,

    CONSTRAINT "slide_narration_settings_pkey" PRIMARY KEY ("deck_id")
);

-- CreateTable
CREATE TABLE "slide_deck_jobs" (
    "id" TEXT NOT NULL,
    "deck_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "slide_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "phase" TEXT,
    "done" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slide_deck_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slide_deck_jobs_deck_id_kind_idx" ON "slide_deck_jobs"("deck_id", "kind");

