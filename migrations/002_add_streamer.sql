-- Adiciona coluna streamer na tabela rolls
ALTER TABLE rolls
ADD COLUMN streamer VARCHAR(100) NOT NULL DEFAULT '' AFTER user_id;

-- Atualiza unique key para incluir streamer
ALTER TABLE rolls
DROP INDEX uniq_roll_per_user,
ADD UNIQUE KEY uniq_roll_per_user_streamer (user_id, roll, type, streamer);

-- Adiciona índice para streamer
ALTER TABLE rolls
ADD INDEX idx_rolls_streamer (streamer);

-- Adiciona índice composto para streamer + state + created_at
ALTER TABLE rolls
ADD INDEX idx_rolls_streamer_state_created (streamer, state, created_at, id);

-- Remove DEFAULT após adicionar a coluna (streamer deve ser sempre fornecido)
ALTER TABLE rolls
ALTER COLUMN streamer DROP DEFAULT;

-- Adiciona coluna streamer na tabela fetched_rolls
ALTER TABLE fetched_rolls
ADD COLUMN streamer VARCHAR(100) NOT NULL DEFAULT '' AFTER user_id;

-- Atualiza unique key para incluir streamer
ALTER TABLE fetched_rolls
DROP INDEX uniq_fetched_per_user,
ADD UNIQUE KEY uniq_fetched_per_user_streamer (user_id, roll, type, streamer);

-- Adiciona índice para streamer
ALTER TABLE fetched_rolls
ADD INDEX idx_fetched_streamer (streamer);

-- Adiciona índice composto para streamer + user + created_at
ALTER TABLE fetched_rolls
ADD INDEX idx_fetched_streamer_user_created (streamer, user_id, created_at);

-- Remove DEFAULT após adicionar a coluna (streamer deve ser sempre fornecido)
ALTER TABLE fetched_rolls
ALTER COLUMN streamer DROP DEFAULT;

