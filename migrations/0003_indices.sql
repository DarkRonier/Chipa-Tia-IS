-- Índices para las consultas que crecen con los años de datos (D1 lee cada fila que no encuentra por índice).

-- Stock por lote de Chipería: `leerLotesChipa` (GET /lotes-chipa y reportes) suma los movimientos de un lote
-- (sector = 'chiperia' y lote = código). `movimientos_stock` empieza por producto, así que no sirve para este filtro.
CREATE INDEX IF NOT EXISTS movimientos_sector_lote ON movimientos(sector, lote);

-- Temperaturas fuera de rango del período (GET /lecturas con fueraDeRango y el reporte): filtra por la marca y el día.
CREATE INDEX IF NOT EXISTS lecturas_fuera_dia ON lecturas(fuera_de_rango, dia);

-- Limpiezas por área y día (GET /limpiezas con área y rango de días). `limpiezas_sector_dia` cubre solo el sector.
CREATE INDEX IF NOT EXISTS limpiezas_area_dia ON limpiezas(area_id, dia);

-- Auditoría por fecha: GET /auditoria ordena por fecha y filtra por rango de fechas.
CREATE INDEX IF NOT EXISTS auditoria_fecha ON auditoria(fecha);

-- Movimientos por tipo y día: GET /movimientos con tipos y rango de días, y los reportes de salidas y envíos.
CREATE INDEX IF NOT EXISTS movimientos_tipo_dia ON movimientos(tipo, dia);
