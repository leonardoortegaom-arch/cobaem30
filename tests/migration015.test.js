'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { calcularChecksumCanonico } = require('../scripts/migrationManifest');

const root = path.resolve(__dirname, '..');
const sqlPath = path.join(root, 'database', 'migrations', '015_create_academic_calendar_catalogs.sql');
const manifest = require('../database/migration-manifest.json');
const entry = manifest.migraciones.find((item) => item.version === 15);
const sql = fs.readFileSync(sqlPath, 'utf8');
const clean = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '').trim();
const statements = clean.split(';').map((item) => item.trim()).filter(Boolean);
const lower = clean.toLowerCase();
const tableNames = statements.map((item) => (item.match(/^create\s+table\s+`?([a-z_]+)`?/i) || [])[1]);
const expectedOldChecksums = {
    0:'413fd0888304919f30672f8381a638a6149650115d79b8205d38150a040a81fc',
    1:'ad68e724862da643efd18a6c3207e765a611685714ea2168ccee71068011855e',
    2:'9cb3e17ad5e06ea599588b8d8da53839b28fbdd046f3dcf9256612406f9a8822',
    3:'fd8eb58fc5395a9158b44f9d69758648db9d59114ab85ac025d7eb0a195eb9b5',
    4:'3f4e4aa150eee70cc6a66b2c13d36e1ca4691cac0e6e0f8c69f4619b399426a8',
    5:'2bdc73446aadaaadea1b3f7d359215eb87bdfcf6a0b2cfee6e5e5b8ce904b683',
    6:'d4f2260bd3d2eef8a95d43098d77a51deb96629d529ad55d6067a2666c589a85',
    7:'2582c11f32d2771476df4a937bf2c4f1af2afe4229fcdd19c8f47db52cab269a',
    8:'f9dfa55c7ab1fe412bb749e986b2354813322664fe90201daed9247b719d4abe',
    9:'5105a76fce5bb367854b860b93ddc626f4317192ea9a622cfbbf684c48b8d872',
    11:'04fedb9fe6c2fcd37deb236d13db1418b2091222ffe675a5f80333b8cdad196b',
    12:'f8caf707a2874a504d20f59742387e46b95d91fa5aaddd3f54e6d35cdb027e78',
    13:'4de494101134cf246d2fcb212379ac01c50f9f4ad8a17a9e4731a9ba7306efb1',
    14:'01cc8aee631d4ad22842ea19a2127e5213a8c7a55ea62fc19404454d13f5f7b3'
};

test('01 archivo 015 existe',()=>assert.ok(fs.statSync(sqlPath).isFile()));
test('02 015 esta ACTIVE',()=>assert.equal(entry.estado,'ACTIVE'));
test('03 checksum coincide',()=>assert.equal(calcularChecksumCanonico(sqlPath),entry.checksumSha256));
test('04 contiene exactamente tres CREATE TABLE',()=>assert.equal(statements.filter(x=>/^create\s+table/i.test(x)).length,3));
test('05 orden correcto',()=>assert.deepEqual(tableNames,['generaciones','ciclos_escolares','periodos_academicos']));
test('06 crea generaciones',()=>assert.equal(tableNames[0],'generaciones'));
test('07 crea ciclos escolares',()=>assert.equal(tableNames[1],'ciclos_escolares'));
test('08 crea periodos academicos',()=>assert.equal(tableNames[2],'periodos_academicos'));
test('09 no usa IF NOT EXISTS',()=>assert.doesNotMatch(clean,/if\s+not\s+exists/i));
test('10 no usa USE',()=>assert.doesNotMatch(clean,/\buse\b/i));
test('11 no contiene sentencias DML',()=>assert.doesNotMatch(clean,/^\s*(insert|update|delete|replace)\b/im));
test('12 no contiene ALTER',()=>assert.doesNotMatch(clean,/\balter\b/i));
test('13 no contiene DROP ni TRUNCATE',()=>assert.doesNotMatch(clean,/\b(drop|truncate)\b/i));
test('14 no contiene ENUM',()=>assert.doesNotMatch(clean,/\benum\b/i));
test('15 no contiene objetos programables',()=>assert.doesNotMatch(clean,/\b(trigger|procedure|function|event|view)\b/i));
test('16 InnoDB en las tres tablas',()=>assert.equal((clean.match(/engine\s*=\s*innodb/gi)||[]).length,3));
test('17 charset correcto',()=>assert.equal((clean.match(/default\s+character\s+set\s+utf8mb4/gi)||[]).length,3));
test('18 collation correcta',()=>assert.equal((clean.match(/collate\s+utf8mb4_0900_ai_ci/gi)||[]).length,3));
test('19 IDs sin signo compatibles',()=>assert.equal((clean.match(/\bid\s+int\s+unsigned\s+not\s+null\s+auto_increment/gi)||[]).length,3));
test('20 generaciones tiene anios y UNIQUE',()=>assert.match(lower,/unique key uq_generaciones_anios \(anio_inicio, anio_fin\)/));
test('21 generaciones valida orden',()=>assert.match(lower,/check \(anio_fin > anio_inicio\)/));
test('22 generaciones valida cuatro digitos',()=>assert.equal((lower.match(/between 1000 and 9999/g)||[]).length,2));
test('23 ciclos tiene clave UNIQUE',()=>assert.match(lower,/unique key uq_ciclos_escolares_clave \(clave\)/));
test('24 ciclos valida fechas',()=>assert.match(lower,/check \(fecha_inicio <= fecha_fin\)/));
test('25 periodos tiene FK compatible',()=>assert.match(lower,/ciclo_escolar_id int unsigned not null[\s\S]*foreign key \(ciclo_escolar_id\) references ciclos_escolares \(id\)/));
test('26 FK usa RESTRICT',()=>assert.match(lower,/on delete restrict/));
test('27 FK usa CASCADE al actualizar',()=>assert.match(lower,/on update cascade/));
test('28 periodos tiene UNIQUE ciclo clave',()=>assert.match(lower,/unique key uq_periodos_academicos_ciclo_clave \(\s*ciclo_escolar_id,\s*clave\s*\)/));
test('29 periodos valida fechas',()=>assert.ok((lower.match(/check \(fecha_inicio <= fecha_fin\)/g)||[]).length>=2));
test('30 activo default 1',()=>assert.equal((lower.match(/activo boolean not null default true/g)||[]).length,3));
test('31 activo restringido a 0 1',()=>assert.equal((lower.match(/check \(activo in \(0, 1\)\)/g)||[]).length,3));
test('32 timestamps siguen convencion',()=>{assert.equal((lower.match(/creado_en timestamp not null default current_timestamp/g)||[]).length,3);assert.equal((lower.match(/actualizado_en timestamp not null default current_timestamp\s+on update current_timestamp/g)||[]).length,3)});
test('33 no inserta generaciones',()=>assert.doesNotMatch(clean,/\binsert\b/i));
test('34 no inserta ciclos',()=>assert.doesNotMatch(clean,/\bvalues\b/i));
test('35 no inserta periodos',()=>assert.doesNotMatch(clean,/\bselect\b/i));
test('36 no referencia grupos en sentencias',()=>assert.doesNotMatch(clean,/\bgrupos\b/i));
test('37 no altera ciclo escolar heredado',()=>assert.doesNotMatch(clean,/grupos\.ciclo_escolar|alter\s+table\s+grupos/i));
test('38 no crea columnas de 016',()=>assert.doesNotMatch(clean,/generacion_id|periodo_academico_id/));
test('39 no crea asignaciones',()=>assert.doesNotMatch(clean,/asignaciones_/i));
test('40 no crea horarios',()=>assert.doesNotMatch(clean,/horario|clases_programadas/i));
test('41 no existe ON DELETE CASCADE',()=>assert.doesNotMatch(clean,/on\s+delete\s+cascade/i));
test('42 no hay indice FK redundante',()=>assert.doesNotMatch(lower,/key\s+idx_[^(]+\(\s*ciclo_escolar_id\s*\)/));
test('43 SQL solo contiene CREATE TABLE',()=>assert.ok(statements.every(x=>/^create\s+table/i.test(x))));
test('44 000-014 conservan checksums',()=>{for(const [version,checksum] of Object.entries(expectedOldChecksums)){assert.equal(manifest.migraciones.find(x=>x.version===Number(version)).checksumSha256,checksum)}});
test('45 016 a 019 ACTIVE; 020-021 siguen PLANNED',()=>{assert.ok([16,17,18,19].every(v=>manifest.migraciones.find(x=>x.version===v).estado==='ACTIVE'));assert.ok(manifest.migraciones.filter(x=>x.version>=20&&x.version<=21).every(x=>x.estado==='PLANNED'&&x.archivo===null&&x.checksumSha256===null))});
