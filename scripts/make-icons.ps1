Add-Type -AssemblyName System.Drawing

$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\icons'
New-Item -ItemType Directory -Force -Path $out | Out-Null

foreach ($s in 16, 32, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 59, 130, 246),
    [System.Drawing.Color]::FromArgb(255, 139, 92, 246),
    45.0
  )
  $r = [Math]::Max(3, [int]($s * 0.22))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($s - $d, 0, $d, $d, 270, 90)
  $path.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
  $path.AddArc(0, $s - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath($brush, $path)

  $penWidth = [Math]::Max(1.4, $s * 0.085)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $penWidth)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawEllipse($pen, $s * 0.23, $s * 0.2, $s * 0.42, $s * 0.42)
  $g.DrawLine($pen, $s * 0.61, $s * 0.6, $s * 0.78, $s * 0.77)

  $dotSize = [Math]::Max(1.5, $s * 0.11)
  $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $g.FillEllipse($dotBrush, $s * 0.36, $s * 0.33, $dotSize, $dotSize)
  $g.FillEllipse($dotBrush, $s * 0.5, $s * 0.33, $dotSize, $dotSize)
  $g.FillEllipse($dotBrush, $s * 0.43, $s * 0.46, $dotSize, $dotSize)

  $target = Join-Path $out ("icon{0}.png" -f $s)
  $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

  $dotBrush.Dispose()
  $pen.Dispose()
  $brush.Dispose()
  $path.Dispose()
  $g.Dispose()
  $bmp.Dispose()
  Write-Output "generated $target"
}
