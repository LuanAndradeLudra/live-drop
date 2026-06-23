-- Índice para a limpeza diária: PARTITION BY streamer ORDER BY created_at DESC, id DESC
CREATE INDEX IF NOT EXISTS "idx_fetched_streamer_created_desc"
  ON "fetched_rolls" ("streamer", "created_at" DESC, "id" DESC);
