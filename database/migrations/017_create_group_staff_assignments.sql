-- Migración forward-only: cada sentencia DDL puede producir autocommit en MySQL.
-- Requiere runner, precondiciones y postverificación; una estructura parcial
-- debe detenerse para revisión y no debe repararse automáticamente.

CREATE TABLE asignaciones_orientador_grupo (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    grupo_id INT UNSIGNED NOT NULL,
    orientador_usuario_id BIGINT UNSIGNED NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NULL,
    grupo_vigente_id INT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN fecha_fin IS NULL THEN grupo_id ELSE NULL END
    ) STORED,
    creado_por_usuario_id BIGINT UNSIGNED NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_orientador_grupo_vigente (grupo_vigente_id),
    KEY idx_asignacion_orientador_grupo_intervalo (grupo_id, fecha_inicio, fecha_fin),
    KEY idx_orientador_vigencia (orientador_usuario_id, fecha_inicio, fecha_fin, grupo_id),
    KEY idx_asignacion_orientador_creado_por (creado_por_usuario_id),
    CONSTRAINT chk_asignacion_orientador_fechas
        CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
    CONSTRAINT fk_asignacion_orientador_grupo
        FOREIGN KEY (grupo_id) REFERENCES grupos (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_asignacion_orientador_usuario
        FOREIGN KEY (orientador_usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_asignacion_orientador_creado_por
        FOREIGN KEY (creado_por_usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE asignaciones_tutor_grupo (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    grupo_id INT UNSIGNED NOT NULL,
    tutor_usuario_id BIGINT UNSIGNED NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NULL,
    grupo_vigente_id INT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN fecha_fin IS NULL THEN grupo_id ELSE NULL END
    ) STORED,
    creado_por_usuario_id BIGINT UNSIGNED NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tutor_grupo_vigente (grupo_vigente_id),
    KEY idx_asignacion_tutor_grupo_intervalo (grupo_id, fecha_inicio, fecha_fin),
    KEY idx_tutor_vigencia (tutor_usuario_id, fecha_inicio, fecha_fin, grupo_id),
    KEY idx_asignacion_tutor_creado_por (creado_por_usuario_id),
    CONSTRAINT chk_asignacion_tutor_fechas
        CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
    CONSTRAINT fk_asignacion_tutor_grupo
        FOREIGN KEY (grupo_id) REFERENCES grupos (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_asignacion_tutor_usuario
        FOREIGN KEY (tutor_usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_asignacion_tutor_creado_por
        FOREIGN KEY (creado_por_usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
