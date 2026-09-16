-- Migracion forward-only: la sentencia DDL puede producir autocommit en MySQL.
-- Requiere runner, precondiciones y postverificacion; una estructura parcial
-- debe detenerse para revision y no debe repararse ni reintentarse automaticamente.

CREATE TABLE clases_programadas (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    version_horario_id BIGINT UNSIGNED NOT NULL,
    materia_id INT UNSIGNED NOT NULL,
    docente_usuario_id BIGINT UNSIGNED NOT NULL,
    aula_id INT UNSIGNED NULL,
    dia_semana TINYINT UNSIGNED NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_clases_version_bloque
        (version_horario_id, dia_semana, hora_inicio, hora_fin),
    KEY idx_clases_docente_horario
        (docente_usuario_id, dia_semana, hora_inicio, hora_fin, version_horario_id),
    KEY idx_clases_aula_horario
        (aula_id, dia_semana, hora_inicio, hora_fin, version_horario_id),
    KEY idx_clases_materia_version
        (materia_id, version_horario_id),
    CONSTRAINT chk_clases_dia_semana
        CHECK (dia_semana BETWEEN 1 AND 6),
    CONSTRAINT chk_clases_horas
        CHECK (hora_inicio < hora_fin),
    CONSTRAINT fk_clases_version_horario
        FOREIGN KEY (version_horario_id) REFERENCES versiones_horario (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_clases_materia
        FOREIGN KEY (materia_id) REFERENCES materias (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_clases_docente
        FOREIGN KEY (docente_usuario_id) REFERENCES usuarios (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_clases_aula
        FOREIGN KEY (aula_id) REFERENCES aulas (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
