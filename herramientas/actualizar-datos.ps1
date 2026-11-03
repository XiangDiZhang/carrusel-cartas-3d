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
function CartasTcgdex($nombreGrupo){
  $id = $tcgdexSets[(& $normal $nombreGrupo)]
  if(-not $id){ return $null }
  $mapa = @{}
  try { foreach($c in (Pedir "https://api.tcgdex.net/v2/en/sets/$id").cards){ $mapa[(& $numero $c.localId)] = $c.id } }
  catch { return $null }
  return $mapa
}

foreach($juego in $JUEGOS.Keys){
  $cat = $JUEGOS[$juego]
  $grupos = @((Pedir "https://tcgcsv.com/tcgplayer/$cat/groups").results |
    Where-Object { $_.publishedOn -and ([DateTime]$_.publishedOn) -le $ahora } |
    Sort-Object { [DateTime]$_.publishedOn } -Descending)
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
    if($juego -eq 'pkm'){
      $mapa = CartasTcgdex $g.name
      if($mapa){ foreach($c in $cartas){ $t = $mapa[(& $numero $c.id)]; if($t){ $c | Add-Member -NotePropertyName t -NotePropertyValue $t } } }
    }
    Guardar (Join-Path $salida "$juego/$($g.groupId).json") @{ cartas = $cartas }
    # si el nombre ya lleva su código («SV08: Surging Sparks») no se repite
    $etiqueta = if($g.abbreviation -and $g.name -notmatch ":"){ "$($g.abbreviation): $($g.name)" } else { $g.name }
    [void]$lista.Add([ordered]@{ code = [string]$g.groupId; label = $etiqueta; year = ([DateTime]$g.publishedOn).Year })
    Write-Host "$juego $($g.groupId) $etiqueta ($($cartas.Count))"
  }
  Guardar (Join-Path $salida "$juego.json") @{ expansiones = $lista }
}
Guardar (Join-Path $salida 'info.json') @{ fecha = $fecha }
Write-Host "Listo: precios de TCGCSV del $fecha"
