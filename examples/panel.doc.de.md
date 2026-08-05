# Ein Reliefpanel gestalten

Verwandeln Sie jede beliebige SVG-Zeichnung in eine farbige Reliefplakette: eine flache Grundplatte, aus deren Oberfläche sich Ihr Motiv erhebt. Eine mehrfarbige SVG behält die Farbe jedes Bereichs bis zum gedruckten Modell.

## Was Sie erhalten

Das Panel-Design exportiert eine druckfertige 3MF-Datei mit Relief- und Farbdaten:

- Eine abgerundete Grundplatte, die Sie mit **Panelbreite**, **Panelhöhe** und **Grundplattendicke** dimensionieren.
- Ihr Motiv, um die **Reliefhöhe** angehoben und von einem optionalen **Rand** eingefasst.
- Bereichsfarben bleiben in der exportierten `3MF`-Datei erhalten, bereit für einen Multimaterial-Slicer.

## Erste Schritte

Verwenden Sie den SVG-Assistenten, bevor Sie die Panelmaße feinabstimmen:

- Öffnen Sie **SVG vorbereiten…** und ziehen Sie Ihre Zeichnung hinein. Der Assistent prüft sie, behebt gängige Probleme und liest die Farbe jedes benannten Bereichs ein.
- Passen Sie die Panelgröße und die **Reliefhöhe** an, bis die Vorschau passt.
- Klicken Sie auf **Download für 3D-Druck** und slicen Sie die Datei wie jede andere.

## Tipps für einen sauberen Druck

Diese Einstellungen erleichtern das Slicen und Drucken des Reliefs:

- Halten Sie Konturen und kleine Details kräftig genug für Ihre Düsengröße.
- Eine **Reliefhöhe** von etwa `1–1.5 mm` wirkt gut, ohne die Druckzeit unnötig zu verlängern.
- Auch einfarbige Motive funktionieren: Lassen Sie die Farben leer, dann wird die ganze Zeichnung als ein Relief importiert.

Für einen Rundgang durch die gesamte App öffnen Sie **Hilfe** in der oberen Leiste, oder besuchen Sie das [ScadPub-Repository](https://github.com/mfbernardes/scad-pub).
