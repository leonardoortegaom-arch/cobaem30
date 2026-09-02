-- Migración forward-only: ALTER TABLE puede producir autocommit en MySQL.
-- No transforma datos heredados ni asigna valores a las referencias nuevas.
-- Requiere precondiciones, respaldo y postverificación mediante el runner.

ALTER TABLE grupos
    ADD COLUMN generacion_id INT UNSIGNED NULL AFTER ciclo_escolar,
    ADD COLUMN periodo_academico_id INT UNSIGNED NULL AFTER generacion_id,
    ADD KEY idx_grupos_generacion_id (generacion_id),
    ADD KEY idx_grupos_periodo_academico_id (periodo_academico_id),
    ADD CONSTRAINT fk_grupos_generacion
        FOREIGN KEY (generacion_id) REFERENCES generaciones (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_grupos_periodo_academico
        FOREIGN KEY (periodo_academico_id) REFERENCES periodos_academicos (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT;
