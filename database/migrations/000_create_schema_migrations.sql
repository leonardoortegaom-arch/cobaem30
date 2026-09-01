-- Registra únicamente migraciones completadas correctamente.
-- Los estados superseded, reserved y planned pertenecen al manifiesto.
-- La compatibilidad estructural del esquema debe verificarse después del bootstrap.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT UNSIGNED NOT NULL,
    archivo VARCHAR(255) NOT NULL,
    checksum_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tipo_registro VARCHAR(20) NOT NULL,
    aplicada_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    duracion_ms INT UNSIGNED NULL,
    lote_ejecucion CHAR(36) NULL,
    PRIMARY KEY (version),
    UNIQUE KEY uq_schema_migrations_archivo (archivo),
    CONSTRAINT chk_schema_migrations_checksum
        CHECK (checksum_sha256 REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT chk_schema_migrations_tipo_registro
        CHECK (tipo_registro IN ('EJECUTADA', 'BASELINE'))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
