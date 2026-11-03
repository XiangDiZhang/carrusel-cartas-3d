# Carrusel de cartas 3D

Proyecto sacado del artefacto «Carrusel de cartas 3D» (https://claude.ai/artifact/8TcVyHrdGTttnacM5976TD).

## Estructura

- `index.html`: la página.
- `css/estilos.css`: todos los estilos.
- `js/consulta.js`: las consultas en vivo (expansiones, cartas, precios y cambio $ → €).
- `js/app.js`: el carrusel (animación, miniaturas, selector, exportar para OBS).
- `assets/reversos/`: reversos por defecto (One Piece normal y líder, Pokémon).

## Consultas al cargar la página

Cada vez que se abre o se refresca la página se consulta de nuevo (con `cache: 'no-store'`, nunca de la caché):

- **One Piece**: https://optcgapi.com (expansiones, cartas y precio de mercado de TCGplayer, que la API actualiza a diario). Su lista de expansiones tarda en incluir las nuevas, así que se prueban también las dos siguientes de cada serie (OP, EB, PRB). Si una carta aún no tiene imagen en optcgapi, se usa la de Limitless TCG.
- **Pokémon**: https://pokemontcg.io (expansiones, cartas y precio de mercado de TCGplayer). Falla a menudo con 500/502/503, por eso se reintenta hasta 6 veces. Sus precios pueden llevar unas semanas de retraso y las expansiones recién salidas pueden no tener precios todavía: al cambiar de juego se abre la más reciente que sí tenga.
- **Cambio $ → €**: https://frankfurter.dev (BCE, del día).

Dentro de una misma visita cada expansión se consulta una sola vez; al refrescar se vuelve a pedir todo.

TCGCSV (lo que usaba el artefacto) no se puede consultar desde el navegador (no envía cabeceras CORS) y los intermediarios CORS gratuitos no llegan a él.

## Probarlo en local

Las consultas y la exportación para OBS necesitan servir la carpeta por HTTP (abriendo `index.html` como archivo, la exportación no puede leer el CSS ni el JS). Cualquier servidor estático vale.

## Exportar para OBS

Genera `cartas-obs.html`, un archivo único con el CSS, el código y los reversos metidos dentro; las imágenes de las cartas de las expansiones se cargan de internet.
