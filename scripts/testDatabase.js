require('dotenv').config({ quiet: true });

const pool = require('../config/database');

const testDatabase = async () => {
    let connection;

    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(
            'SELECT DATABASE() AS databaseName, CURRENT_USER() AS currentUser'
        );

        console.log(`Base de datos: ${rows[0].databaseName}`);
        console.log(`Usuario conectado: ${rows[0].currentUser}`);
    } catch (error) {
        console.error('No fue posible comprobar la conexión con la base de datos.');
        console.error('Detalle del error:', error);
        process.exitCode = 1;
    } finally {
        if (connection) {
            connection.release();
        }

        await pool.end();
    }
};

testDatabase();