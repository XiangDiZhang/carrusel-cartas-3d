# Carrusel de cartas 3D

Proyecto sacado del artefacto «Carrusel de cartas 3D» (https://claude.ai/artifact/8TcVyHrdGTttnacM5976TD).
En línea: https://xiangdizhang.github.io/carrusel-cartas-3d/

## Estructura

- `index.html`: la página.
- `css/estilos.css`: todos los estilos.
- `js/consulta.js`: las consultas (expansiones, cartas, precios y cambio $ → €).
- `js/app.js`: el carrusel (animación, miniaturas, selector, exportar para OBS).
- `assets/reversos/`: reversos por defecto (One Piece normal y líder, Pokémon).
- `herramientas/actualizar-datos.ps1`: descarga de TCGCSV los datos de TCGplayer.
- `.github/workflows/datos.yml`: tarea diaria que ejecuta lo anterior y lo publica en la rama `datos`.

## De dónde salen precios e imágenes

| | One Piece | Pokémon |
|---|---|---|
| TCGplayer (precio de mercado) | sí | sí |
| Cardmarket (tendencia) | no hay fuente gratuita | sí, vía TCGdex |
| Imagen | TCGplayer, la de cada versión | TCGplayer, la de cada versión |

- **TCGplayer** llega a través de TCGCSV, que lo copia una vez al día (hacia las 20:00 UTC). El navegador no puede consultar TCGCSV (no envía CORS), así que la tarea de GitHub lo descarga cada día y deja un fichero pequeño por expansión (las 50 cartas más caras) en la rama `datos`. Cada versión de una carta (alternativa, manga, SP…) es un producto distinto con su imagen y su precio.
- **Cardmarket** se consulta en vivo a TCGdex, solo para las cartas que se muestran. Solo se usa si TCGdex indica el mismo producto de TCGplayer (así no se mezclan versiones).
- El **precio que se muestra** es la media de las fuentes que tengan la carta (Cardmarket pasado de € a $ con el cambio del día). El detalle de cada fuente sale al pasar el ratón por la miniatura.
- Descartadas: optcgapi (copia los precios de TCGplayer con retraso y sin imágenes de las expansiones nuevas), pokemontcg.io (precios atrasados y falla mucho), la web oficial de One Piece y Limitless (no tienen precios; la oficial no deja usar sus imágenes desde otras webs).

## Al cargar la página

Se consultan la lista de expansiones del juego, el fichero de la expansión elegida, Cardmarket de las cartas mostradas y el cambio del día (con `cache: 'no-store'`). Las miniaturas son imágenes pequeñas; la grande solo se descarga para la carta que se ve y la siguiente.

## Probarlo en local

Genera los datos con `herramientas\actualizar-datos.ps1 -salida datos` (con `-soloGrupos 24820,23651` o `-maxExpansiones 5` para ir rápido) y sirve la carpeta por HTTP en `localhost`: en local la página lee `datos/` en vez de la rama `datos`.

## Exportar para OBS

Genera `cartas-obs.html`, un archivo único con el CSS, el código y los reversos metidos dentro; las imágenes de las cartas de las expansiones se cargan de internet.
