-- Migracion forward-only: cada sentencia DDL puede producir autocommit en MySQL.
-- Requiere runner, precondiciones y postverificacion; una estructura parcial
-- debe detenerse para revision y no debe repararse ni reintentarse automaticamente.

CREATE TABLE tipos_actividad_docente (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion VARCHAR(500) NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tipos_actividad_docente_clave (clave),
    KEY idx_tipos_actividad_docente_admin (activo, nombre, id),
    CONSTRAINT chk_tipos_actividad_docente_clave
        CHECK (CHAR_LENGTH(TRIM(clave)) > 0),
    CONSTRAINT chk_tipos_actividad_docente_nombre
        CHECK (CHAR_LENGTH(TRIM(nombre)) > 0),
    CONSTRAINT chk_tipos_actividad_docente_activo
        CHECK (activo IN (0, 1))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE actividades_docente_no_lectivas (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    docente_usuario_id BIGINT UNSIGNED NOT NULL,
    periodo_academico_id INT UNSIGNED NOT NULL,
    tipo_actividad_docente_id INT UNSIGNED NOT NULL,
    aula_id INT UNSIGNED NULL,
    titulo VARCHAR(150) NOT NULL,
    observaciones VARCHAR(500) NULL,
    dia_semana TINYINT UNSIGNED NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NULL,
    creado_por_usuario_id BIGINT UNSIGNED NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_actividades_docente_periodo_vigencia_horario
        (docente_usuario_id, periodo_academico_id, fecha_inicio, fecha_fin, dia_semana, hora_inicio, hora_fin),
    KEY idx_actividades_aula_periodo_vigencia_horario
        (aula_id, periodo_academico_id, fecha_inicio, fecha_fin, dia_semana, hora_inicio, hora_fin),
    KEY idx_actividades_periodo_vigencia_horario
        (periodo_academico_id, fecha_inicio, fecha_fin, dia_semana, hora_inicio, hora_fin),
    KEY idx_actividades_tipo_periodo
        (tipo_actividad_docente_id, periodo_academico_id),
    KEY idx_actividades_creador
        (creado_por_usuario_id),
    CONSTRAINT chk_actividades_dia_semana
        CHECK (dia_semana BETWEEN 1 AND 5),
    CONSTRAINT chk_actividades_horas
        CHECK (hora_inicio < hora_fin),
    CONSTRAINT chk_actividades_vigencia
        CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
    CONSTRAINT chk_actividades_titulo
        CHECK (CHAR_LENGTH(TRIM(titulo)) > 0),
    CONSTRAINT chk_actividades_observaciones
        CHECK (observaciones IS NULL OR CHAR_LENGTH(TRIM(observaciones)) > 0),
    CONSTRAINT fk_actividades_docente
        FOREIGN KEY (docente_usuario_id) REFERENCES usuarios (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_actividades_periodo
        FOREIGN KEY (periodo_academico_id) REFERENCES periodos_academicos (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_actividades_tipo
        FOREIGN KEY (tipo_actividad_docente_id) REFERENCES tipos_actividad_docente (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_actividades_aula
        FOREIGN KEY (aula_id) REFERENCES aulas (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_actividades_creador
        FOREIGN KEY (creado_por_usuario_id) REFERENCES usuarios (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
