-- Migración forward-only: cada sentencia DDL puede producir autocommit en MySQL.
-- Requiere runner, precondiciones y postverificación; una estructura parcial
-- debe detenerse para revisión y no debe repararse ni reintentarse automáticamente.

CREATE TABLE importaciones_horario (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    grupo_id INT UNSIGNED NOT NULL,
    periodo_academico_id INT UNSIGNED NOT NULL,
    nombre_archivo_original VARCHAR(255) NOT NULL,
    archivo_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    archivo_tamano_bytes BIGINT UNSIGNED NOT NULL,
    total_filas SMALLINT UNSIGNED NOT NULL,
    version_formato SMALLINT UNSIGNED NOT NULL,
    importado_por_usuario_id BIGINT UNSIGNED NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_importaciones_alcance_archivo
        (grupo_id, periodo_academico_id, archivo_sha256),
    UNIQUE KEY uq_importaciones_identidad_alcance
        (id, grupo_id, periodo_academico_id),
    KEY idx_importaciones_historial
        (grupo_id, periodo_academico_id, creado_en, id),
    KEY idx_importaciones_periodo (periodo_academico_id),
    KEY idx_importaciones_administrador
        (importado_por_usuario_id, creado_en, id),
    CONSTRAINT chk_importaciones_nombre_archivo
        CHECK (CHAR_LENGTH(TRIM(nombre_archivo_original)) > 0),
    CONSTRAINT chk_importaciones_sha256
        CHECK (archivo_sha256 REGEXP '^[0-9a-fA-F]{64}$'),
    CONSTRAINT chk_importaciones_tamano
        CHECK (archivo_tamano_bytes > 0),
    CONSTRAINT chk_importaciones_total_filas
        CHECK (total_filas BETWEEN 1 AND 500),
    CONSTRAINT chk_importaciones_version_formato
        CHECK (version_formato >= 1),
    CONSTRAINT fk_importaciones_grupo
        FOREIGN KEY (grupo_id) REFERENCES grupos (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_importaciones_periodo
        FOREIGN KEY (periodo_academico_id) REFERENCES periodos_academicos (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_importaciones_usuario
        FOREIGN KEY (importado_por_usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE versiones_horario (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    grupo_id INT UNSIGNED NOT NULL,
    periodo_academico_id INT UNSIGNED NOT NULL,
    numero_version INT UNSIGNED NOT NULL,
    importacion_id BIGINT UNSIGNED NULL,
    version_origen_id BIGINT UNSIGNED NULL,
    activa BOOLEAN NOT NULL DEFAULT FALSE,
    total_clases SMALLINT UNSIGNED NOT NULL,
    grupo_activo_id INT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN activa = 1 THEN grupo_id ELSE NULL END
    ) STORED,
    periodo_activo_id INT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN activa = 1 THEN periodo_academico_id ELSE NULL END
    ) STORED,
    creada_por_usuario_id BIGINT UNSIGNED NOT NULL,
    activada_en TIMESTAMP NULL,
    desactivada_en TIMESTAMP NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_versiones_numero_alcance
        (grupo_id, periodo_academico_id, numero_version),
    UNIQUE KEY uq_versiones_alcance_activo
        (grupo_activo_id, periodo_activo_id),
    UNIQUE KEY uq_versiones_importacion (importacion_id),
    UNIQUE KEY uq_versiones_identidad_alcance
        (id, grupo_id, periodo_academico_id),
    KEY idx_versiones_periodo (periodo_academico_id),
    KEY idx_versiones_importacion_alcance
        (importacion_id, grupo_id, periodo_academico_id),
    KEY idx_versiones_origen_alcance
        (version_origen_id, grupo_id, periodo_academico_id),
    KEY idx_versiones_creador
        (creada_por_usuario_id, creado_en, id),
    CONSTRAINT chk_versiones_numero
        CHECK (numero_version >= 1),
    CONSTRAINT chk_versiones_total_clases
        CHECK (total_clases BETWEEN 1 AND 500),
    CONSTRAINT chk_versiones_activa
        CHECK (activa IN (0, 1)),
    CONSTRAINT chk_versiones_origen_exclusivo
        CHECK (
            (importacion_id IS NOT NULL AND version_origen_id IS NULL)
            OR
            (importacion_id IS NULL AND version_origen_id IS NOT NULL)
        ),
    CONSTRAINT chk_versiones_activa_fechas
        CHECK (
            activa = 0
            OR (activada_en IS NOT NULL AND desactivada_en IS NULL)
        ),
    CONSTRAINT chk_versiones_desactivacion
        CHECK (
            desactivada_en IS NULL
            OR (activada_en IS NOT NULL AND desactivada_en >= activada_en)
        ),
    CONSTRAINT fk_versiones_grupo
        FOREIGN KEY (grupo_id) REFERENCES grupos (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_versiones_periodo
        FOREIGN KEY (periodo_academico_id) REFERENCES periodos_academicos (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_versiones_creador
        FOREIGN KEY (creada_por_usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_versiones_importacion_alcance
        FOREIGN KEY (importacion_id, grupo_id, periodo_academico_id)
        REFERENCES importaciones_horario (id, grupo_id, periodo_academico_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_versiones_origen_alcance
        FOREIGN KEY (version_origen_id, grupo_id, periodo_academico_id)
        REFERENCES versiones_horario (id, grupo_id, periodo_academico_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
