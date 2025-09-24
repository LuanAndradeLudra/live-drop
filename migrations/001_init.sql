CREATE TABLE IF NOT EXISTS rolls (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  roll VARCHAR(100) NOT NULL,
  type ENUM('upgrade','case') NOT NULL DEFAULT 'upgrade',
  state ENUM('queued','processing','failed') NOT NULL DEFAULT 'queued',
  tries INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_roll_per_user (user_id, roll, type),
  INDEX idx_rolls_state_created (state, created_at, id),
  INDEX idx_rolls_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fetched_rolls (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  roll VARCHAR(100) NOT NULL,
  type ENUM('upgrade','case') NOT NULL,
  data JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_fetched_per_user (user_id, roll, type),
  INDEX idx_fetched_user_created (user_id, created_at)
) ENGINE=InnoDB;
