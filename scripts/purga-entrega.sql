-- Purga de la base para la entrega al cliente (Mati, 2026-11-23). NO es una migración: se corre una sola vez, a mano,
-- desde Actions → «Publicar en Cloudflare» → Run workflow, marcando «Purgar la base para la entrega». El workflow saca
-- antes una copia completa de la base (artefacto de la corrida) y la base además tiene Time Travel de 7 días.
--
-- Borra todo lo cargado en las pruebas: ventas y facturas, cajas, ingresos y egresos, compras y pagos, producciones,
-- lotes, stock, lecturas de temperatura, fallas, limpiezas y auditoría.
-- Conserva: usuarios y sesiones, sectores, categorías y sus habilitaciones, proveedores, gastos fijos, configuración
-- (factura, correo) y las categorías de cada depósito de venta.
-- Deja exactamente:
--   - Depósitos: Venta al frente, Venta comedor, Depósito frío 1 (máquina Heladera), Depósito frío 2 (máquina Freezer)
--     y Depósito frío 3 (sin máquina). El stock de materia prima (id interno, no es un depósito) queda vacío.
--   - Sucursales: Sucursal Ruta y Sucursal Encarnación.
--   - Máquinas: las de las planillas (migrations/0002_catalogo.sql) más Heladera y Freezer.
--   - Áreas y tareas de limpieza: exactamente las de las planillas (RE-09.01 a RE-09.10, migrations/0002 y 0024).
--   - 50 productos, al menos 2 por categoría.
-- Las facturas vuelven a empezar en el número inicial del talonario cargado en Caja → Factura.

PRAGMA defer_foreign_keys = true;

-- 1. Fotos guardadas en la base (en Cloudflare están en R2 y quedan ahí sin uso).
DELETE FROM archivos WHERE clave IN (SELECT foto_clave FROM limpiezas WHERE foto_clave IS NOT NULL);
DELETE FROM archivos WHERE clave IN (SELECT foto_clave FROM lecturas WHERE foto_clave IS NOT NULL);

-- 2. Limpieza, temperaturas y fallas.
DELETE FROM limpieza_marcas;
DELETE FROM limpiezas;
DELETE FROM lecturas;
DELETE FROM incidencias;

-- 3. Ventas, facturas y cajas.
DELETE FROM facturas;
DELETE FROM venta_pagos;
DELETE FROM venta_items;
DELETE FROM ventas;
DELETE FROM arqueos;
DELETE FROM ie_movimientos;
DELETE FROM pagos_proveedor;
DELETE FROM caja_movimientos;
DELETE FROM cajas;

-- 4. Stock, producción, lotes y compras.
DELETE FROM movimientos;
DELETE FROM lote_chipa_mp;
DELETE FROM lotes_chipa;
DELETE FROM produccion_items;
DELETE FROM producciones;
DELETE FROM lotes_mp;
DELETE FROM compra_items;
DELETE FROM compras;
DELETE FROM auditoria;

-- 5. Depósitos y sucursales.
UPDATE depositos SET maquina_id = NULL;
DELETE FROM deposito_categorias WHERE deposito_id NOT IN ('venta', 'comedor');
DELETE FROM depositos WHERE id NOT IN ('venta', 'comedor', 'materia_prima');
UPDATE depositos SET nombre = 'Venta al frente', activo = 1, borrado_en = NULL WHERE id = 'venta';
UPDATE depositos SET nombre = 'Venta comedor', activo = 1, borrado_en = NULL WHERE id = 'comedor';
DELETE FROM sucursales;
INSERT INTO sucursales (id, nombre, activo) VALUES ('suc-ruta', 'Sucursal Ruta', 1);
INSERT INTO sucursales (id, nombre, activo) VALUES ('suc-encarnacion', 'Sucursal Encarnación', 1);

-- 6. Máquinas: las de las planillas, más la Heladera y el Freezer de los depósitos fríos.
DELETE FROM maquinas;
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-cocina-1', 'cocina', 1, 'Heladera inox', 'heladera', 1, 5, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-cocina-2', 'cocina', 2, 'Freezer 1', 'congelador', NULL, -18, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-cocina-3', 'cocina', 3, 'Freezer 2', 'congelador', NULL, -18, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-cocina-4', 'cocina', 4, 'Abatidor', 'congelador', NULL, -18, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-cocina-5', 'cocina', 5, 'Horno', 'otra', NULL, NULL, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-cocina-6', 'cocina', 6, 'Buffet: exhibidora fría', 'exhibidora_fria', 1, 10, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-cocina-7', 'cocina', 7, 'Buffet: bufetera caliente', 'exhibidora_caliente', 63, NULL, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-chiperia-1', 'chiperia', 1, 'Freezer horizontal', 'congelador', NULL, -18, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-chiperia-2', 'chiperia', 2, 'Abatidor', 'congelador', NULL, -18, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-chiperia-3', 'chiperia', 3, 'Hornos', 'otra', NULL, NULL, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-chiperia-4', 'chiperia', 4, 'Amasadora', 'otra', NULL, NULL, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-chipitas-1', 'chipitas', 1, 'Máquina de chipitas', 'otra', NULL, NULL, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-chipitas-2', 'chipitas', 2, 'Horno', 'otra', NULL, NULL, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-panaderia-1', 'panaderia', 1, 'Horno', 'otra', NULL, NULL, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-panaderia-2', 'panaderia', 2, 'Fermentadora', 'otra', NULL, NULL, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-heladera', 'chiperia', 5, 'Heladera', 'heladera', 1, 5, 1);
INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES ('maq-freezer', 'chiperia', 6, 'Freezer', 'congelador', NULL, -18, 1);

INSERT INTO depositos (id, nombre, descripcion, sistema, activo, orden, tipo, maquina_id) VALUES ('frio', 'Depósito frío 1', '', 0, 1, 10, 'almacen', 'maq-heladera');
INSERT INTO depositos (id, nombre, descripcion, sistema, activo, orden, tipo, maquina_id) VALUES ('frio-2', 'Depósito frío 2', '', 0, 1, 11, 'almacen', 'maq-freezer');
INSERT INTO depositos (id, nombre, descripcion, sistema, activo, orden, tipo, maquina_id) VALUES ('frio-3', 'Depósito frío 3', '', 0, 1, 12, 'almacen', NULL);

-- 7. Áreas y tareas de limpieza: exactamente las de las planillas.
DELETE FROM tareas_limpieza;
DELETE FROM areas_sectores;
DELETE FROM areas_limpieza;
INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('chiperia', 'Chipería', 'RE-09.04', 1, 0);
INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('chipitas', 'Chipitas: producción', 'RE-09.05', 1, 1);
INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('chipitas-depositos', 'Chipitas: depósitos', 'RE-09.05', 1, 2);
INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('panaderia', 'Panadería', 'RE-09.06', 1, 3);
INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('cocina', 'Cocina', 'RE-09.03', 1, 4);
INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('buffet', 'Buffet', 'RE-09.07', 1, 5);
INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('lavadero', 'Lavadero de utensilios', 'RE-09.08', 1, 6);
INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('sanitario', 'Sanitario', 'RE-09.09', 1, 7);
INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('deposito-mp', 'Depósito de materia prima', 'RE-09.02', 1, 8);
INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('camaras', 'Antecámara y cámaras', 'RE-09.01', 1, 9);
INSERT INTO areas_sectores (area_id, sector) VALUES ('chiperia', 'chiperia');
INSERT INTO areas_sectores (area_id, sector) VALUES ('chipitas', 'chipitas');
INSERT INTO areas_sectores (area_id, sector) VALUES ('chipitas-depositos', 'chipitas');
INSERT INTO areas_sectores (area_id, sector) VALUES ('panaderia', 'panaderia');
INSERT INTO areas_sectores (area_id, sector) VALUES ('cocina', 'cocina');
INSERT INTO areas_sectores (area_id, sector) VALUES ('buffet', 'cocina');
INSERT INTO areas_sectores (area_id, sector) VALUES ('lavadero', 'cocina');
INSERT INTO areas_sectores (area_id, sector) VALUES ('sanitario', 'cocina');
INSERT INTO areas_sectores (area_id, sector) VALUES ('sanitario', 'chiperia');
INSERT INTO areas_sectores (area_id, sector) VALUES ('sanitario', 'chipitas');
INSERT INTO areas_sectores (area_id, sector) VALUES ('sanitario', 'panaderia');
INSERT INTO areas_sectores (area_id, sector) VALUES ('deposito-mp', 'chiperia');
INSERT INTO areas_sectores (area_id, sector) VALUES ('camaras', 'cocina');
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-01', 'chiperia', 'Pared', 0, 1, 0);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-02', 'chiperia', 'Techo', 0, 1, 1);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-03', 'chiperia', 'Ventanas', 0, 1, 2);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-04', 'chiperia', 'Extractor', 0, 1, 3);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-05', 'chiperia', 'Puerta', 0, 1, 4);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-06', 'chiperia', 'Batidora', 0, 1, 5);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-07', 'chiperia', 'Hornos', 0, 1, 6);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-08', 'chiperia', 'Carro de enfriamiento', 0, 1, 7);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-09', 'chiperia', 'Abatidor', 0, 1, 8);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-10', 'chiperia', 'Freezer horizontal', 0, 1, 9);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-11', 'chiperia', 'Amasadora', 0, 1, 10);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-12', 'chiperia', 'Utensilios de trabajo', 0, 1, 11);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-13', 'chiperia', 'Pileta de lavado', 0, 1, 12);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-14', 'chiperia', 'Mesada de trabajo', 0, 1, 13);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-15', 'chiperia', 'Piso', 0, 1, 14);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chiperia-16', 'chiperia', 'Basureros', 0, 1, 15);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-01', 'chipitas', 'Techo', 0, 1, 0);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-02', 'chipitas', 'Pared', 0, 1, 1);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-03', 'chipitas', 'Puerta', 0, 1, 2);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-04', 'chipitas', 'Horno', 0, 1, 3);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-05', 'chipitas', 'Amasadora', 0, 1, 4);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-06', 'chipitas', 'Refinadora', 0, 1, 5);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-07', 'chipitas', 'Máquina de chipitas', 0, 1, 6);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-08', 'chipitas', 'Utensilios de trabajo', 0, 1, 7);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-09', 'chipitas', 'Bandejas', 0, 1, 8);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-10', 'chipitas', 'Carro de enfriamiento', 0, 1, 9);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-11', 'chipitas', 'Mesada de trabajo', 0, 1, 10);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-12', 'chipitas', 'Piso', 0, 1, 11);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-13', 'chipitas', 'Basureros', 0, 1, 12);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-depositos-01', 'chipitas-depositos', 'Depósito MP: techo', 0, 1, 0);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-depositos-02', 'chipitas-depositos', 'Depósito MP: pared', 0, 1, 1);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-depositos-03', 'chipitas-depositos', 'Depósito MP: piso', 0, 1, 2);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-depositos-04', 'chipitas-depositos', 'Depósito MP: pallets', 0, 1, 3);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-depositos-05', 'chipitas-depositos', 'Producto terminado: techo', 0, 1, 4);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-depositos-06', 'chipitas-depositos', 'Producto terminado: pared', 0, 1, 5);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-depositos-07', 'chipitas-depositos', 'Producto terminado: piso', 0, 1, 6);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-chipitas-depositos-08', 'chipitas-depositos', 'Producto terminado: pallets', 0, 1, 7);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-01', 'panaderia', 'Techo', 0, 1, 0);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-02', 'panaderia', 'Pared', 0, 1, 1);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-03', 'panaderia', 'Piso', 0, 1, 2);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-04', 'panaderia', 'Puerta', 0, 1, 3);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-05', 'panaderia', 'Mesada de trabajo', 0, 1, 4);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-06', 'panaderia', 'Utensilios de trabajo', 0, 1, 5);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-07', 'panaderia', 'Horno', 0, 1, 6);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-08', 'panaderia', 'Amasadora', 0, 1, 7);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-09', 'panaderia', 'Refinadora', 0, 1, 8);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-10', 'panaderia', 'Fermentadora', 0, 1, 9);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-11', 'panaderia', 'Estantes', 0, 1, 10);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-12', 'panaderia', 'Contenedores de materia prima', 0, 1, 11);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-panaderia-13', 'panaderia', 'Basurero', 0, 1, 12);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-01', 'cocina', 'Techo', 0, 1, 0);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-02', 'cocina', 'Pared', 0, 1, 1);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-03', 'cocina', 'Azulejos', 0, 1, 2);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-04', 'cocina', 'Mampara y ventanales', 0, 1, 3);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-05', 'cocina', 'Ventiladores', 0, 1, 4);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-06', 'cocina', 'Extractores', 0, 1, 5);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-07', 'cocina', 'Puerta', 0, 1, 6);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-08', 'cocina', 'Piso', 0, 1, 7);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-09', 'cocina', 'Campana de extracción', 0, 1, 8);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-10', 'cocina', 'Cocina industrial 6 hornallas', 0, 1, 9);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-11', 'cocina', 'Cocina industrial 4 hornallas', 0, 1, 10);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-12', 'cocina', 'Molino', 0, 1, 11);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-13', 'cocina', 'Sierra de carne', 0, 1, 12);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-14', 'cocina', 'Cortador de verduras', 0, 1, 13);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-15', 'cocina', 'Heladera inox', 0, 1, 14);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-16', 'cocina', 'Freezer', 1, 1, 15);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-17', 'cocina', 'Horno', 1, 1, 16);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-18', 'cocina', 'Freidoras', 1, 1, 17);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-19', 'cocina', 'Mesadas de trabajo', 0, 1, 18);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-20', 'cocina', 'Utensilios de trabajo', 0, 1, 19);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-21', 'cocina', 'Estante de utensilios', 0, 1, 20);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-22', 'cocina', 'Estante de materia prima', 0, 1, 21);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-23', 'cocina', 'Pileta de lavado con mesada', 0, 1, 22);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-24', 'cocina', 'Recipientes y contenedores', 0, 1, 23);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-25', 'cocina', 'Abatidor', 0, 1, 24);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-26', 'cocina', 'Máquina de agua caliente', 0, 1, 25);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-cocina-27', 'cocina', 'Basureros', 0, 1, 26);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-buffet-01', 'buffet', 'Pared', 0, 1, 0);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-buffet-02', 'buffet', 'Techo', 0, 1, 1);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-buffet-03', 'buffet', 'Ventanas', 0, 1, 2);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-buffet-04', 'buffet', 'Bufeteras', 0, 1, 3);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-buffet-05', 'buffet', 'Balanza', 0, 1, 4);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-buffet-06', 'buffet', 'Mesas', 0, 1, 5);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-buffet-07', 'buffet', 'Cubierto del servicio', 0, 1, 6);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-buffet-08', 'buffet', 'Piso', 0, 1, 7);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-buffet-09', 'buffet', 'Basurero', 0, 1, 8);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-lavadero-01', 'lavadero', 'Piso', 0, 1, 0);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-lavadero-02', 'lavadero', 'Pared', 0, 1, 1);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-lavadero-03', 'lavadero', 'Techo', 0, 1, 2);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-lavadero-04', 'lavadero', 'Puerta', 0, 1, 3);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-lavadero-05', 'lavadero', 'Pileta de lavado', 1, 1, 4);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-lavadero-06', 'lavadero', 'Estantes', 0, 1, 5);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-lavadero-07', 'lavadero', 'Porta utensilios para escurrir', 0, 1, 6);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-lavadero-08', 'lavadero', 'Utensilios varios', 0, 1, 7);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-lavadero-09', 'lavadero', 'Basurero con tapa', 0, 1, 8);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-lavadero-10', 'lavadero', 'Pasillo logístico', 0, 1, 9);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-sanitario-01', 'sanitario', 'Piso', 0, 1, 0);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-sanitario-02', 'sanitario', 'Pared', 0, 1, 1);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-sanitario-03', 'sanitario', 'Techo', 0, 1, 2);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-sanitario-04', 'sanitario', 'Lavamanos', 0, 1, 3);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-sanitario-05', 'sanitario', 'Inodoro', 0, 1, 4);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-sanitario-06', 'sanitario', 'Ventana', 0, 1, 5);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-sanitario-07', 'sanitario', 'Puerta', 0, 1, 6);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-sanitario-08', 'sanitario', 'Basurero', 0, 1, 7);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-deposito-mp-01', 'deposito-mp', 'Techo', 0, 1, 0);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-deposito-mp-02', 'deposito-mp', 'Puerta', 0, 1, 1);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-deposito-mp-03', 'deposito-mp', 'Pared', 0, 1, 2);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-deposito-mp-04', 'deposito-mp', 'Pallets', 0, 1, 3);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-deposito-mp-05', 'deposito-mp', 'Estantes', 0, 1, 4);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-deposito-mp-06', 'deposito-mp', 'Piso', 0, 1, 5);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-01', 'camaras', 'Antecámara: techo', 0, 1, 0);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-02', 'camaras', 'Antecámara: cortina PVC', 0, 1, 1);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-03', 'camaras', 'Antecámara: pared', 0, 1, 2);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-04', 'camaras', 'Antecámara: estantes', 0, 1, 3);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-05', 'camaras', 'Antecámara: recipientes', 0, 1, 4);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-06', 'camaras', 'Antecámara: pallets', 0, 1, 5);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-07', 'camaras', 'Antecámara: piso', 0, 1, 6);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-08', 'camaras', 'Cámara cárnicos: techo', 0, 1, 7);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-09', 'camaras', 'Cámara cárnicos: puerta', 0, 1, 8);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-10', 'camaras', 'Cámara cárnicos: pared', 0, 1, 9);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-11', 'camaras', 'Cámara cárnicos: evaporador', 0, 1, 10);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-12', 'camaras', 'Cámara cárnicos: estantes', 0, 1, 11);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-13', 'camaras', 'Cámara cárnicos: ganchos', 0, 1, 12);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-14', 'camaras', 'Cámara cárnicos: pallets', 0, 1, 13);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-15', 'camaras', 'Cámara cárnicos: piso', 0, 1, 14);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-16', 'camaras', 'Cámara en proceso: techo', 0, 1, 15);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-17', 'camaras', 'Cámara en proceso: puerta', 0, 1, 16);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-18', 'camaras', 'Cámara en proceso: pared', 0, 1, 17);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-19', 'camaras', 'Cámara en proceso: evaporador', 0, 1, 18);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-20', 'camaras', 'Cámara en proceso: estantes', 0, 1, 19);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-21', 'camaras', 'Cámara en proceso: pallets', 0, 1, 20);
INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-camaras-22', 'camaras', 'Cámara en proceso: piso', 0, 1, 21);
-- RE-09.10 Transporte y mantenimiento (migrations/0024_limpieza_transporte.sql).
INSERT OR IGNORE INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('transporte', 'Transporte y mantenimiento', 'RE-09.10', 1, 10);
INSERT OR IGNORE INTO areas_sectores (area_id, sector) VALUES ('transporte', 'chiperia');
INSERT OR IGNORE INTO areas_sectores (area_id, sector) VALUES ('transporte', 'chipitas');
INSERT OR IGNORE INTO areas_sectores (area_id, sector) VALUES ('transporte', 'panaderia');
INSERT OR IGNORE INTO areas_sectores (area_id, sector) VALUES ('transporte', 'cocina');
INSERT OR IGNORE INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-transporte-01', 'transporte', 'Limpieza diaria / superficial', 1, 1, 0);
INSERT OR IGNORE INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-transporte-02', 'transporte', 'Limpieza profunda', 1, 1, 1);
INSERT OR IGNORE INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-transporte-03', 'transporte', 'Mantenimiento', 1, 1, 2);

-- 8. Productos: 50, al menos 2 por categoría. Precios en guaraníes; la materia prima no se vende (sin precio).
DELETE FROM productos;
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-01', 'chiperia', 'Chipa tradicional', 'unidades', 1, 1, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 3000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-02', 'chiperia', 'Chipa so''o', 'unidades', 1, 2, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 5000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-03', 'chiperia', 'Chipa quesú', 'unidades', 1, 3, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 4000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-04', 'chiperia', 'Chipa cheddar', 'unidades', 1, 4, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 4500, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-05', 'chiperia', 'Chipa pollo', 'unidades', 1, 5, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 5000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-06', 'chiperia', 'Chipa JyQ', 'unidades', 1, 6, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 5000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-07', 'chiperia', 'Chipa dulce', 'unidades', 1, 7, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 3500, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-08', 'chiperia', 'Argolla chica', 'unidades', 1, 8, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 2500, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-09', 'chiperia', 'Argolla grande', 'unidades', 1, 9, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 4000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-10', 'cocina', 'Empanada al horno (carne)', 'unidades', 1, 10, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 8000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-11', 'cocina', 'Empanada al horno (pollo)', 'unidades', 1, 11, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 8000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-12', 'cocina', 'Empanada frita (carne)', 'unidades', 1, 12, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 7000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-13', 'cocina', 'Croquete de carne', 'unidades', 1, 13, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 6000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-14', 'cocina', 'Marinera de carne', 'unidades', 1, 14, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 12000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-15', 'cocina', 'Mbeju', 'unidades', 1, 15, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 10000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-16', 'cocina', 'Sopa paraguaya (porción)', 'unidades', 1, 16, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), '', 8000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-17', 'cocina', 'Hamburguesa', 'unidades', 1, 17, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), 'Minutas', 25000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-18', 'cocina', 'Sándwich de milanesa', 'unidades', 1, 18, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), 'Minutas', 22000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-19', 'cocina', 'Pollo muslo (frito)', 'unidades', 1, 19, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos') ORDER BY sistema DESC, orden LIMIT 1), 'Minutas', 15000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-20', 'chipitas', 'Chipitas 100 g', 'unidades', 1, 20, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipa Sticks') ORDER BY sistema DESC, orden LIMIT 1), '', 8000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-21', 'chipitas', 'Chipitas 250 g', 'unidades', 1, 21, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipa Sticks') ORDER BY sistema DESC, orden LIMIT 1), '', 18000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-22', 'chipitas', 'Chipitas 500 g', 'unidades', 1, 22, (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipa Sticks') ORDER BY sistema DESC, orden LIMIT 1), '', 32000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-23', 'panaderia', 'Pan felipe', 'unidades', 1, 23, (SELECT id FROM categorias WHERE lower(nombre) = lower('Panificados') ORDER BY sistema DESC, orden LIMIT 1), '', 1000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-24', 'panaderia', 'Pan de leche', 'unidades', 1, 24, (SELECT id FROM categorias WHERE lower(nombre) = lower('Panificados') ORDER BY sistema DESC, orden LIMIT 1), '', 2000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-25', 'panaderia', 'Galleta', 'unidades', 1, 25, (SELECT id FROM categorias WHERE lower(nombre) = lower('Panificados') ORDER BY sistema DESC, orden LIMIT 1), '', 1000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-26', 'cocina', 'Menú buffet: plato del día', 'unidades', 1, 26, (SELECT id FROM categorias WHERE lower(nombre) = lower('Buffet') ORDER BY sistema DESC, orden LIMIT 1), '', 45000, 10, '', 'elaborado', 1);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-27', 'cocina', 'Menú buffet: guarnición', 'unidades', 1, 27, (SELECT id FROM categorias WHERE lower(nombre) = lower('Buffet') ORDER BY sistema DESC, orden LIMIT 1), '', 20000, 10, '', 'elaborado', 1);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-28', 'cocina', 'Flan casero', 'unidades', 1, 28, (SELECT id FROM categorias WHERE lower(nombre) = lower('Buffet') ORDER BY sistema DESC, orden LIMIT 1), 'Postres', 10000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-29', 'cocina', 'Dulce de mamón con queso', 'unidades', 1, 29, (SELECT id FROM categorias WHERE lower(nombre) = lower('Buffet') ORDER BY sistema DESC, orden LIMIT 1), 'Postres', 12000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-30', 'cocina', 'Cocido con leche', 'unidades', 1, 30, (SELECT id FROM categorias WHERE lower(nombre) = lower('Bebidas') ORDER BY sistema DESC, orden LIMIT 1), '', 6000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-31', 'cocina', 'Cocido negro', 'unidades', 1, 31, (SELECT id FROM categorias WHERE lower(nombre) = lower('Bebidas') ORDER BY sistema DESC, orden LIMIT 1), '', 4000, 10, '', 'elaborado', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-32', 'chiperia', 'Coca-Cola 500 ml', 'unidades', 1, 32, (SELECT id FROM categorias WHERE lower(nombre) = lower('Bebidas') ORDER BY sistema DESC, orden LIMIT 1), 'Gaseosas', 8000, 10, '', 'reventa', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-33', 'chiperia', 'Coca-Cola 1,5 L', 'unidades', 1, 33, (SELECT id FROM categorias WHERE lower(nombre) = lower('Bebidas') ORDER BY sistema DESC, orden LIMIT 1), 'Gaseosas', 15000, 10, '', 'reventa', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-34', 'chiperia', 'Agua mineral sin gas 500 ml', 'unidades', 1, 34, (SELECT id FROM categorias WHERE lower(nombre) = lower('Bebidas') ORDER BY sistema DESC, orden LIMIT 1), 'Aguas', 5000, 10, '', 'reventa', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-35', 'chiperia', 'Agua mineral con gas 500 ml', 'unidades', 1, 35, (SELECT id FROM categorias WHERE lower(nombre) = lower('Bebidas') ORDER BY sistema DESC, orden LIMIT 1), 'Aguas', 5000, 10, '', 'reventa', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-36', 'chiperia', 'Jugo de naranja 500 ml', 'unidades', 1, 36, (SELECT id FROM categorias WHERE lower(nombre) = lower('Bebidas') ORDER BY sistema DESC, orden LIMIT 1), 'Jugos', 7000, 10, '', 'reventa', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-37', 'chiperia', 'Cerveza Pilsen 1 L', 'unidades', 1, 37, (SELECT id FROM categorias WHERE lower(nombre) = lower('Bebidas') ORDER BY sistema DESC, orden LIMIT 1), 'Cervezas', 15000, 10, '', 'reventa', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-38', 'chiperia', 'Almidón de mandioca', 'kg', 1, 38, (SELECT id FROM categorias WHERE lower(nombre) = lower('Materia prima') ORDER BY sistema DESC, orden LIMIT 1), '', NULL, 10, '', 'materia_prima', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-39', 'chiperia', 'Queso Paraguay', 'kg', 1, 39, (SELECT id FROM categorias WHERE lower(nombre) = lower('Materia prima') ORDER BY sistema DESC, orden LIMIT 1), '', NULL, 10, '', 'materia_prima', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-40', 'chiperia', 'Huevos', 'maples', 1, 40, (SELECT id FROM categorias WHERE lower(nombre) = lower('Materia prima') ORDER BY sistema DESC, orden LIMIT 1), '', NULL, 10, '', 'materia_prima', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-41', 'chiperia', 'Grasa de cerdo', 'kg', 1, 41, (SELECT id FROM categorias WHERE lower(nombre) = lower('Materia prima') ORDER BY sistema DESC, orden LIMIT 1), '', NULL, 10, '', 'materia_prima', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-42', 'chiperia', 'Leche entera', 'L', 1, 42, (SELECT id FROM categorias WHERE lower(nombre) = lower('Materia prima') ORDER BY sistema DESC, orden LIMIT 1), '', NULL, 10, '', 'materia_prima', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-43', 'panaderia', 'Harina de trigo 000', 'kg', 1, 43, (SELECT id FROM categorias WHERE lower(nombre) = lower('Materia prima') ORDER BY sistema DESC, orden LIMIT 1), '', NULL, 10, '', 'materia_prima', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-44', 'cocina', 'Carne vacuna', 'kg', 1, 44, (SELECT id FROM categorias WHERE lower(nombre) = lower('Materia prima') ORDER BY sistema DESC, orden LIMIT 1), '', NULL, 10, '', 'materia_prima', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-45', 'cocina', 'Pollo entero', 'kg', 1, 45, (SELECT id FROM categorias WHERE lower(nombre) = lower('Materia prima') ORDER BY sistema DESC, orden LIMIT 1), '', NULL, 10, '', 'materia_prima', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-46', 'cocina', 'Aceite de girasol', 'L', 1, 46, (SELECT id FROM categorias WHERE lower(nombre) = lower('Materia prima') ORDER BY sistema DESC, orden LIMIT 1), '', NULL, 10, '', 'materia_prima', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-47', 'chiperia', 'Helado Amandau vasito (1 bocha)', 'unidades', 1, 47, (SELECT id FROM categorias WHERE lower(nombre) = lower('Amandau') ORDER BY sistema DESC, orden LIMIT 1), '', 10000, 10, '', 'reventa', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-48', 'chiperia', 'Helado Amandau cucurucho (2 bochas)', 'unidades', 1, 48, (SELECT id FROM categorias WHERE lower(nombre) = lower('Amandau') ORDER BY sistema DESC, orden LIMIT 1), '', 15000, 10, '', 'reventa', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-49', 'chiperia', 'Bolsa ecológica', 'unidades', 1, 49, (SELECT id FROM categorias WHERE lower(nombre) = lower('Otros') ORDER BY sistema DESC, orden LIMIT 1), '', 3000, 10, '', 'reventa', 0);
INSERT INTO productos (id, sector, nombre, unidad, activo, orden, categoria_id, subcategoria, precio_venta, iva, codigo, tipo, sin_stock) VALUES ('prod-50', 'chiperia', 'Vela de cumpleaños', 'unidades', 1, 50, (SELECT id FROM categorias WHERE lower(nombre) = lower('Otros') ORDER BY sistema DESC, orden LIMIT 1), '', 2000, 10, '', 'reventa', 0);
