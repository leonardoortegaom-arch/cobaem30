const pool = require('../config/database');
const usuarioModel = require('../models/usuarioModel');
const alumnoModel = require('../models/alumnoModel');

const crearUsuarioConPerfil = async ({ usuario, alumno }) => {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();
        const usuarioId = await usuarioModel.crear(usuario, connection);

        if (alumno !== null) {
            await alumnoModel.crear({
                ...alumno,
                usuario_id: usuarioId
            }, connection);
        }

        await connection.commit();
        return usuarioId;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = {
    crearUsuarioConPerfil
};
