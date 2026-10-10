/**
 * Pre-paint theme resolution — no next-themes (a boolean + system
 * preference doesn't justify the dependency; the repo is also actively
 * moving away from localStorage as a source of truth, so this reads a
 * cookie instead). Rendered as the first child of <body> in layout.tsx so
 * it runs before content paints — the standard SSR-safe pattern to avoid
 * a flash of the wrong theme. See ThemeToggle.tsx for the write side.
 */
const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )bhb_theme=([^;]*)/);var pref=m?decodeURIComponent(m[1]):"system";var isDark=pref==="dark"||(pref==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",isDark);var meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute("content",isDark?"#0e1526":"#203050");}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}
