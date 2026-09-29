CREATE TABLE intentos_entrega_tarea (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    destinatario_tarea_academica_id BIGINT UNSIGNED NOT NULL,
    numero_intento INT UNSIGNED NOT NULL,
    clave_idempotencia_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    estado_entrega_actual_id TINYINT UNSIGNED NOT NULL,
    fecha_limite_efectiva TIMESTAMP NOT NULL,
    enviado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    es_tardia BOOLEAN NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_intentos_destinatario_numero (destinatario_tarea_academica_id, numero_intento),
    UNIQUE KEY uq_intentos_destinatario_idempotencia (destinatario_tarea_academica_id, clave_idempotencia_hash),
    KEY idx_intentos_destinatario_envio (destinatario_tarea_academica_id, enviado_en, id),
    KEY idx_intentos_estado_envio (estado_entrega_actual_id, enviado_en, id),
    CONSTRAINT fk_intentos_destinatario FOREIGN KEY (destinatario_tarea_academica_id) REFERENCES destinatarios_tarea_academica (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_intentos_estado FOREIGN KEY (estado_entrega_actual_id) REFERENCES estados_entrega_tarea (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_intentos_numero CHECK (numero_intento >= 1),
    CONSTRAINT chk_intentos_idempotencia CHECK (clave_idempotencia_hash REGEXP '^[0-9A-Fa-f]{64}$'),
    CONSTRAINT chk_intentos_tardia CHECK (es_tardia IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE adjuntos_intento_entrega (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    intento_entrega_tarea_id BIGINT UNSIGNED NOT NULL,
    subido_por_usuario_id BIGINT UNSIGNED NOT NULL,
    orden TINYINT UNSIGNED NOT NULL,
    nombre_original VARCHAR(255) NOT NULL,
    clave_almacenamiento CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    extension VARCHAR(20) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    tamano_bytes BIGINT UNSIGNED NOT NULL,
    hash_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_adjuntos_intento_orden (intento_entrega_tarea_id, orden),
    UNIQUE KEY uq_adjuntos_intento_almacenamiento (clave_almacenamiento),
    KEY idx_adjuntos_intento_hash (hash_sha256),
    KEY idx_adjuntos_intento_usuario (subido_por_usuario_id, creado_en, id),
    CONSTRAINT fk_adjuntos_intento FOREIGN KEY (intento_entrega_tarea_id) REFERENCES intentos_entrega_tarea (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_adjuntos_intento_usuario FOREIGN KEY (subido_por_usuario_id) REFERENCES usuarios (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_adjuntos_intento_orden CHECK (orden BETWEEN 1 AND 5),
    CONSTRAINT chk_adjuntos_intento_nombre CHECK (CHAR_LENGTH(TRIM(nombre_original)) > 0),
    CONSTRAINT chk_adjuntos_intento_almacenamiento CHECK (CHAR_LENGTH(TRIM(clave_almacenamiento)) > 0),
    CONSTRAINT chk_adjuntos_intento_extension CHECK (CHAR_LENGTH(TRIM(extension)) > 0),
    CONSTRAINT chk_adjuntos_intento_mime CHECK (CHAR_LENGTH(TRIM(mime_type)) > 0),
    CONSTRAINT chk_adjuntos_intento_tamano CHECK (tamano_bytes > 0 AND tamano_bytes <= 52428800),
    CONSTRAINT chk_adjuntos_intento_hash CHECK (hash_sha256 REGEXP '^[0-9A-Fa-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE contexto_adjuntos_intento_tarea (
    intento_entrega_tarea_id BIGINT UNSIGNED NOT NULL,
    version_adjunto_tarea_academica_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (intento_entrega_tarea_id, version_adjunto_tarea_academica_id),
    KEY idx_contexto_version_intento (version_adjunto_tarea_academica_id, intento_entrega_tarea_id),
    CONSTRAINT fk_contexto_adjuntos_intento FOREIGN KEY (intento_entrega_tarea_id) REFERENCES intentos_entrega_tarea (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_contexto_adjuntos_version FOREIGN KEY (version_adjunto_tarea_academica_id) REFERENCES versiones_adjunto_tarea_academica (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
