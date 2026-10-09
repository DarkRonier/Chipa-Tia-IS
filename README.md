# Chipa Tía · Sistema de registro de producción

Web app para que cada sector de Chipa Tía (Chipería, Chipitas, Panadería y Cocina/Buffet) registre su producción, el stock en frío, los envíos a sucursales, las máquinas y la limpieza, y para que el administrador reciba reportes.

## Estado

Prototipo navegable (módulo M1): todas las pantallas funcionan con datos de ejemplo guardados en el navegador. Todavía no hay servidor ni base de datos.

- Usuarios de prueba: `chiperia`, `chipitas`, `panaderia`, `cocina`, `admin`. Contraseña: `1234`.
- Los productos de Cocina, las variedades de chipa, las áreas de limpieza y los rangos de temperatura salen de las planillas en papel. Lo marcado "(ejemplo)" se confirma en el relevamiento.

## Desarrollo

```bash
npm install
npm run dev       # servidor local
npm run build     # chequeo de tipos + build en dist/
```

## Stack

React + Vite. Próximo paso: API con Hono en Cloudflare Workers, base Cloudflare D1, fotos y copias en R2.
