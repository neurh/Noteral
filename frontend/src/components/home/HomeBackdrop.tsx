import { memo } from "react";
import { ASCII_FONT_SIZE, DEFAULT_ASCII_VEIL, gradientCss, isAsciiBackground, type HomeAsciiOptions, type HomeBackground, type HomeTabSettings } from "../../lib/home";
import { AsciiCanvas } from "./AsciiCanvas";

/** Inline style for the custom color / gradient backgrounds. */
export function customBackgroundStyle(settings: Pick<HomeTabSettings, "background" | "color" | "gradient">): React.CSSProperties | undefined {
  if (settings.background === "custom-color" && settings.color) return { background: settings.color };
  if (settings.background === "custom-gradient" && settings.gradient) return { backgroundImage: gradientCss(settings.gradient), backgroundColor: settings.gradient.to };
  return undefined;
}

interface HomeBackdropProps {
  background: HomeBackground;
  color?: string;
  gradient?: HomeTabSettings["gradient"];
  ascii?: HomeAsciiOptions;
  /** False while the Home tab is hidden; animated backgrounds stop. */
  active: boolean;
  /** True while a view is being edited: the wallpaper dims and ignores the cursor. */
  calm?: boolean;
}

/** The layer behind a Home tab. Memoized so Home re-renders never touch it. */
export const HomeBackdrop = memo(function HomeBackdrop({ background, color, gradient, ascii, active, calm = false }: HomeBackdropProps) {
  if (isAsciiBackground(background)) {
    const veil = ascii?.veil ?? DEFAULT_ASCII_VEIL;
    return (
      <div className={`home-bg ${calm ? "calm" : ""}`} data-bg={background} aria-hidden="true">
        <AsciiCanvas
          className="home-bg-canvas"
          scene={background}
          speed={ascii?.speed ?? 1}
          ink={ascii?.ink}
          fontSize={ASCII_FONT_SIZE[ascii?.density ?? "normal"]}
          playing={active && !ascii?.still}
          interactive={!calm && ascii?.cursor !== false}
          offThread
        />
        <div className="home-bg-scrim" style={{ opacity: Math.min(1, veil * 1.4) }} />
      </div>
    );
  }
  return <div className="home-bg" data-bg={background} style={customBackgroundStyle({ background, color, gradient })} aria-hidden="true" />;
});
