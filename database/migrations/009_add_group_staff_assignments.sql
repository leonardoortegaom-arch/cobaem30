USE cobaem30;

ALTER TABLE grupos
    ADD COLUMN docente_id BIGINT UNSIGNED NULL AFTER turno_id,
    ADD COLUMN orientador_id BIGINT UNSIGNED NULL AFTER docente_id,
    ADD KEY idx_grupos_docente_id (docente_id),
    ADD KEY idx_grupos_orientador_id (orientador_id),
    ADD CONSTRAINT fk_grupos_docente
        FOREIGN KEY (docente_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_grupos_orientador
        FOREIGN KEY (orientador_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT;