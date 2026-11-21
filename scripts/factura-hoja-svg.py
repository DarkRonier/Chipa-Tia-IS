# Hoja A4 de Chipa Tía, vectorizada: líneas medidas sobre la foto enderezada (mm), rótulos en su lugar.
H_LINES = [  # (y, x0, x1) relativos a la copia
  (7.5, 8.2, 122.0), (34.2, 8.2, 122.0),
  (58.7, 9.3, 200.7), (63.3, 143.2, 200.7), (68.0, 9.3, 200.7), (111.0, 9.3, 200.7),
  (117.45, 9.3, 200.7), (123.85, 9.3, 200.7), (131.6, 9.3, 200.7), (141.85, 9.3, 200.7),
]
V_LINES = [  # (x, y0, y1)
  (8.2, 7.5, 34.2), (122.0, 7.5, 34.2),
  (9.3, 58.7, 141.85), (200.7, 58.7, 141.85),
  (22.8, 58.7, 111.0), (35.9, 58.7, 111.0), (126.3, 58.7, 111.0),
  (143.2, 58.7, 117.45), (162.5, 63.3, 117.45), (181.8, 63.3, 117.45), (173.6, 117.45, 123.85),
]
SERIF = "font-family=\"'Times New Roman',Times,serif\" font-weight=\"700\""
SANS = "font-family=\"Arial,Helvetica,sans-serif\" font-weight=\"700\""
def t(x, y, s, txt, fam=SERIF, anchor='start', ancho=None, extra=''):
    tl = f' textLength="{ancho}" lengthAdjust="spacingAndGlyphs"' if ancho else ''
    return f'<text x="{x}" y="{y}" font-size="{s}" {fam} text-anchor="{anchor}"{tl} {extra}>{txt}</text>'
def copia(dy, pie):
    g = [f'<g transform="translate(0 {dy})">']
    for y, a, b in H_LINES: g.append(f'<line x1="{a}" y1="{y}" x2="{b}" y2="{y}"/>')
    for x, a, b in V_LINES: g.append(f'<line x1="{x}" y1="{a}" x2="{x}" y2="{b}"/>')
    g += [
      t(84.6, 14.6, 5.2, 'Chipa Tía E.A.S. unipersonal', anchor='middle', extra='font-style="italic"'),
      t(84.6, 18.4, 4.2, 'Comedor', fam="font-family=\"'Times New Roman',serif\"", anchor='middle', extra='text-decoration="underline"'),
      t(84.6, 21.5, 3.2, 'Refrigerios - Bebidas', fam="font-family=\"'Times New Roman',serif\"", anchor='middle'),
      t(84.6, 24.4, 2.4, 'Cel.: (0984) 578 338', SANS, 'middle'),
      t(84.6, 27.2, 2.4, 'Correo Electrónico: chipatia4@gmail.com', SANS, 'middle'),
      t(84.6, 29.7, 2.1, 'Ruta 1 Nº. 170 y Avda. Pedro Juan Caballero', SANS, 'middle'),
      t(84.6, 33.0, 2.1, 'Coronel Bogado - Itapúa - Paraguay.', SANS, 'middle'),
      '<g fill="none" stroke-width="0.5"><ellipse cx="25" cy="19" rx="12" ry="6"/><path d="M15 25 h20 l-3 6 h-14 z"/></g>',
      t(25, 20.5, 4.5, 'tía', anchor='middle', extra='font-style="italic"'),
      t(129.3, 9.6, 2.3, 'TIMBRADO Nº 18980642', SANS),
      t(129.3, 12.9, 2.1, 'Fecha Inicio Vigencia: 11/07/2026', SANS),
      t(129.3, 15.8, 2.1, 'Fecha Fin Vigencia: 31/07/2027', SANS),
      t(129.3, 18.7, 2.1, 'RUC: 80145214 - 7', SANS),
      t(161.6, 24.4, 4.8, 'FACTURA', SANS, 'middle'),
      t(129.6, 32.2, 2.6, 'Nº. 001 - 002 -', SANS),
      t(179.4, 33.6, 5.0, '0001775', "font-family=\"'Courier New',monospace\"", 'middle', extra='fill="#c0392b"'),
      t(9.4, 40.3, 2.3, 'FECHA DE EMISIÓN,', ancho=29.9),
      t(129.4, 40.0, 1.9, 'COND. DE VENTA: CONTADO', ancho=27.8),
      t(175.7, 40.5, 2.3, 'CRÉDITO', ancho=12.4),
      t(9.6, 48.5, 2.3, 'SEÑOR(ES):', ancho=18.0),
      t(148.9, 48.7, 2.3, 'C.I. o RUC:', ancho=13.6),
      t(9.5, 55.3, 2.3, 'DIRECCIÓN:', ancho=19.4),
      t(117.0, 55.3, 2.1, 'NOTA DE REMISIÓN Nº', ancho=30.1),
      t(168.9, 55.3, 2.3, 'COD.CLIENTE', ancho=18.6),
      t(16.05, 64.3, 2.7, 'COD', anchor='middle'), t(29.35, 64.3, 2.7, 'CANT.', anchor='middle'),
      t(81.1, 64.0, 2.7, 'DESCRIPCION', anchor='middle'),
      t(134.75, 62.4, 2.4, 'PRECIO', anchor='middle'), t(134.75, 65.6, 2.4, 'UNITARIO', anchor='middle'),
      t(171.95, 62.0, 2.0, 'VALOR DE VENTA', anchor='middle'),
      t(152.85, 66.6, 2.0, 'EXENTAS', anchor='middle', extra='font-style="italic"'),
      t(172.15, 66.6, 2.0, '5%', anchor='middle', extra='font-style="italic"'),
      t(191.25, 66.6, 2.0, '10%', anchor='middle', extra='font-style="italic"'),
      t(10.5, 115.4, 3.2, 'VALOR PARCIAL', ancho=29.5),
      t(10.5, 121.8, 2.9, 'TOTAL A PAGAR Son guaraníes:', ancho=50.9),
      t(10.5, 129.0, 3.8, 'LIQUIDACIÓN DEL IVA:  (5%):', ancho=61.7),
      t(103.7, 129.0, 3.2, '(10%):', ancho=11.1),
      t(148.7, 129.0, 3.2, 'TOTAL IVA:', ancho=21.2),
      t(9.6, 133.6, 1.5, 'HABILITACIÓN Nº 1406', SANS),
      t(9.6, 135.3, 1.5, 'IMPRENTA KIKE de: José L. Ferreira D. - R.U.C: 1158414 - 9', SANS),
      t(9.6, 137.0, 1.5, 'Mcal. Estigarribia 836 e/22de Setiembre y Alberdi', SANS),
      t(9.6, 138.7, 1.5, 'Cnel. Bogado - Tel/fax.: 0741 - 252661 - E-mail: graficakike10@yahoo.com.ar', SANS),
      t(111.0, 135.6, 2.1, 'Cantidad impresa: 500 h. - 11/07/2026', SANS, 'middle'),
      t(111.0, 138.6, 2.1, '001 - 002 - 0001501 al 001 - 002 - 0002000', SANS, 'middle'),
      t(182.0, 136.2, 1.9, pie, SANS, 'middle', extra='font-style="italic"'),
      '</g>',
    ]
    return '\n'.join(g)
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">
<!-- Factura preimpresa de Chipa Tía (A4, original y duplicado). Vectorizada de la foto de la hoja vacía: perspectiva corregida,
     líneas rectas y escala A4 (cada copia mide 148,5 mm, media hoja). Solo para la vista previa: no se imprime. -->
<rect width="210" height="297" fill="#fff"/>
<g stroke="#222" stroke-width="0.3" fill="#222">
{copia(0, 'Original: Cliente.')}
<line x1="0" y1="148.5" x2="210" y2="148.5" stroke="#999" stroke-dasharray="1 1.2" stroke-width="0.25"/>
{copia(148.5, 'Duplicado: Archivo Trib.')}
</g>
</svg>
'''
# las letras no llevan borde
svg = svg.replace('<text ', '<text stroke="none" ')
open('factura-hoja.svg', 'w').write(svg)
