# Chipa Tía · Sistema de registro de producción

Web app para que cada sector de Chipa Tía (Chipería, Chipitas, Panadería y Cocina/Buffet) registre su
producción, el stock en frío, los envíos a sucursales, las máquinas y la limpieza, y para que el
administrador vea reportes, los exporte a Excel y los reciba por correo. Reemplaza las planillas en papel.

- **Sistema**: Cloudflare Workers + D1 (plan gratuito), publicado desde GitHub Actions en cada push a `main`:
  [docs/despliegue.md](docs/despliegue.md).
- **Vista previa**: https://darkronier.github.io/Chipa-Tia-IS/ (con datos de prueba que quedan solo en el navegador).
- **API**: [docs/api.md](docs/api.md).

## Qué hace

| Módulo | Pantallas |
|---|---|
| Usuarios y accesos (A) | Entrada con usuario y contraseña, un rol por sector + administrador, cada sector ve solo lo suyo |
| Catálogos (B) | Productos, máquinas con rango de temperatura, áreas y tareas de limpieza, sucursales |
| Producción (C) | Un registro por carga con cocinado y guardado por producto; correcciones del administrador con quién y cuándo |
| Stock en frío (D) | Stock por producto, salidas a venta, envíos a sucursales, mermas, vencimientos, ajustes y stock inicial; nunca negativo |
| Chipería y lotes (E) | Lotes de materia prima, lote propio por producción, horno / congelador, stock y envíos por lote, trazabilidad en los dos sentidos |
| Máquinas (F) | Estado, temperatura obligatoria en equipos fríos, foto achicada en el celular, fuera de rango en rojo, historial |
| Limpieza (G) | Planilla por área con X / XX / -, N° de equipo, comentario, control del supervisor e historial |
| Reportes (H) | Diario, semanal, mensual o por rango; Excel; resumen por correo con enlace |
| Datos (I) | Base central, exportación completa a Excel, copias semanales, hora de Paraguay |

## Desarrollo

```bash
npm install
npm run dev          # app + API dentro del navegador, con datos de prueba
npm test             # pruebas de la API
npm run build:pages  # build de la vista previa para GitHub Pages
npm run deploy       # build y publicación en Cloudflare Workers
```

## Cómo está hecho

- **Pantallas**: React + Vite, pensadas primero para celular (`src/pages`, `src/components`).
- **API**: Hono (`src/server`). La misma app corre en Cloudflare Workers con D1 y R2 (`src/worker`), dentro del
  navegador sobre SQLite en WebAssembly para la demo (`src/demo`) y en las pruebas (`tests`).
- **Base**: SQLite / D1 (`migrations/`). El stock es un libro de movimientos; un trigger impide que quede negativo.
- **Fechas**: se guardan en UTC y se muestran y agrupan en hora de Paraguay (`src/shared/hora.ts`).
