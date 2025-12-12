$indexPath = "c:\Users\swinn\my-discord-bot\index.js"
$addonPath = "c:\Users\swinn\my-discord-bot\streamer-addon.txt"

# Read files
$content = Get-Content $indexPath -Raw
$addon = Get-Content $addonPath -Raw

# Find the last occurrence of "];  and replace it
$lastIndex = $content.LastIndexOf("];")
if ($lastIndex -gt 0) {
    $before = $content.Substring(0, $lastIndex)
    $newContent = $before + $addon
    Set-Content $indexPath $newContent
    Write-Host "Successfully updated index.js"
} else {
    Write-Host "Could not find ]; to replace"
}
