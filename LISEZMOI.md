# ❄ Le laboratoire de Frost — v0.4

Logiciel de **textures imprimables et de mise en page** pour graphistes. Une seule base de code : **version web** (navigateur) et **version bureau** (Windows/Mac, Electron).

## Lancer

| | |
|---|---|
| **Sans rien installer (Windows)** | `release/Le laboratoire de Frost/Le laboratoire de Frost.exe` (dossier à zipper pour le partager) |
| **Bureau, depuis les sources** | double-clic sur `Lancer-Laboratoire-de-Frost.bat` (ou `npm run desktop`) |
| **Web** | double-clic sur `Lancer-version-web.bat` → http://localhost:5178 (ou `npm run dev`) |
| **Refaire la version portable** | `npm run portable` |
| **Installateur Windows** | `release/Laboratoire-de-Frost-Setup-0.4.0.exe` — à refaire avec `npm run installer` |
| **Tests du moteur** | `node --experimental-strip-types tests/engine.test.ts <dossier>` puis `python -I tests/verify_exports.py <dossier>` |

Prérequis pour les sources : Node.js. La première fois, `npm install`.

## Pour tout le monde : 2 questions et c'est parti

Au démarrage, l'écran **Bienvenue** demande :

1. **Que veux-tu créer ?** Affiche risographie, carte postale, pochette de disque, affiche sérigraphie, texture à motif, document vide.
2. **Où vas-tu l'imprimer ?** Imprimeur papier couché / non couché, journal, risographie, sérigraphie, photocopieuse, imprimante de bureau, écran.

La destination règle seule le mode couleur, le profil ICC, l'encrage max, la résolution, la trame et le format d'export. Une phrase dit ce que tu obtiendras (« une image noir et blanc 600 dpi par couleur d'encre, dans un ZIP »).

- **Mode Simple / Expert** (bouton en haut) : le mode Simple cache les réglages techniques (dpi, intention de rendu, encrage max…), sans rien perdre.
- **Guide pas à pas** (Aide) : 6 étapes qui font clignoter la bonne fenêtre.
- **Sauvegarde automatique** : si l'ordinateur plante, l'écran Bienvenue propose « Reprendre ».

## Mise en page (comme InDesign)

- **Outils** (barre de la Planche) : sélection `V`, texte `T`, rectangle `M`, ellipse `L`, ligne `\`, polygone `Y`, étoile `G`, logo `K`, main `H`.
- **Texte** : vraies lettres vectorielles. 14 styles intégrés (Inter, EB Garamond, Space Mono, Orbitron, Silkscreen, VT323) + **tes polices** (TTF/OTF/WOFF importées, ou polices installées sur l'ordinateur). Taille en pt, interligne, approche, alignement gauche / centre / droite / justifié, vertical, capitales, calage sur la ligne de base. Texte en excès signalé en rouge.
- **Logos** : SVG (reste vectoriel, net à toute taille) ou PNG/JPG. Glisser-déposer un fichier sur la Planche marche aussi.
- **Formes** : rectangle (coins arrondis), ellipse, ligne, polygone, étoile ; fond et/ou contour en pt.
- **Grille** (menu Mise en page) : marges, colonnes et gouttière, rangées, grille de ligne de base, repères tirés des règles, magnétisme.
- Déplacer, redimensionner (Maj = proportions), pivoter (Maj = pas de 15°), Alt + glisser = dupliquer, flèches = 0,5 mm.

### La texture dans le texte et les objets, séparément

Chaque objet a **sa propre encre** et son **Remplissage** :

- **Aplat** (avec teinte en %) ou **Texture** : n'importe quelle source (réaction-diffusion, bruit, image, dessin…) tramée à l'intérieur des lettres ou de la forme.
- **Sa propre pile d'effets** ; « **Les effets déforment aussi la forme** » fait fondre, onduler, pixelliser les lettres elles-mêmes.
- **Surimpression** ou **réserve** : par défaut un objet efface les encres en dessous (réserve), comme chez l'imprimeur.

## Zoom et raccourcis (Windows et Mac)

| Windows | Mac | |
|---|---|---|
| Ctrl + **+** / Ctrl + **−** | ⌘ + **+** / ⌘ + **−** | Zoom avant / arrière (marche aussi en AZERTY et au pavé numérique) |
| Ctrl + 0 / Ctrl + 1 | ⌘ 0 / ⌘ 1 | Toute la page / taille réelle 100 % |
| Ctrl + molette | ⌘ + molette | Zoom sous le curseur |
| Espace + glisser | Espace + glisser | Déplacer la vue |
| Ctrl + Z / Ctrl + Maj + Z | ⌘ Z / ⌘ ⇧ Z | Annuler / rétablir |
| Ctrl + E · Ctrl + S · Ctrl + O | ⌘ E · ⌘ S · ⌘ O | Exporter · enregistrer · ouvrir |

Liste complète : menu Aide → Raccourcis (les touches s'affichent en ⌘ sur Mac).

## Textures

1. **Calques** (à gauche) : textures, textes, formes, logos, dans l'ordre d'impression.
2. **Pile d'effets** (à droite) : 20 effets imprimables, réglés en mm. **MOSH !** (Ctrl/⌘ + M) tire des effets au hasard ; 🔒 protège un effet.
3. **Trame** : comment chaque plaque devient des points. Préréglages offset, journal, sérigraphie, riso, bitmap.
4. **Planche** : seule la zone visible est recalculée, même très zoomé. **Loupe** (Affichage) : la vraie trame à la résolution de sortie ; elle reste au premier plan et se place d'un clic, y compris sur un texte.
5. **✎ Atelier** : dessine une tuile, règle la matière, écris une consigne et clique **✦ Améliorer avec l'IA** (voir ci-dessous).
6. **Exporter** (Ctrl/⌘ + E) : JPG, PNG, SVG, TIFF.

## Frost's Special (v0.4)

L'effet signature, dans **Pile d'effets → Signature**. Il transforme n'importe quelle couche (dessin de l'Atelier, photo importée, texte, logo, texture) en **crayon litho + linogravure** : masses noires dont les bords partent en grain, stries de pinceau, lignes gravées qui suivent les formes, entailles blanches à la gouge. Tout est en noir et blanc franc, prêt pour la riso ou la sérigraphie (trame conseillée : **Seuil (trait) 50 %**).

| Section | Réglages |
|---|---|
| Tracé | Tracé des traits (échos des formes, courbes de niveau, ondes parallèles, tourbillon) · angle des ondes · ondulation · écart des lignes · lignes ↔ grain |
| Crayon & pinceau | grain du papier · stries du pinceau · longueur des stries · encrage |
| Bords & halo | estompe des bords · halo · force du halo · bords déchirés · poussière |
| Gouges (linogravure) | gouges blanches · écart des gouges · sens des gouges |

- **Recettes** en tête de la carte : *Linogravure — gouges et crayon*, *Peigne d'échos autour des formes*, *Ondes peignées*, *Crayon litho seul*, *Tourbillon gravé*, *Courbes de niveau (photo)*. Tout reste réglable ensuite ; clic droit sur un curseur = valeur par défaut ; MOSH tire aussi ses réglages.
- Sur un texte ou un logo, cocher « Les effets déforment aussi la forme » : le halo et les échos débordent alors de la lettre.
- Modèle **Frost's Special** sur l'écran d'accueil : A3 noir et blanc, ondes peignées et titre en linogravure.
- Recettes de départ : un dessin au pinceau dans l'Atelier + *Linogravure* ; une photo (Image importée) + *Courbes de niveau* ; un bruit procédural « nuages » + *Ondes peignées*.

## L'Atelier de dessin (v0.3)

**18 outils** (raccourci entre parenthèses) :

| Pinceaux | Tampons | Formes |
|---|---|---|
| Crayon (C) · Pinceau (B) · Plume biseautée (N) · Feutre (F) · Fusain sur grain de papier (K) · Brosse sèche (D) · Aéro (A) · Points (P) · Taches / éclaboussures (S) · Hachures, croisées ou non (H) | Tampon (M) : 9 formes, **ton logo** (SVG, PNG, JPG) ou **un objet de la page** · Texte (T) avec toutes les polices, y compris les tiennes | Ligne (L) · Rectangle (R) · Ellipse (O) · Remplir / pot de peinture (G) · Flou (U) · Gomme (E) |

- Réglages par outil (taille, opacité du geste, dureté, angle, espacement, dispersion, variation, rotation au hasard, grain, sécheresse…), gardés d'une séance à l'autre. `[` et `]` changent la taille.
- **Symétries** : miroirs, quatre quarts, radiales ×4 / ×6 / ×8, kaléidoscope ×12. **Raccordable** ou non.
- **Finesse de la tuile** : 512, 1024 ou 2048 px. **Échelle du motif de 0,5 mm à 1 m** (curseur logarithmique) ; le calcul suit la résolution d'export.
- Les échelles des autres textures vont aussi jusqu'à 1 m (réaction-diffusion, bruit), et l'image jusqu'à 1000 %.

### Textes, logos et formes travaillés comme une texture

Dans **Calques**, chaque objet a un groupe « Travailler à la main » :

- **✎ Dessiner sur cet objet** : le texte, la forme ou le logo devient un dessin de l'Atelier, **à la même place sur la page**. Retouche-le au pinceau, fais-le pousser (croissance organique), rends-le rugueux, granuleux… Ses effets, sa trame et son encre restent. **↺ Revenir à l'original** à tout moment.
- **▦ En faire un motif** : nouvelle tuile avec l'objet au centre ; dessine autour puis **+ Nouvelle couche** pour le répéter sur toute la page.
- Dans l'Atelier, **◈ Poser comme objet** fait l'inverse : n'importe quel dessin devient un objet déplaçable, posé une seule fois.



| Format | Contenu possible | Ce qui est inscrit dans le fichier |
|---|---|---|
| **TIFF** | plaques 1 bit / gris 8 bits, **fichier CMJN unique**, épreuve RVB | dpi, profil ICC (CMJN ou RVB), compression LZW / PackBits |
| **PNG** | plaques 1 bit / gris 8 bits, épreuve RVB | dpi (pHYs), profil ICC RVB ou sRGB |
| **JPG** | épreuve RVB, plaques en gris | dpi (JFIF), profil ICC RVB |
| **SVG** | composite en calques ou une plaque par fichier | textes et formes en vrais contours vectoriels ; trame AM = vrais points ; autres trames = pixels vectorisés |

Le texte est rendu **net à la résolution de sortie** (à 600 dpi, un pixel = 42 µm), jamais agrandi depuis l'aperçu.
Plusieurs fichiers → un ZIP avec une **fiche technique** pour l'imprimeur (profil, dpi, trames, encrage max, objets en surimpression).
Options : fond perdu inclus ou non, **traits de coupe** (marge technique 10 mm).

## Profils couleur

- Gestion couleur réelle avec **LittleCMS** (séparation des images, épreuvage écran, profils intégrés aux fichiers).
- Les profils installés sont trouvés tout seuls : sur ce PC, les 25 profils Adobe (Coated FOGRA39, FOGRA27, GRACoL 2006, SWOP, Japan Color, Uncoated FOGRA29…). Le meilleur profil européen est choisi par défaut.
- **Importer un profil ICC…** pour celui de ton imprimeur (FOGRA51/PSO Coated v3, etc.), ou glisse le fichier .icc sur la Planche.
- Intention de rendu, compensation du point noir, **limite d'encrage total** (TAC) appliquée au calcul.

## IA locale (Atelier)

- Sans installation : **mode règles** (mots-clés en français : « corail », « fin », « granuleux », « diagonale », « riso »…).
- Avec **Ollama** (gratuit, sur la carte NVIDIA) : un modèle qui *voit* le croquis règle les curseurs. Dans PowerShell :
  `ollama pull gemma4:e2b-it-qat` (léger) ou `ollama pull gemma4:e4b-it-qat` (plus précis), puis **Reconnecter** dans l'Atelier.
- Les modèles **« cloud »** (ex. `gemma4:31b-cloud`) sont ignorés : ils enverraient tes croquis sur internet et sont facturés.
- Prévu : **enrichissement par diffusion** (Stable Diffusion + ControlNet via ComfyUI), la 2ᵉ moitié de l'IA hybride.

---

## Points faibles de Mosh et Stochaster : où on en est

✅ réglé · ◐ partiel · ⏳ prévu · — sans objet pour l'impression

### Mosh-Pro

| Point faible | Dans le Labo v0.2 | |
|---|---|---|
| 4096 px maximum | Rendu en bandes, de 150 à 2540 dpi, sans limite de pixels (JPG limité à 16 384 px de côté) | ✅ |
| Pas d'unités physiques ni de DPI | mm, dpi, lpi, µm, ° partout | ✅ |
| Réglages abstraits (« 0,70 ») | Linéature en lpi, grain en µm, rayons en mm | ✅ |
| Effets qui changent avec la résolution | Paramètres en mm : aperçu = export (le tri de pixels varie un peu) | ✅ |
| Pas de zoom 100 % ni de loupe | Taille réelle + Loupe à la résolution de sortie | ✅ |
| Image placée « à la fenêtre » | Logos et images placés en mm, avec règles, grille et magnétisme | ✅ |
| sRGB uniquement | CMJN ICC, tons directs illimités, gris, bitmap | ✅ |
| Half Tone « CMYK » simulé | Vraies plaques séparées, angles anti-moiré | ✅ |
| Couleurs hors gamut sans alerte | Épreuve écran via le profil ; alerte de gamut à venir | ◐ |
| 8 bits → cassures | Calcul interne en flottant 32 bits ; exports 8 bits (16 bits à venir) | ◐ |
| DuoTone limité à 2 couleurs | Une couche = une encre, autant d'encres que voulu | ✅ |
| Postérisation par canal RVB | Postérisation par plaque d'encre | ✅ |
| Half Tone sans linéature ni angle ni forme | AM : 7 formes (rond, euclidien, elliptique, carré, losange, ligne, croix), lpi, angle | ✅ |
| Points antialiasés | Plaques 1 bit pures | ✅ |
| Pas de sortie 1 bit | TIFF et PNG 1 bit | ✅ |
| Dither incomplet | 8 diffusions d'erreur (dont Atkinson), Bayer, FM bruit bleu, seuil | ✅ |
| Dot Matrix sans angle | Trame AM orientable | ✅ |
| Pas d'engraissement, point mini, nettoyage | Compensation, point mini et maxi, nettoyage des grains isolés | ✅ |
| Pas de motif raccordable | Atelier raccordable, réaction-diffusion torique, format « Tuile » | ✅ |
| Formats PNG/JPG seulement | JPG, PNG, SVG, TIFF (PDF/X à venir) | ✅ |
| Pas de fond perdu ni de traits de coupe | Les deux | ✅ |
| Pas d'annulation générale | Historique de 120 étapes + 40 traits dans l'Atelier | ✅ |
| 67 effets dont beaucoup inutiles en print | 20 effets, tous imprimables ; MOSH ne tire que ceux-là | ✅ |
| Interface pensée pour la vidéo | Aucune notion de temps | ✅ |
| Presets fragiles, seed perdu | Projet `.frost` (tout + graine) ; bibliothèque de presets à venir | ◐ |
| Dépend du GPU | Calcul processeur en tâche de fond (marche partout, plus lent) ; GPU à venir | ◐ |
| Pas de texte | Texte vectoriel (14 styles intégrés + tes polices), textures et effets dans les lettres | ✅ |
| 8-Bit, ASCII, détourage IA | Non repris dans cette version | — |

### Stochaster Apps

| Point faible | Dans le Labo v0.2 | |
|---|---|---|
| PNG uniquement | JPG, PNG, SVG, TIFF | ✅ |
| Pas de vectoriel | SVG, points AM géométriques | ✅ |
| Couleurs vectorielles en RVB | SVG en noir par plaque ou en couleurs d'affichage | ◐ |
| Multicanal enregistré en RVB | Plaques séparées + TIFF CMJN avec ICC | ✅ |
| Pas de format de document | Formats A6→A2, affiche, personnalisé, fond perdu | ✅ |
| Une seule encre par app | CMJN et tons directs dans la même app | ✅ |
| Pas d'épreuvage, pas de TAC | Épreuve ICC + limite d'encrage appliquée | ✅ |
| Conversion en gris non réglable | 6 méthodes (Rec.709, Rec.601, moyenne, R, V, B) | ✅ |
| Option « Perception » piège | Absente | ✅ |
| Engraissement à 2 curseurs | Courbe compensée (modèle à 50 %) ; courbe libre à venir | ◐ |
| Clean limité | Nettoyage 0–4 (trames à grain) + point mini (AM) | ◐ |
| Points ronds expérimentaux | 7 formes exactes, surface juste au % près (testé) | ✅ |
| Tuile de 400 px | Tuile physique jusqu'à 200 mm | ✅ |
| Mode Custom instable | 11 motifs de référence testés ; F/k libres à venir | ◐ |
| Pas de graine | Graine partout | ✅ |
| Pas de point elliptique | Présent | ✅ |
| Diffusion sans réglages | Serpentin, grain, nettoyage, engraissement | ✅ |
| Bayer à 4 niveaux | 5 niveaux + grain en µm | ✅ |
| Bibliothèque de motifs manuelle | Éditeur de matrice à venir | ⏳ |
| 4 applications | Une seule | ✅ |
| Angles limités en lot | Angles par plaque automatiques ; traitement d'un dossier à venir | ◐ |
| Ni presets ni projet | Projet `.frost`, préréglages de trame | ✅ |
| Pas d'annulation | Historique complet | ✅ |
| Pas de pile ni de masques | Pile d'effets ; masques à venir | ◐ |
| Fenêtres qui se perdent | Disposition mémorisée + « Réinitialiser la disposition » | ✅ |
| Lenteur | Tâche de fond + aperçu adaptatif ; GPU à venir | ◐ |
| Recalcul manuel (Pointillist) | Temps réel | ✅ |
| Installation Mac au Terminal | Version portable Windows (double-clic) ; installateur prêt à construire | ◐ |
| Pas de version web | Web + bureau | ✅ |

## Limites connues de la v0.2

- Polices intégrées : alphabet latin (accents, œ, €, guillemets…) mais **pas de flèches ni de symboles** (→, ★…) ; importe ta propre police pour ça.
- Texte : une seule police, taille et couleur par bloc (pas encore de styles à l'intérieur d'un paragraphe), pas de chaînage entre blocs.
- Effets « sur la forme » : les bords suivent la résolution du ton continu (lissés à l'export, mais moins nets qu'un texte normal).
- Objet repris à la main : dessin de 2048 px. Un titre de 27 cm garde des bords d'environ 150 dpi, adoucis à l'export : parfait pour un rendu dessiné, moins pour un texte très net (garder alors l'original).
- SVG avec trames FM / diffusion : fichier lourd (une affiche A3 riso ≈ 80 Mo). Préférer le TIFF 1 bit pour l'imprimeur, ou une trame AM pour le SVG.
- L'IA locale demande un modèle Ollama à télécharger (plusieurs Go) ; sans lui, le mode règles fonctionne.
- Ni l'installateur ni la version portable ne sont signés : Windows affiche « Windows a protégé votre ordinateur » → Informations complémentaires → Exécuter quand même.
- Pas encore : PDF/X, 16 bits, masques, pages multiples, traitement par lots, éditeur de matrice, alerte de gamut, diffusion IA (ComfyUI).
