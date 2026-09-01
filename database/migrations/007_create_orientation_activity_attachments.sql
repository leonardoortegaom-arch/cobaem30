USE cobaem30;

CREATE TABLE IF NOT EXISTS adjuntos_actividad_orientacion (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actividad_orientacion_id BIGINT UNSIGNED NOT NULL,
    subido_por_usuario_id BIGINT UNSIGNED NOT NULL,
    nombre_original VARCHAR(255) NOT NULL,
    clave_almacenamiento VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    extension VARCHAR(15) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    tamano_bytes BIGINT UNSIGNED NOT NULL,
    hash_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_adjuntos_actividad_clave_almacenamiento (clave_almacenamiento),
    KEY idx_adjuntos_actividad_creado_id (actividad_orientacion_id, creado_en, id),
    KEY idx_adjuntos_usuario_creado (subido_por_usuario_id, creado_en),
    KEY idx_adjuntos_hash_sha256 (hash_sha256),
    CONSTRAINT chk_adjuntos_tamano_bytes
        CHECK (tamano_bytes > 0 AND tamano_bytes <= 104857600),
    CONSTRAINT chk_adjuntos_hash_sha256
        CHECK (hash_sha256 REGEXP '^[0-9A-Fa-f]{64}$'),
    CONSTRAINT fk_adjuntos_actividad
        FOREIGN KEY (actividad_orientacion_id) REFERENCES actividades_orientacion (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_adjuntos_usuario
        FOREIGN KEY (subido_por_usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
