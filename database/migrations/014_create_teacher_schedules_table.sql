USE cobaem30;

CREATE TABLE IF NOT EXISTS docente_horarios (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    docente_id BIGINT UNSIGNED NOT NULL,
    dia VARCHAR(12) NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    materia VARCHAR(150) NOT NULL,
    grupo VARCHAR(80) NULL,
    aula VARCHAR(80) NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_docente_horario_bloque (docente_id, dia, hora_inicio, hora_fin),
    CONSTRAINT chk_docente_horario_dia CHECK (dia IN ('LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO')),
    CONSTRAINT chk_docente_horario_horas CHECK (hora_inicio < hora_fin),
    CONSTRAINT fk_docente_horario_docente FOREIGN KEY (docente_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;