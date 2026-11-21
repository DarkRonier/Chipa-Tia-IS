-- Rol Caja Comedor (Mati, 2026-11-21): vende y factura como el cajero, pero en su propia caja, y lo que vende sale del
-- depósito Venta comedor. Sin mesas ni pesaje por ahora.

-- 1) Rol nuevo. SQLite no deja cambiar un CHECK: `usuarios` se rehace igual que en 0009 (ver ahí por qué en este orden).
PRAGMA defer_foreign_keys = true;

CREATE TABLE usuarios_copia AS SELECT rowid AS fila, * FROM usuarios;

DROP TABLE usuarios;

CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  clave_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('chiperia', 'chipitas', 'panaderia', 'cocina', 'supervisor', 'cajero', 'caja_comedor', 'admin')),
  activo INTEGER NOT NULL DEFAULT 1,
  debe_cambiar_clave INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL,
  borrado_en TEXT
);

INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en, borrado_en)
SELECT id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en, borrado_en FROM usuarios_copia ORDER BY fila;

DROP TABLE usuarios_copia;

-- 2) Dos cajas: la del frente (la de siempre) y la del comedor. Como mucho una abierta de cada una.
ALTER TABLE cajas ADD COLUMN punto TEXT NOT NULL DEFAULT 'frente' CHECK (punto IN ('frente', 'comedor'));

DROP INDEX cajas_una_abierta;

CREATE UNIQUE INDEX cajas_una_abierta_por_punto ON cajas(punto) WHERE cerrada_en IS NULL;
