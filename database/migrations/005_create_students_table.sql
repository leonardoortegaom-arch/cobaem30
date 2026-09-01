USE cobaem30;

CREATE TABLE IF NOT EXISTS alumnos (
    usuario_id BIGINT UNSIGNED NOT NULL,
    grupo_id INT UNSIGNED NOT NULL,
    matricula CHAR(9) NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (usuario_id),
    UNIQUE KEY uq_alumnos_matricula (matricula),
    KEY idx_alumnos_grupo_id (grupo_id),
    CONSTRAINT chk_alumnos_matricula
        CHECK (matricula REGEXP '^[0-9]{9}$'),
    CONSTRAINT fk_alumnos_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_alumnos_grupo
        FOREIGN KEY (grupo_id) REFERENCES grupos (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
