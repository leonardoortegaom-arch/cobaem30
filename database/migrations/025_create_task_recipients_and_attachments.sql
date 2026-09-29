CREATE TABLE destinatarios_tarea_academica (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tarea_id BIGINT UNSIGNED NOT NULL,
    alumno_usuario_id BIGINT UNSIGNED NOT NULL,
    asignado_por_usuario_id BIGINT UNSIGNED NOT NULL,
    es_incorporacion_posterior BOOLEAN NOT NULL,
    fecha_limite_individual DATETIME NULL,
    asignado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_destinatarios_tarea_alumno (tarea_id, alumno_usuario_id),
    KEY idx_destinatarios_alumno_tarea (alumno_usuario_id, tarea_id, id),
    KEY idx_destinatarios_incorporacion (es_incorporacion_posterior, tarea_id, id),
    KEY idx_destinatarios_asignador (asignado_por_usuario_id, asignado_en, id),
    KEY idx_destinatarios_plazo (fecha_limite_individual, id),
    CONSTRAINT fk_destinatarios_tarea FOREIGN KEY (tarea_id) REFERENCES tareas_academicas (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_destinatarios_alumno FOREIGN KEY (alumno_usuario_id) REFERENCES alumnos (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_destinatarios_asignador FOREIGN KEY (asignado_por_usuario_id) REFERENCES usuarios (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_destinatarios_incorporacion CHECK (es_incorporacion_posterior IN (0, 1)),
    CONSTRAINT chk_destinatarios_plazo CHECK (
        (es_incorporacion_posterior = 0 AND fecha_limite_individual IS NULL)
        OR (es_incorporacion_posterior = 1 AND fecha_limite_individual IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE historial_plazos_destinatario_tarea (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    destinatario_tarea_id BIGINT UNSIGNED NOT NULL,
    fecha_limite_anterior DATETIME NULL,
    fecha_limite_nueva DATETIME NOT NULL,
    cambiado_por_usuario_id BIGINT UNSIGNED NOT NULL,
    motivo VARCHAR(500) NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_historial_plazos_destinatario (destinatario_tarea_id, creado_en, id),
    KEY idx_historial_plazos_auditor (cambiado_por_usuario_id, creado_en, id),
    CONSTRAINT fk_historial_plazos_destinatario FOREIGN KEY (destinatario_tarea_id) REFERENCES destinatarios_tarea_academica (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_historial_plazos_auditor FOREIGN KEY (cambiado_por_usuario_id) REFERENCES usuarios (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_historial_plazos_cambio CHECK (fecha_limite_anterior IS NULL OR fecha_limite_nueva <> fecha_limite_anterior),
    CONSTRAINT chk_historial_plazos_motivo CHECK (CHAR_LENGTH(TRIM(motivo)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE adjuntos_tarea_academica (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tarea_id BIGINT UNSIGNED NOT NULL,
    orden TINYINT UNSIGNED NOT NULL,
    creado_por_usuario_id BIGINT UNSIGNED NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_adjuntos_tarea_orden (tarea_id, orden),
    KEY idx_adjuntos_tarea_creador (creado_por_usuario_id, creado_en, id),
    CONSTRAINT fk_adjuntos_tarea FOREIGN KEY (tarea_id) REFERENCES tareas_academicas (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_adjuntos_tarea_creador FOREIGN KEY (creado_por_usuario_id) REFERENCES usuarios (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_adjuntos_tarea_orden CHECK (orden BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE versiones_adjunto_tarea_academica (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    adjunto_tarea_id BIGINT UNSIGNED NOT NULL,
    numero_version INT UNSIGNED NOT NULL,
    nombre_original VARCHAR(255) NOT NULL,
    nombre_interno VARCHAR(255) NOT NULL,
    extension VARCHAR(20) NOT NULL,
    mime_detectado VARCHAR(150) NOT NULL,
    tamano_bytes BIGINT UNSIGNED NOT NULL,
    sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    motivo_cambio VARCHAR(500) NULL,
    creado_por_usuario_id BIGINT UNSIGNED NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_versiones_adjunto_numero (adjunto_tarea_id, numero_version),
    UNIQUE KEY uq_versiones_adjunto_nombre_interno (nombre_interno),
    KEY idx_versiones_adjunto_sha256 (sha256),
    KEY idx_versiones_adjunto_creador (creado_por_usuario_id, creado_en, id),
    CONSTRAINT fk_versiones_adjunto_logico FOREIGN KEY (adjunto_tarea_id) REFERENCES adjuntos_tarea_academica (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_versiones_adjunto_creador FOREIGN KEY (creado_por_usuario_id) REFERENCES usuarios (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_versiones_adjunto_numero CHECK (numero_version >= 1),
    CONSTRAINT chk_versiones_adjunto_nombre_original CHECK (CHAR_LENGTH(TRIM(nombre_original)) > 0),
    CONSTRAINT chk_versiones_adjunto_nombre_interno CHECK (CHAR_LENGTH(TRIM(nombre_interno)) > 0),
    CONSTRAINT chk_versiones_adjunto_extension CHECK (CHAR_LENGTH(TRIM(extension)) > 0),
    CONSTRAINT chk_versiones_adjunto_mime CHECK (CHAR_LENGTH(TRIM(mime_detectado)) > 0),
    CONSTRAINT chk_versiones_adjunto_tamano CHECK (tamano_bytes > 0 AND tamano_bytes <= 52428800),
    CONSTRAINT chk_versiones_adjunto_sha256 CHECK (sha256 REGEXP '^[0-9A-Fa-f]{64}$'),
    CONSTRAINT chk_versiones_adjunto_motivo CHECK (
        (numero_version = 1 AND (motivo_cambio IS NULL OR CHAR_LENGTH(TRIM(motivo_cambio)) > 0))
        OR (numero_version > 1 AND motivo_cambio IS NOT NULL AND CHAR_LENGTH(TRIM(motivo_cambio)) > 0)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
