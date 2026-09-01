USE cobaem30;

SET @version_credenciales_existe = (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'usuarios'
      AND COLUMN_NAME = 'version_credenciales'
);

SET @sql_version_credenciales = IF(
    @version_credenciales_existe = 0,
    'ALTER TABLE usuarios ADD COLUMN version_credenciales INT UNSIGNED NOT NULL DEFAULT 1 AFTER password_hash',
    'SELECT ''La columna version_credenciales ya existe.'' AS mensaje'
);

PREPARE stmt_version_credenciales FROM @sql_version_credenciales;
EXECUTE stmt_version_credenciales;
DEALLOCATE PREPARE stmt_version_credenciales;
