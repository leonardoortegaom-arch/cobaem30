require('dotenv').config({ quiet: true });

const readline = require('node:readline');
const readlinePromises = require('node:readline/promises');
const bcrypt = require('bcrypt');

const pool = require('../config/database');
const usuarioModel = require('../models/usuarioModel');

const RONDAS_BCRYPT = 12;
const CORREO_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ValidationError extends Error {}

const solicitarDatosVisibles = async () => {
    const interfaz = readlinePromises.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        return {
            nombre: (await interfaz.question('Nombre: ')).trim(),
            apellidoPaterno: (await interfaz.question('Apellido paterno: ')).trim(),
            apellidoMaterno: (await interfaz.question('Apellido materno : ')).trim(),
            correo: (await interfaz.question('Correo: ')).trim().toLowerCase()
        };
    } finally {
        interfaz.close();
    }
};

const solicitarSecreto = (mensaje) => new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
        reject(new ValidationError('Se requiere una terminal interactiva para capturar la contraseña de forma segura.'));
        return;
    }

    let valor = '';
    const estadoRawAnterior = Boolean(process.stdin.isRaw);

    const limpiar = () => {
        process.stdin.removeListener('keypress', manejarTecla);
        process.stdin.setRawMode(estadoRawAnterior);
        process.stdin.pause();
    };

    const manejarTecla = (caracter, tecla = {}) => {
        if (tecla.ctrl && tecla.name === 'c') {
            limpiar();
            process.stdout.write('\n');
            reject(new ValidationError('Operación cancelada.'));
            return;
        }

        if (tecla.name === 'return' || tecla.name === 'enter') {
            limpiar();
            process.stdout.write('\n');
            resolve(valor);
            return;
        }

        if (tecla.name === 'backspace') {
            valor = valor.slice(0, -1);
            return;
        }

        if (caracter && !tecla.ctrl && !tecla.meta) {
            valor += caracter;
        }
    };

    readline.emitKeypressEvents(process.stdin);
    process.stdout.write(mensaje);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', manejarTecla);
});

const validarDatos = ({ nombre, apellidoPaterno, correo, password, confirmacion }) => {
    if (!nombre) {
        throw new ValidationError('El nombre es obligatorio.');
    }

    if (!apellidoPaterno) {
        throw new ValidationError('El apellido paterno es obligatorio.');
    }

    if (!CORREO_REGEX.test(correo)) {
        throw new ValidationError('El correo no tiene un formato válido.');
    }

    if (password.length < 8) {
        throw new ValidationError('La contraseña debe tener al menos 12 caracteres.');
    }

    if (password !== confirmacion) {
        throw new ValidationError('La confirmación de contraseña no coincide.');
    }
};

const buscarRolAdministrador = async () => {
    const [rows] = await pool.execute(
        'SELECT id FROM roles WHERE clave = ? LIMIT 1',
        ['ADMINISTRADOR']
    );

    return rows[0] || null;
};

const crearAdministrador = async () => {
    try {
        const datos = await solicitarDatosVisibles();
        const password = await solicitarSecreto('Contraseña: ');
        const confirmacion = await solicitarSecreto('Confirmar contraseña: ');

        validarDatos({ ...datos, password, confirmacion });

        const usuarioExistente = await usuarioModel.buscarPorCorreo(datos.correo);
        if (usuarioExistente) {
            throw new ValidationError('Ya existe un usuario con ese correo.');
        }

        const rol = await buscarRolAdministrador();
        if (!rol) {
            throw new ValidationError('No existe el rol ADMINISTRADOR. Ejecute primero la migración correspondiente.');
        }

        const passwordHash = await bcrypt.hash(password, RONDAS_BCRYPT);
        const id = await usuarioModel.crear({
            rol_id: rol.id,
            nombre: datos.nombre,
            apellido_paterno: datos.apellidoPaterno,
            apellido_materno: datos.apellidoMaterno || null,
            correo: datos.correo,
            password_hash: passwordHash,
            activo: true
        });

        console.log('El administrador fue creado.');
        console.log(`Correo: ${datos.correo}`);
        console.log(`ID: ${id}`);
    } catch (error) {
        if (error instanceof ValidationError) {
            console.error(error.message);
        } else {
            console.error('No fue posible crear el administrador.');
        }

        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

crearAdministrador();
