-- Etapa 1 de la ampliación (2026-11-15): roles nuevos, stock obligatorio por producto e incidencias de máquinas.

-- 1) Roles Supervisor y Cajero. SQLite no deja cambiar un CHECK, así que `usuarios` se rehace con las mismas filas.
-- Otras tablas apuntan a usuarios(id). Con las claves foráneas diferidas, borrar la tabla deja esas referencias
-- «colgadas» por un momento, y volver a insertar cada usuario con el mismo id en la tabla nueva (que ya se llama
-- `usuarios`) las vuelve a resolver antes del final de la migración. Por eso se copia aparte, se borra, se crea y se
-- vuelve a llenar, en ese orden (renombrar una tabla nueva no alcanza: D1 no vuelve a revisar las referencias).
PRAGMA defer_foreign_keys = true;

CREATE TABLE usuarios_copia AS SELECT rowid AS fila, * FROM usuarios;

DROP TABLE usuarios;

CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  clave_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('chiperia', 'chipitas', 'panaderia', 'cocina', 'supervisor', 'cajero', 'admin')),
  activo INTEGER NOT NULL DEFAULT 1,
  debe_cambiar_clave INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL,
  borrado_en TEXT
);

INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en, borrado_en)
SELECT id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en, borrado_en FROM usuarios_copia ORDER BY fila;

DROP TABLE usuarios_copia;

-- 2) Stock obligatorio. Todos los productos tienen stock; con la marca, nunca queda negativo y frena las salidas que
-- no alcanzan (como hasta ahora). Sin la marca (cocido, harina…) puede quedar sin cargar o en negativo y no frena nada.
-- Todo lo que ya existe queda obligatorio: así funciona igual que antes.
ALTER TABLE productos ADD COLUMN stock_obligatorio INTEGER NOT NULL DEFAULT 1 CHECK (stock_obligatorio IN (0, 1));

DROP TRIGGER movimientos_sin_stock_negativo;

CREATE TRIGGER movimientos_sin_stock_negativo
BEFORE INSERT ON movimientos
WHEN NEW.cantidad < 0
  AND (SELECT stock_obligatorio FROM productos WHERE id = NEW.producto_id) = 1
  AND (
    (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
       WHERE sector = NEW.sector AND producto_id = NEW.producto_id AND finalidad = NEW.finalidad) + NEW.cantidad < 0
    OR (NEW.lote IS NOT NULL AND
       (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
          WHERE sector = NEW.sector AND producto_id = NEW.producto_id AND lote = NEW.lote AND finalidad = NEW.finalidad) + NEW.cantidad < 0)
  )
BEGIN
  SELECT RAISE(ABORT, 'STOCK_INSUFICIENTE');
END;

-- 3) Fallas e incidencias de máquinas que reportan el supervisor o el administrador (sin estado ni temperatura,
-- que siguen siendo las lecturas del sector). Quedan abiertas hasta que alguien las marca como resueltas.
CREATE TABLE incidencias (
  id TEXT PRIMARY KEY,
  maquina_id TEXT NOT NULL REFERENCES maquinas(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('falla', 'incidencia')),
  descripcion TEXT NOT NULL,
  resuelta_por TEXT REFERENCES usuarios(id),
  resuelta_en TEXT,
  resolucion TEXT
);
CREATE INDEX incidencias_maquina ON incidencias(maquina_id, fecha);
CREATE INDEX incidencias_abiertas ON incidencias(fecha) WHERE resuelta_en IS NULL;
