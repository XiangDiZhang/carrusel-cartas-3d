<#
  Descarga de TCGCSV (copia diaria de TCGplayer) las expansiones, cartas y precios de mercado
  y los deja en ficheros pequeños que la página consulta al cargar:
    <salida>/info.json            fecha de los precios
    <salida>/<juego>.json         lista de expansiones (de la más reciente a la más antigua)
    <salida>/<juego>/<grupo>.json las 50 cartas más caras de esa expansión
  Lo ejecuta la tarea de GitHub (.github/workflows/datos.yml) cada día. Funciona en PowerShell 5.1 y 7.
#>
param(
  [string]$salida = 'datos',
  [int]$maxCartas = 50,
  [int]$maxExpansiones = 0,  # 0 = todas (para probar en local, pon unas pocas)
  [int[]]$soloGrupos = @()   # para probar: solo estos groupId de TCGCSV
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$JUEGOS = [ordered]@{ op = 68; pkm = 3 }
$utf8 = New-Object Text.UTF8Encoding $false
# TCGCSV pide que las descargas automáticas se identifiquen
$UA = 'carrusel-cartas-3d/1.0 (+https://github.com/XiangDiZhang/carrusel-cartas-3d)'

function Pedir($url){
  for($k = 1; ; $k++){
    try { return Invoke-RestMethod -Uri $url -TimeoutSec 60 -UserAgent $UA }
    catch { if($k -ge 4){ throw }; Start-Sleep -Seconds (3 * $k) }
  }
}
function Guardar($ruta, $obj){
  $dir = Split-Path $ruta
  if($dir -and -not (Test-Path $dir)){ New-Item -ItemType Directory -Force $dir | Out-Null }
  [IO.File]::WriteAllText($ruta, (ConvertTo-Json $obj -Depth 6 -Compress), $utf8)
}
function Dato($p, $nombre){
  foreach($e in $p.extendedData){ if($e.name -eq $nombre){ return [string]$e.value } }
  return ''
}

$fecha = (Invoke-WebRequest -Uri 'https://tcgcsv.com/last-updated.txt' -UseBasicParsing -TimeoutSec 60 -UserAgent $UA).Content.Trim()
$ahora = [DateTime]::UtcNow

# Pokémon: para poder pedir el precio de Cardmarket a TCGdex hace falta el código de cada carta allí.
# Las expansiones se emparejan por nombre; la página luego comprueba que el producto de TCGplayer coincide.
$normal = { param($s) ($s -replace '^[^:]*:\s*', '').ToLower() -replace '[^a-z0-9]', '' }
$tcgdexSets = @{}
try { foreach($s in (Pedir 'https://api.tcgdex.net/v2/en/sets')){ $tcgdexSets[(& $normal $s.name)] = $s.id } }
catch { Write-Host "TCGdex no responde: Pokémon irá solo con TCGplayer" }
$numero = { param($s) ($s.Split('/')[0].Trim().ToUpper()) -replace '^0+(?=\d)', '' }

# Pokémon: imágenes más grandes (733 × 1024) en pokemontcg.io; TCGplayer no da más de 600 × 838.
# Emparejado estricto (solo se quita un código en mayúsculas delante, «SV08: »), porque aquí no hay forma de comprobarlo.
$normalEstricto = { param($s) ($s -creplace '^[A-Z0-9 -]+:\s*', '').ToLower() -replace '[^a-z0-9]', '' }
$ptcgSets = @{}
try { foreach($s in (Pedir 'https://api.pokemontcg.io/v2/sets?pageSize=250&select=id,name').data){ $ptcgSets[(& $normalEstricto $s.name)] = $s.id } }
catch { Write-Host "pokemontcg.io no responde: Pokémon irá con las imágenes de TCGplayer" }
# pokemontcg.io devuelve una imagen de relleno (con 404) si no existe, y no siempre numera igual que TCGplayer:
# solo se usa su imagen si la carta con ese número tiene el mismo nombre que en TCGplayer
$nombreCarta = { param($s) (($s -split ' - ')[0] -replace '\([^)]*\)', '').ToLower() -replace '[^a-z0-9]', '' }
function CartasPtcg($setId){
  $mapa = @{}
  try { foreach($c in (Pedir "https://api.pokemontcg.io/v2/cards?q=set.id:$setId&pageSize=250&select=name,number").data){ $mapa[(& $numero $c.number)] = $c } }
  catch { return $null }
  return $mapa
}
function CartasTcgdex($nombreGrupo){
  $id = $tcgdexSets[(& $normal $nombreGrupo)]
  if(-not $id){ return $null }
  $mapa = @{}
  try { $set = Pedir "https://api.tcgdex.net/v2/en/sets/$id" } catch { return $null }
  foreach($c in $set.cards){ $mapa[(& $numero $c.localId)] = $c.id }
  return @{ cartas = $mapa; salida = $set.releaseDate }
}

foreach($juego in $JUEGOS.Keys){
  $cat = $JUEGOS[$juego]
  $grupos = @((Pedir "https://tcgcsv.com/tcgplayer/$cat/groups").results |
    Where-Object { $_.publishedOn -and ([DateTime]$_.publishedOn) -le $ahora } |
    Sort-Object { [DateTime]$_.publishedOn } -Descending)
  # One Piece: fuera los mazos de inicio (ST-xx, también los Ultra Deck y las ediciones Super Pre-Release)
  if($juego -eq 'op'){ $grupos = @($grupos | Where-Object { $_.abbreviation -notmatch '^ST-' }) }
  if($soloGrupos.Count){ $grupos = @($grupos | Where-Object { $soloGrupos -contains $_.groupId }) }
  if($maxExpansiones -gt 0){ $grupos = @($grupos | Select-Object -First $maxExpansiones) }
  $lista = New-Object Collections.ArrayList
  foreach($g in $grupos){
    $base = "https://tcgcsv.com/tcgplayer/$cat/$($g.groupId)"
    $productos = (Pedir "$base/products").results
    $precios = (Pedir "$base/prices").results
    # una carta puede tener varios acabados (normal, foil…): se queda el más caro
    $max = @{}
    foreach($p in $precios){
      if($null -eq $p.marketPrice){ continue }
      $m = [double]$p.marketPrice
      if(-not $max.ContainsKey($p.productId) -or $m -gt $max[$p.productId]){ $max[$p.productId] = $m }
    }
    # solo cartas sueltas (llevan número) con imagen y precio; sin ventas = fuera del ranking
    $cartas = @($productos | Where-Object { (Dato $_ 'Number') -and $_.imageCount -gt 0 -and $max.ContainsKey($_.productId) } |
      ForEach-Object {
        $c = [ordered]@{ p = $_.productId; n = $_.name; id = (Dato $_ 'Number'); v = [math]::Round($max[$_.productId], 2) }
        if((Dato $_ 'CardType') -eq 'Leader'){ $c.l = 1 }
        [pscustomobject]$c
      } | Sort-Object v -Descending | Select-Object -First $maxCartas)
    if(-not $cartas.Count){ continue }
    $salidaSet = [DateTime]$g.publishedOn
    $fiable = $juego -ne 'pkm'
    if($juego -eq 'pkm'){
      $td = CartasTcgdex $g.name
      if($td){
        foreach($c in $cartas){ $t = $td.cartas[(& $numero $c.id)]; if($t){ $c | Add-Member -NotePropertyName t -NotePropertyValue $t } }
        # TCGplayer pone fechas de 2026 a expansiones antiguas: si TCGdex la conoce, manda su fecha de salida
        if($td.salida){ $salidaSet = [DateTime]$td.salida; $fiable = $true }
      }
      $ps = $ptcgSets[(& $normalEstricto $g.name)]
      $pm = if($ps){ CartasPtcg $ps } else { $null }
      if($pm){
        foreach($c in $cartas){
          $o = $pm[(& $numero $c.id)]
          # s = ruta de la imagen en images.pokemontcg.io («sv8/238»)
          if($o -and (& $nombreCarta $o.name) -eq (& $nombreCarta $c.n)){ $c | Add-Member -NotePropertyName s -NotePropertyValue "$ps/$($o.number)" }
        }
      }
    }
    # si el nombre ya lleva su código («SV08: Surging Sparks») no se repite
    $etiqueta = if($g.abbreviation -and $g.name -notmatch ":"){ "$($g.abbreviation): $($g.name)" } else { $g.name }
    [void]$lista.Add([pscustomobject][ordered]@{ code = [string]$g.groupId; label = $etiqueta; year = $salidaSet.Year; fecha = $salidaSet;
      grupo = [int]$g.groupId; fiable = $fiable; nombre = ($g.name -creplace '^[A-Z0-9 -]+:\s*', '').Trim(); cartas = $cartas; padre = $null })
    Write-Host "$juego $($g.groupId) $etiqueta ($($cartas.Count))"
  }

  # Sub-colecciones de una expansión (Classic Collection, Trainer Gallery, Release Event…): se juntan con ella.
  # Solo con estos añadidos: «Heroines Edition Vol. 2», «Base Set 2» o «EX Dragon Frontiers» son expansiones distintas.
  $SUBCOLECCIONES = @('Classic Collection', 'Trainer Gallery', 'Galarian Gallery', 'Shiny Vault', 'Radiant Collection',
                      'Release Event Cards', 'Pre-Release Cards')
  foreach($e in $lista){
    $padre = $lista | Where-Object { $_ -ne $e -and $e.nombre.Length -gt $_.nombre.Length -and $e.nombre.StartsWith($_.nombre) -and
      ($SUBCOLECCIONES -contains $e.nombre.Substring($_.nombre.Length).Trim(' ', ':', '-', '(', ')')) } |
      Sort-Object { $_.nombre.Length } -Descending | Select-Object -First 1
    if($padre){ $e.padre = $padre }
  }
  foreach($e in @($lista | Where-Object padre)){
    $p = $e.padre
    while($p.padre){ $p = $p.padre }
    $p.cartas = @(@($p.cartas) + @($e.cartas) | Sort-Object v -Descending | Select-Object -First $maxCartas)
    Write-Host "  junta $($e.label) con $($p.label)"
  }
  $lista = [Collections.ArrayList]@($lista | Where-Object { -not $_.padre })
  foreach($e in $lista){ Guardar (Join-Path $salida "$juego/$($e.code).json") @{ cartas = $e.cartas } }
  # las que TCGdex no conoce toman la fecha de la emparejada con el groupId más cercano (TCGplayer las creó a la vez),
  # si esa es de más de un año antes (las recién salidas que TCGdex aún no tiene se quedan con su fecha)
  $buenas = @($lista | Where-Object fiable)
  if($buenas.Count){
    foreach($e in @($lista | Where-Object { -not $_.fiable })){
      $cerca = $buenas | Sort-Object { [math]::Abs($_.grupo - $e.grupo) } | Select-Object -First 1
      if($cerca.fecha -lt $e.fecha.AddYears(-1)){ $e.fecha = $cerca.fecha; $e.year = $cerca.fecha.Year }
    }
  }
  $orden = @($lista | Sort-Object fecha -Descending | ForEach-Object { [ordered]@{ code = $_.code; label = $_.label; year = $_.year } })
  Guardar (Join-Path $salida "$juego.json") @{ expansiones = $orden }
}
Guardar (Join-Path $salida 'info.json') @{ fecha = $fecha }
Write-Host "Listo: precios de TCGCSV del $fecha"
