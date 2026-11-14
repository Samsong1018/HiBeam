-- Schema for auth-account-endpoints.
-- Requires MySQL max_allowed_packet >= 3 MB for avatar uploads (limit of 2,097,152 bytes is enforced in code).

CREATE TABLE IF NOT EXISTS users (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(24)  NOT NULL,
  username_lc    VARCHAR(24)  NOT NULL,
  email          VARCHAR(254) NOT NULL,
  email_lc       VARCHAR(254) NOT NULL,
  display_name   VARCHAR(60)  NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  -- avatar, avatar_mime, avatar_updated_at are either all NULL or all set.
  -- avatar_mime is one of image/png, image/jpeg, image/webp.
  -- avatar_updated_at is epoch seconds.
  avatar            MEDIUMBLOB NULL,
  avatar_mime       VARCHAR(16) NULL,
  avatar_updated_at BIGINT UNSIGNED NULL,
  preferences    JSON NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username_lc),
  UNIQUE KEY uq_users_email (email_lc)
);

CREATE TABLE IF NOT EXISTS sessions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME NOT NULL,
  revoked_at  DATETIME NULL,
  INDEX (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reset_tokens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  INDEX (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_tokens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  new_email   VARCHAR(254) NOT NULL,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  INDEX (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  identifier  VARCHAR(254) NOT NULL,
  success     TINYINT(1) NOT NULL,
  at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (identifier, at)
);

CREATE TABLE IF NOT EXISTS sources (
  id           VARCHAR(64) PRIMARY KEY,
  owner_id     BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(100) NOT NULL,
  type         VARCHAR(20)  NOT NULL,
  status       VARCHAR(10)  NOT NULL DEFAULT 'untested',
  key_enc      TEXT NOT NULL,
  key_last4    VARCHAR(4) NOT NULL,
  last_sync_at DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (owner_id),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dashboards (
  id          VARCHAR(64) PRIMARY KEY,
  owner_id    BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  definition  JSON NOT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (owner_id),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
