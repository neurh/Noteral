import { memo } from "react";
import { ASCII_FONT_SIZE } from "../lib/home";
import { pageAsciiOptions, pageBackgroundDim, pageBackgroundOpacity, pageBackgroundStyle, type PageBackground } from "../lib/pageBackground";
import { AsciiCanvas } from "./home/AsciiCanvas";
import "../styles/page-background.css";

interface PageBackdropProps {
  background: PageBackground;
  /** False while the page is hidden (inactive tab or pane); animated backgrounds stop. */
  active: boolean;
  /** Small preview (dialogs): cheaper ASCII and no cursor tracking. */
  preview?: boolean;
}

/**
 * The layer behind a page's content. The background itself fades with
 * `opacity` (the page color shows through), then a page-colored veil at `dim`
 * keeps text readable in either theme.
 */
export const PageBackdrop = memo(function PageBackdrop({ background, active, preview = false }: PageBackdropProps) {
  const opacity = pageBackgroundOpacity(background);
  const dim = pageBackgroundDim(background);
  const ascii = pageAsciiOptions(background);
  return (
    <div className={`page-bg ${preview ? "preview" : ""}`} data-kind={background.kind} aria-hidden="true">
      {ascii ? (
        <div className="page-bg-layer" style={{ opacity }}>
          <AsciiCanvas
            className="page-bg-canvas"
            scene={ascii.scene}
            speed={ascii.speed ?? 1}
            ink={ascii.ink}
            fontSize={preview ? 7 : ASCII_FONT_SIZE[ascii.density ?? "normal"]}
            maxFps={preview ? 20 : undefined}
            playing={active && !ascii.still}
            interactive={!preview && ascii.cursor !== false}
            offThread={!preview}
          />
        </div>
      ) : (
        <div className="page-bg-layer" style={{ ...pageBackgroundStyle(background), opacity }} />
      )}
      {dim > 0 ? <div className="page-bg-dim" style={{ opacity: dim }} /> : null}
    </div>
  );
});
