// Adresses des polices intégrées (résolues par Vite, valables en web comme en bureau).
import interRegular from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import interItalic from "@fontsource/inter/files/inter-latin-400-italic.woff?url";
import interBold from "@fontsource/inter/files/inter-latin-700-normal.woff?url";
import interBlack from "@fontsource/inter/files/inter-latin-900-normal.woff?url";
import garamondRegular from "@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff?url";
import garamondItalic from "@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff?url";
import garamondBold from "@fontsource/eb-garamond/files/eb-garamond-latin-700-normal.woff?url";
import spaceRegular from "@fontsource/space-mono/files/space-mono-latin-400-normal.woff?url";
import spaceBold from "@fontsource/space-mono/files/space-mono-latin-700-normal.woff?url";
import orbitronMedium from "@fontsource/orbitron/files/orbitron-latin-500-normal.woff?url";
import orbitronBlack from "@fontsource/orbitron/files/orbitron-latin-900-normal.woff?url";
import silkRegular from "@fontsource/silkscreen/files/silkscreen-latin-400-normal.woff?url";
import silkBold from "@fontsource/silkscreen/files/silkscreen-latin-700-normal.woff?url";
import vt323 from "@fontsource/vt323/files/vt323-latin-400-normal.woff?url";

export const FONT_URLS: Record<string, string> = {
  "inter-400": interRegular,
  "inter-400i": interItalic,
  "inter-700": interBold,
  "inter-900": interBlack,
  "garamond-400": garamondRegular,
  "garamond-400i": garamondItalic,
  "garamond-700": garamondBold,
  "spacemono-400": spaceRegular,
  "spacemono-700": spaceBold,
  "orbitron-500": orbitronMedium,
  "orbitron-900": orbitronBlack,
  "silkscreen-400": silkRegular,
  "silkscreen-700": silkBold,
  "vt323-400": vt323,
};
