-- La materia prima no es un depósito (Mati, 2026-11-23). Lo comprado para producir (queso, harina) sigue guardado con
-- el id `materia_prima`, así no se pierde nada de lo comprado ni de lo que consumió la producción, pero ya no aparece
-- en Depósitos ni se puede elegir para transferir, sacar a la venta o enviar: solo lo mueven las compras y la producción.

-- Si alguien había pasado a «Materia prima» algo que no es materia prima (ej.: chipas ya hechas), vuelve a un depósito
-- frío (Cámara 1, o el primero que haya) con una transferencia que queda en el historial. Primero la salida.
INSERT INTO movimientos (id, sector, producto_id, deposito_id, lote, tipo, cantidad, motivo, usuario_id, fecha, dia)
SELECT 'mig23-' || lower(hex(randomblob(8))), s.sector, s.producto_id,
       CASE d.paso WHEN 1 THEN 'materia_prima' ELSE s.destino END, s.lote, 'transferencia',
       CASE d.paso WHEN 1 THEN -s.total ELSE s.total END,
       'De «Materia prima» a «' || s.destino_nombre || '» (la materia prima ya no es un depósito)',
       (SELECT id FROM usuarios WHERE rol = 'admin' ORDER BY creado_en LIMIT 1),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), date('now', '-3 hours')
  FROM (SELECT m.sector, m.producto_id, m.lote, SUM(m.cantidad) AS total, f.id AS destino, f.nombre AS destino_nombre
          FROM movimientos m
          JOIN productos p ON p.id = m.producto_id
          JOIN (SELECT id, nombre FROM depositos WHERE tipo = 'almacen' AND activo = 1 AND borrado_en IS NULL AND id <> 'materia_prima'
                 ORDER BY id = 'frio' DESC, orden LIMIT 1) f
         WHERE m.deposito_id = 'materia_prima' AND p.tipo <> 'materia_prima'
         GROUP BY m.sector, m.producto_id, m.lote HAVING SUM(m.cantidad) > 0) s
  CROSS JOIN (SELECT 1 AS paso UNION ALL SELECT 2) d
 ORDER BY s.producto_id, s.lote, d.paso;

UPDATE depositos SET nombre = 'Stock de materia prima',
       descripcion = 'Lo comprado para producir. No es un depósito: entra con las compras y sale con la producción.'
 WHERE id = 'materia_prima';
