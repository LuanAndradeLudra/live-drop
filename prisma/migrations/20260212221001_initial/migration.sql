-- CreateEnum
CREATE TYPE "RollType" AS ENUM ('upgrade', 'case');

-- CreateEnum
CREATE TYPE "RollState" AS ENUM ('queued', 'processing', 'failed');

-- CreateTable
CREATE TABLE "rolls" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(100) NOT NULL,
    "streamer" VARCHAR(100) NOT NULL,
    "roll" VARCHAR(100) NOT NULL,
    "type" "RollType" NOT NULL DEFAULT 'upgrade',
    "state" "RollState" NOT NULL DEFAULT 'queued',
    "tries" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "rolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fetched_rolls" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(100) NOT NULL,
    "streamer" VARCHAR(100) NOT NULL,
    "roll" VARCHAR(100) NOT NULL,
    "type" "RollType" NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fetched_rolls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_rolls_state_created" ON "rolls"("state", "created_at", "id");

-- CreateIndex
CREATE INDEX "idx_rolls_user" ON "rolls"("user_id");

-- CreateIndex
CREATE INDEX "idx_rolls_streamer" ON "rolls"("streamer");

-- CreateIndex
CREATE INDEX "idx_rolls_streamer_state_created" ON "rolls"("streamer", "state", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "rolls_user_id_roll_type_streamer_key" ON "rolls"("user_id", "roll", "type", "streamer");

-- CreateIndex
CREATE INDEX "idx_fetched_user_created" ON "fetched_rolls"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_fetched_streamer" ON "fetched_rolls"("streamer");

-- CreateIndex
CREATE INDEX "idx_fetched_streamer_user_created" ON "fetched_rolls"("streamer", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fetched_rolls_user_id_roll_type_streamer_key" ON "fetched_rolls"("user_id", "roll", "type", "streamer");
