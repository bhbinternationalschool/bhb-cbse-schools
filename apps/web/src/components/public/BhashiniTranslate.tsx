"use client";

import { useEffect, useRef } from "react";

const SCRIPT_ID = "bhashini-translation-plugin";
const SCRIPT_SRC =
  "https://translation-plugin.bhashini.co.in/v3/website_translation_utility.js";
/** The element the plugin builds its language button in. */
const WIDGET_ID = "bhashini-translation";

/**
 * The plugin's button, carried from page to page. The script looks for
 * `.bhashini-plugin-container` ONCE, when it first runs, and builds the
 * button inside it. Every public page renders its own PublicChrome, so a
 * client-side navigation replaces that container and the button would leave
 * with it — the next page still came up translated (the plugin watches the
 * DOM) but with no way to switch back. Keeping the node and moving it into
 * the new container keeps its listeners; re-running the script would not.
 */
let carriedWidget: HTMLElement | null = null;

/**
 * BHASHINI's website translation widget (Government of India), approved for
 * the bhbinternational.school host on 2026-10-03. The key is bound to that
 * host on BHASHINI's side, so nothing secret lives here.
 *
 * The script goes in only after React has put the container on the page —
 * injected in an effect, never server-rendered, which is how their manual
 * says to load it under Next.js and also keeps it from rewriting text before
 * hydration.
 *
 * Shown on English pages only: it translates FROM English, and it remembers
 * the visitor's language and re-translates every later page into it, so on
 * the school's own Hindi pages it would machine-translate Hindi as if it were
 * English.
 */
export function BhashiniTranslate() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (carriedWidget) {
      container.appendChild(carriedWidget);
    } else if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      // The icon is an SVG filled with this value. Their default (#1D0A69,
      // deep indigo) all but disappears on the dark theme; currentColor
      // takes the header's text colour, which both themes already set.
      script.setAttribute("language-icon-color", "currentColor");
      document.body.appendChild(script);
    }
    return () => {
      const widget = container.querySelector<HTMLElement>(`#${WIDGET_ID}`);
      if (widget) carriedWidget = widget;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="bhashini-plugin-container text-slate-600 hover:text-slate-900"
    />
  );
}
